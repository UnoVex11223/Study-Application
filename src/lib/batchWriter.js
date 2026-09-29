// Question writing and review through the Message Batches API: the same
// prompts and models as live calls, at half the price, with results usually
// within the hour. Used for whole-book imports, where nobody is waiting.
//
// Two stages per chapter: every group's writer request in one batch, then
// every group's review in a second. Progress is handed to onSaved so an
// import can pick a batch back up after the app restarts instead of paying
// for it twice. Anything a batch can't handle is redone live, so quality
// never depends on the batch.

import { api, splitBatches, writeAndReview, reviewsById, toCandidates } from "./ai.js";
import { selectForConcept } from "./quality.js";
import { index } from "./model.js";

const POLL_MS = 30000;
const MAX_STATUS_FAILURES = 10;
const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

const conceptCtx = (c) => ({ key: c.key, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance, excerpt: c.excerpt });

async function waitForBatch(a, batchId, { sleep, pollMs, stopped }) {
  let failures = 0;
  for (;;) {
    if (stopped?.()) return { ok: false, error: "stopped", stopped: true };
    const s = await a.batchStatus(batchId).catch(err => ({ ok: false, error: err?.message }));
    if (s?.ok && s.status === "ended") return { ok: true };
    if (!s?.ok && ++failures >= MAX_STATUS_FAILURES) return { ok: false, error: s?.error || "Couldn't check on the batch." };
    await sleep(pollMs);
  }
}

/**
 * Same result shape as generateTasks: { ok, groups, written, reviewed, partial }.
 * saved: { stage: "write" | "critique", batchId, candidates? } from onSaved, to resume.
 * Returns batchBroken: true when the batch rejected every request, so the
 * caller can go live for the rest of the import.
 */
export async function writeViaBatch({ state, courseId, sections, saved = null, onSaved, sleep = defaultSleep, pollMs = POLL_MS, stopped }) {
  const a = api();
  if (!a?.batchCreate) return { ok: false, error: "Batches need the desktop app." };
  const courseName = index(state).course[courseId]?.name ?? "";
  const groups = splitBatches(sections);
  if (!groups.length) return { ok: false, error: "Pick at least one concept." };
  const sectionTitle = (g) => g.section.title;

  // ── Stage 1: write candidates ──────────────────────────────────────────
  let candidates = saved?.stage === "critique" ? saved.candidates : null; // [gi] → candidates | null
  let live = 0;
  if (!candidates) {
    let batchId = saved?.stage === "write" ? saved.batchId : null;
    if (!batchId) {
      const created = await a.batchCreate({
        kind: "items",
        requests: groups.map((g, gi) => ({ id: `w${gi}`, payload: { courseName, sectionTitle: sectionTitle(g), concepts: g.concepts.map(conceptCtx) } })),
      });
      if (!created?.ok) return { ok: false, error: created?.error || "Couldn't start a batch.", batchUnavailable: true };
      batchId = created.batchId;
      onSaved?.({ stage: "write", batchId });
    }
    const waited = await waitForBatch(a, batchId, { sleep, pollMs, stopped });
    if (!waited.ok) return { ok: false, error: waited.error, stopped: waited.stopped };
    const res = await a.batchResults(batchId);
    if (!res?.ok) return { ok: false, error: res?.error || "Couldn't read the batch results." };
    candidates = groups.map((g, gi) => {
      const r = res.results[`w${gi}`];
      return r?.ok ? toCandidates(r.data, g.concepts, `q${gi}`) : null;
    });
    if (candidates.every(c => c === null)) {
      // The batch took nothing: go live for this chapter and tell the caller.
      const fallback = await liveAll({ a, courseName, groups });
      return { ...fallback, batchBroken: true };
    }
    onSaved?.({ stage: "critique", batchId: null, candidates });
  }

  // ── Stage 2: review ────────────────────────────────────────────────────
  const reviews = groups.map(() => null);
  const toReview = groups.map((g, gi) => (candidates[gi]?.length ? gi : -1)).filter(gi => gi >= 0);
  if (toReview.length) {
    let batchId = saved?.stage === "critique" ? saved.batchId : null;
    if (!batchId) {
      const created = await a.batchCreate({
        kind: "critique",
        requests: toReview.map(gi => ({ id: `c${gi}`, payload: {
          courseName, sectionTitle: sectionTitle(groups[gi]), concepts: groups[gi].concepts.map(conceptCtx),
          questions: candidates[gi].map(q => ({ id: q.id, concept_key: q.conceptKey, ability: q.ability, prompt: q.prompt, model_answer: q.answer, accept: q.accept, required_points: q.points, misconceptions: q.misconceptions })),
        } })),
      });
      if (created?.ok) {
        batchId = created.batchId;
        onSaved?.({ stage: "critique", batchId, candidates });
      }
    }
    if (batchId) {
      const waited = await waitForBatch(a, batchId, { sleep, pollMs, stopped });
      if (!waited.ok) return { ok: false, error: waited.error, stopped: waited.stopped };
      const res = await a.batchResults(batchId);
      if (res?.ok) for (const gi of toReview) { const r = res.results[`c${gi}`]; if (r?.ok) reviews[gi] = reviewsById(r.data); }
    }
  }

  // Anything the batch didn't cover is done live.
  const out = [];
  let written = 0, reviewed = true, failed = null;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    let cands = candidates[gi], rev = reviews[gi];
    if (!cands || (cands.length && !rev)) {
      live++;
      const r = cands
        ? await liveReview({ a, courseName, group: g, candidates: cands })
        : await writeAndReview({ a, courseName, sectionTitle: sectionTitle(g), concepts: g.concepts, tag: `q${gi}` }).catch(err => ({ ok: false, error: err?.message }));
      if (!r.ok) { failed = r.error; continue; }
      cands = r.candidates; rev = r.reviews;
      if (!r.reviewed) reviewed = false;
    }
    written += cands.length;
    for (const c of g.concepts) {
      const { kept, dropped } = selectForConcept(cands.filter(q => q.conceptKey === c.key), rev || {}, c.importance);
      out.push({
        sectionTitle: g.section.title, conceptKey: c.key, conceptName: c.name, importance: c.importance, reviewed: Boolean(rev),
        kept: kept.map(q => ({ ...q, selected: true })),
        dropped: dropped.map(q => ({ ...q, selected: false })),
      });
    }
  }
  if (!out.length) return { ok: false, error: failed || "No questions could be written." };
  return { ok: true, groups: out, written, reviewed, partial: failed, live };
}

async function liveReview({ a, courseName, group, candidates }) {
  const crit = await a.critique({
    courseName, sectionTitle: group.section.title, concepts: group.concepts.map(conceptCtx),
    questions: candidates.map(q => ({ id: q.id, concept_key: q.conceptKey, ability: q.ability, prompt: q.prompt, model_answer: q.answer, accept: q.accept, required_points: q.points, misconceptions: q.misconceptions })),
  }).catch(() => null);
  return { ok: true, candidates, reviews: crit?.ok ? reviewsById(crit.data) : {}, reviewed: Boolean(crit?.ok) };
}

async function liveAll({ a, courseName, groups }) {
  const out = [];
  let written = 0, failed = null;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const r = await writeAndReview({ a, courseName, sectionTitle: g.section.title, concepts: g.concepts, tag: `q${gi}` }).catch(err => ({ ok: false, error: err?.message }));
    if (!r.ok) { failed = r.error; continue; }
    written += r.candidates.length;
    for (const c of g.concepts) {
      const { kept, dropped } = selectForConcept(r.candidates.filter(q => q.conceptKey === c.key), r.reviews, c.importance);
      out.push({ sectionTitle: g.section.title, conceptKey: c.key, conceptName: c.name, importance: c.importance, reviewed: r.reviewed,
        kept: kept.map(q => ({ ...q, selected: true })), dropped: dropped.map(q => ({ ...q, selected: false })) });
    }
  }
  if (!out.length) return { ok: false, error: failed || "No questions could be written." };
  return { ok: true, groups: out, written, reviewed: true, partial: failed, live: groups.length };
}

// Question writing and review through the Message Batches API: the same
// prompts and models as live calls, at half the price, with results usually
// within the hour. Used for whole-book imports, where nobody is waiting.
//
// Two stages per chapter: every group's writer request in one batch, then
// every group's review in a second. Progress is handed to onSaved so an
// import can pick a batch back up after the app restarts instead of paying
// for it twice. Anything a batch can't handle is redone live, so quality
// never depends on the batch.

import { api, splitBatches, writeAndReview, reviewsById, toCandidates, toLessons, forReview, writerConcept, writerOf, planRebuild } from "./ai.js";
import { selectForConcept } from "./quality.js";
import { index } from "./model.js";

const POLL_MS = 30000;
const MAX_STATUS_FAILURES = 10;
const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

// A concept as the writer and reviewer see it (with its current questions when it's being rebuilt).
const conceptCtx = writerConcept;

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
  const writer = writerOf(state);
  const groups = splitBatches(sections);
  if (!groups.length) return { ok: false, error: "Pick at least one concept." };
  const sectionTitle = (g) => g.section.title;

  // ── Stage 1: write candidates ──────────────────────────────────────────
  let candidates = saved?.stage === "critique" ? saved.candidates : null; // [gi] → candidates | null
  let lessons = saved?.stage === "critique" ? saved.lessons || [] : []; // [gi] → { [conceptKey]: lesson }
  let live = 0;
  if (!candidates) {
    let batchId = saved?.stage === "write" ? saved.batchId : null;
    if (!batchId) {
      const created = await a.batchCreate({
        kind: "items",
        requests: groups.map((g, gi) => ({ id: `w${gi}`, payload: { courseName, sectionTitle: sectionTitle(g), concepts: g.concepts.map(conceptCtx), writer } })),
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
    lessons = groups.map((g, gi) => {
      const r = res.results[`w${gi}`];
      return r?.ok ? toLessons(r.data) : {};
    });
    if (candidates.every(c => c === null)) {
      // The batch took nothing: go live for this chapter and tell the caller.
      const fallback = await liveAll({ a, courseName, groups, writer });
      return { ...fallback, batchBroken: true };
    }
    onSaved?.({ stage: "critique", batchId: null, candidates, lessons });
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
          questions: candidates[gi].map(forReview),
        } })),
      });
      if (created?.ok) {
        batchId = created.batchId;
        onSaved?.({ stage: "critique", batchId, candidates, lessons });
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
    let cands = candidates[gi], rev = reviews[gi], taught = lessons[gi] || {};
    if (!cands || (cands.length && !rev)) {
      live++;
      const r = cands
        ? await liveReview({ a, courseName, group: g, candidates: cands })
        : await writeAndReview({ a, courseName, sectionTitle: sectionTitle(g), concepts: g.concepts, tag: `q${gi}`, writer }).catch(err => ({ ok: false, error: err?.message }));
      if (!r.ok) { failed = r.error; continue; }
      cands = r.candidates; rev = r.reviews;
      if (r.lessons) taught = r.lessons;
      if (!r.reviewed) reviewed = false;
    }
    written += cands.length;
    for (const c of g.concepts) {
      const { kept, dropped } = selectForConcept(cands.filter(q => q.conceptKey === c.key), rev || {}, c.importance);
      out.push({
        sectionTitle: g.section.title, conceptKey: c.key, conceptName: c.name, importance: c.importance, reviewed: Boolean(rev),
        lesson: taught[c.key] ?? null,
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
    questions: candidates.map(forReview),
  }).catch(() => null);
  return { ok: true, candidates, reviews: crit?.ok ? reviewsById(crit.data) : {}, reviewed: Boolean(crit?.ok) };
}

async function liveAll({ a, courseName, groups, writer }) {
  const out = [];
  let written = 0, failed = null;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const r = await writeAndReview({ a, courseName, sectionTitle: g.section.title, concepts: g.concepts, tag: `q${gi}`, writer }).catch(err => ({ ok: false, error: err?.message }));
    if (!r.ok) { failed = r.error; continue; }
    written += r.candidates.length;
    for (const c of g.concepts) {
      const { kept, dropped } = selectForConcept(r.candidates.filter(q => q.conceptKey === c.key), r.reviews, c.importance);
      out.push({ sectionTitle: g.section.title, conceptKey: c.key, conceptName: c.name, importance: c.importance, reviewed: r.reviewed,
        lesson: r.lessons?.[c.key] ?? null,
        kept: kept.map(q => ({ ...q, selected: true })), dropped: dropped.map(q => ({ ...q, selected: false })) });
    }
  }
  if (!out.length) return { ok: false, error: failed || "No questions could be written." };
  return { ok: true, groups: out, written, reviewed: true, partial: failed, live: groups.length };
}

/**
 * Rebuild concepts as ladders through the Batch API: the same writer, review
 * and ladder as a live rebuild (lib/ai.js rebuildLadders), at half the price.
 * Nobody waits on a rebuild, so this is the default when Settings → Batches
 * is on half price. `saved`/`onSaved` work as in writeViaBatch, so a rebuild
 * the app closed on picks its batch back up instead of paying for it twice.
 * Each concept's ladder is planned against the library as it is when the
 * results arrive (getState) and handed to onLadder.
 * Returns { ok, rebuilt, steps, concepts, partial } (or batchUnavailable: go live).
 */
export async function rebuildViaBatch({ getState, courseId, conceptIds, saved = null, onSaved, onLadder, sleep, pollMs, stopped }) {
  const state = getState();
  const ix = index(state);
  const targets = conceptIds.map(id => ix.concept[id]).filter(Boolean);
  if (!targets.length) return { ok: true, rebuilt: 0, steps: 0, concepts: 0 };
  // One section per chapter, so each group's writer sees its chapter's name.
  const bySection = new Map();
  for (const c of targets) {
    if (!bySection.has(c.sectionId)) bySection.set(c.sectionId, { title: ix.section[c.sectionId]?.title ?? "", concepts: [] });
    bySection.get(c.sectionId).concepts.push({
      key: c.id, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance, excerpt: c.source?.excerpt || "",
      current: (ix.itemsByConcept[c.id] || []).map(i => i.prompt), selected: true,
    });
  }
  const res = await writeViaBatch({ state, courseId, sections: [...bySection.values()], saved, onSaved, sleep, pollMs, stopped });
  if (!res.ok) return res;
  const now = index(getState());
  let rebuilt = 0, steps = 0;
  for (const g of res.groups) {
    const c = now.concept[g.conceptKey];
    if (!c || !g.kept.length) continue;
    onLadder?.({ conceptId: c.id, ...planRebuild(c, now.itemsByConcept[c.id] || [], g.kept), lesson: g.lesson ?? c.lesson ?? null, steps: g.kept.length });
    rebuilt++; steps += g.kept.length;
  }
  return { ok: true, rebuilt, steps, concepts: targets.length, partial: res.partial || null };
}

// Renderer-side orchestration of the AI features. The actual API calls run in
// Electron's main process (see electron.cjs) so the API key never reaches the UI.

import { index, makeSection, makeConcept, makeItem, makeEdge, ABILITIES, IMPORTANCE } from "./model.js";
import { selectForConcept, lintQuestion } from "./quality.js";
import { verifyPoints } from "./grade.js";

const api = () => (typeof window !== "undefined" && window.engram?.ai) || null;

export const aiBridge = () => Boolean(api());

export async function aiAvailable() {
  const a = api();
  if (!a?.status) return false;
  try { return Boolean((await a.status()).hasKey); } catch { return false; }
}

const NO_KEY = "Add an Anthropic API key in Settings to use this.";
const wrap = (res) => (res?.ok ? res : { ok: false, error: res?.error === "no-key" ? NO_KEY : res?.error || "Something went wrong." });

/** Split long material on headings/paragraphs into chunks the model can handle well. */
export function splitSource(text, max = 90000) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const blocks = clean.split(/\n(?=#{1,3} )|\n\s*\n/);
  const chunks = [];
  let cur = "";
  for (const b of blocks) {
    if (cur && cur.length + b.length + 2 > max) { chunks.push(cur); cur = ""; }
    cur += (cur ? "\n\n" : "") + b;
    while (cur.length > max) { chunks.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/**
 * Step 1: find sections and concepts. Returns
 * { ok, title, sections:[{title, summary, concepts:[{key,…}]}], gaps }
 */
export async function extractMaterial({ state, courseId, title, location, text, onProgress }) {
  const a = api();
  if (!a) return { ok: false, error: "AI features need the desktop app." };
  const ix = index(state);
  const course = ix.course[courseId];
  const known = (ix.conceptsByCourse[courseId] || []).map(c => ({ name: c.name, section: ix.section[c.sectionId]?.title }));
  const chunks = splitSource(text);
  const out = { title: title || "", sections: [], gaps: [] };

  for (let ci = 0; ci < chunks.length; ci++) {
    onProgress?.({ step: "extract", part: ci + 1, parts: chunks.length });
    const res = wrap(await a.extract({ courseName: course?.name ?? "", title, location, text: chunks[ci], known }));
    if (!res.ok) return out.sections.length ? { ok: true, ...out, partial: res.error } : res;
    const d = res.data;
    if (!out.title && d.title) out.title = d.title;
    const localKeys = new Set(d.sections.flatMap(s => s.concepts.map(c => c.key)));
    for (const s of d.sections) {
      const concepts = s.concepts
        .filter(c => c.name?.trim())
        .map(c => ({
          ...c,
          key: `${ci}:${c.key}`,
          prerequisites: (c.prerequisites || []).map(p => (localKeys.has(p) ? `${ci}:${p}` : p)),
          selected: c.importance !== "detail",
        }));
      if (concepts.length) out.sections.push({ title: s.title, summary: s.summary, concepts });
      for (const c of concepts) known.push({ name: c.name, section: s.title });
    }
    out.gaps.push(...(d.gaps || []));
  }
  if (!out.sections.length) return { ok: false, error: "No concepts worth studying were found in that material." };
  return { ok: true, ...out };
}

const toQuestion = (t, id) => ({
  id,
  ability: t.ability,
  prompt: String(t.prompt || "").trim(),
  answer: String(t.model_answer || "").trim(),
  accept: t.ability === "recall" ? (t.accept || []).map(x => String(x).trim()).filter(Boolean) : [],
  points: (t.required_points || []).map(x => String(x).trim()).filter(Boolean),
  misconceptions: (t.misconceptions || []).map(x => String(x).trim()).filter(Boolean),
  hint: String(t.hint || "").trim(),
});

/**
 * Step 2: write candidate questions for the chosen concepts, have an
 * independent reviewer score them, and keep only the ones that pass the
 * quality gate (see quality.js).
 * Returns { ok, groups: [{ section, concept, kept, dropped }], written, reviewed, partial }.
 */
export async function generateTasks({ state, courseId, sections, onProgress }) {
  const a = api();
  if (!a) return { ok: false, error: "AI features need the desktop app." };
  const courseName = index(state).course[courseId]?.name ?? "";
  const batches = splitBatches(sections);
  if (!batches.length) return { ok: false, error: "Pick at least one concept." };

  // Each group is written and then reviewed on its own, so groups run side by
  // side instead of one after another. Most of the wait is the model writing
  // text, so this cuts a chapter's wait roughly by the number of groups.
  const runBatch = async ({ section, concepts }, bi) => {
    const ctx = concepts.map(c => ({ key: c.key, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance, excerpt: c.excerpt }));
    const res = wrap(await a.items({ courseName, sectionTitle: section.title, concepts: ctx }));
    if (!res.ok) return { ok: false, error: res.error };
    const keys = new Set(concepts.map(c => c.key));
    const raw = res.data.tasks.filter(t => keys.has(t.concept_key) && ABILITIES[t.ability] && t.prompt?.trim() && t.model_answer?.trim());
    const candidates = raw.map((t, i) => ({ ...toQuestion(t, `q${bi}_${i}`), conceptKey: t.concept_key }));

    let reviews = {};
    const crit = a.critique ? wrap(await a.critique({
      courseName, sectionTitle: section.title, concepts: ctx,
      questions: candidates.map(q => ({ id: q.id, concept_key: q.conceptKey, ability: q.ability, prompt: q.prompt, model_answer: q.answer, accept: q.accept, required_points: q.points, misconceptions: q.misconceptions })),
    })) : { ok: false };
    if (crit.ok) reviews = Object.fromEntries(crit.data.reviews.map(r => [r.id, r]));

    const groups = concepts.map(c => {
      const { kept, dropped } = selectForConcept(candidates.filter(q => q.conceptKey === c.key), reviews, c.importance);
      return {
        sectionTitle: section.title, conceptKey: c.key, conceptName: c.name, importance: c.importance, reviewed: crit.ok,
        kept: kept.map(q => ({ ...q, selected: true })),
        dropped: dropped.map(q => ({ ...q, selected: false })),
      };
    });
    return { ok: true, groups, written: candidates.length, reviewed: crit.ok };
  };

  const attempt = (b, bi) => runBatch(b, bi).catch(err => ({ ok: false, error: err?.message || "Something went wrong." }));

  const results = new Array(batches.length).fill(null);
  let done = 0, passed = 0;
  const report = () => onProgress?.({ step: "write", done, total: batches.length, passed });
  const settle = (bi, r) => {
    results[bi] = r;
    if (r.ok) { done++; passed += r.groups.reduce((n, g) => n + g.kept.length, 0); report(); }
  };
  report();
  await inParallel(batches, PARALLEL_GROUPS, async (b, bi) => settle(bi, await attempt(b, bi)));
  // A group that failed (overloaded API, dropped connection) gets one more try.
  for (let bi = 0; bi < batches.length; bi++) {
    if (!results[bi].ok) settle(bi, await attempt(batches[bi], bi));
  }

  const ok = results.filter(r => r.ok);
  const failed = results.find(r => !r.ok)?.error ?? null;
  if (!ok.length) return { ok: false, error: failed };
  return {
    ok: true,
    groups: ok.flatMap(r => r.groups),
    written: ok.reduce((n, r) => n + r.written, 0),
    reviewed: ok.every(r => r.reviewed),
    partial: failed,
  };
}

// Smaller groups finish sooner and run in parallel; 4 concepts per call keeps
// each response short while still letting the writer see related ideas.
const GROUP_SIZE = 4;
const PARALLEL_GROUPS = 6;

/** Split each section's chosen concepts into evenly sized groups of at most GROUP_SIZE. */
export function splitBatches(sections, size = GROUP_SIZE) {
  const batches = [];
  for (const s of sections) {
    const chosen = s.concepts.filter(c => c.selected);
    if (!chosen.length) continue;
    const n = Math.ceil(chosen.length / size);
    const per = Math.ceil(chosen.length / n);
    for (let i = 0; i < chosen.length; i += per) batches.push({ section: s, concepts: chosen.slice(i, i + per) });
  }
  return batches;
}

/** Run fn over items with at most `limit` in flight at once. */
export async function inParallel(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Questions that passed the gate carry a `warnings` array; ones you kept
// despite the gate dropping them don't.
const passedGate = (q) => Array.isArray(q.warnings);

/**
 * Turn an extraction + reviewed questions into records ready for the store.
 * Only questions still selected are added; a concept with no selected
 * questions is left out (it would never come up in a session anyway).
 */
export function buildImport({ state, courseId, extraction, groups, sourceLabel = "" }) {
  const ix = index(state);
  const existing = ix.conceptsByCourse[courseId] || [];
  const byName = new Map(existing.map(c => [c.name.trim().toLowerCase(), c.id]));
  let order = Math.max(-1, ...(ix.sectionsByCourse[courseId] || []).map(s => s.order)) + 1;

  const chosenByKey = {};
  for (const g of groups) {
    const qs = [...g.kept, ...g.dropped].filter(q => q.selected);
    if (qs.length) chosenByKey[g.conceptKey] = qs;
  }

  const sections = [], concepts = [], items = [], edges = [];
  const keyToId = {};

  for (const s of extraction.sections) {
    const chosen = s.concepts.filter(c => c.selected && chosenByKey[c.key]);
    if (!chosen.length) continue;
    const section = makeSection({ courseId, title: s.title, summary: s.summary || "", order: order++, sourceLabel });
    sections.push(section);
    chosen.forEach((c, i) => {
      const concept = makeConcept({
        courseId, sectionId: section.id, name: c.name.trim(), summary: c.summary || "",
        kind: c.kind || "definition", importance: IMPORTANCE[c.importance] ? c.importance : "supporting", order: i,
        source: c.excerpt || c.location ? { excerpt: c.excerpt || "", location: c.location || "", label: sourceLabel } : null,
        importanceReason: c.importance_reason || "",
      });
      concepts.push(concept);
      keyToId[c.key] = concept.id;
      byName.set(concept.name.toLowerCase(), concept.id);
      for (const q of chosenByKey[c.key]) {
        items.push(makeItem({
          conceptId: concept.id, ability: q.ability, prompt: q.prompt, answer: q.answer,
          accept: q.ability === "recall" ? q.accept : [],
          points: q.points.length ? q.points : [q.answer],
          misconceptions: q.misconceptions, hint: q.hint,
          quality: { score: q.score, dims: q.dims, revised: Boolean(q.revised), reviewed: q.dims != null, overruled: !passedGate(q) },
        }));
      }
    });
  }

  const conceptById = Object.fromEntries(concepts.map(c => [c.id, c]));
  const nameOf = (id) => conceptById[id]?.name ?? ix.concept[id]?.name ?? "";
  for (const s of extraction.sections) {
    for (const c of s.concepts) {
      const to = keyToId[c.key];
      if (!to) continue;
      for (const p of c.prerequisites || []) {
        const from = keyToId[p] ?? byName.get(String(p).trim().toLowerCase());
        if (from && from !== to) {
          edges.push(makeEdge({ type: "prereq", from, to, confidence: 0.8, origin: "extract", why: `${nameOf(to)} builds on ${nameOf(from)}.` }));
        }
      }
    }
  }
  return { sections, concepts, items, edges };
}

/** Step 3 (background): connect new concepts to the rest of your knowledge. */
export async function linkConcepts({ state, conceptIds }) {
  const a = api();
  if (!a || !conceptIds.length) return { ok: false, error: "nothing to link" };
  const ix = index(state);
  const fresh = conceptIds.map(id => ix.concept[id]).filter(Boolean);
  const freshSet = new Set(conceptIds);
  const existing = state.concepts
    .filter(c => !freshSet.has(c.id) && !c.suspended)
    .sort((a2, b) => IMPORTANCE[a2.importance].rank - IMPORTANCE[b.importance].rank)
    .slice(0, 350);
  const fmt = (c) => ({ id: c.id, name: c.name, summary: (c.summary || "").slice(0, 220), course: ix.course[c.courseId]?.name ?? "" });
  const res = wrap(await a.link({ fresh: fresh.map(fmt), existing: existing.map(fmt) }));
  if (!res.ok) return res;
  const known = new Set(state.concepts.map(c => c.id));
  const edges = res.data.links
    .filter(l => known.has(l.from) && known.has(l.to) && l.from !== l.to && l.confidence >= 0.4)
    .map(l => makeEdge({ type: l.type, from: l.from, to: l.to, why: l.why, confidence: Math.min(1, Math.max(0, l.confidence)), origin: "link" }));
  return { ok: true, edges };
}

/** Rubric points for an item (recall items without a rubric get one). */
export function rubricFor(item) {
  if (item.points?.length) return item.points;
  return [`Gives the answer: ${item.answer}`];
}

export async function gradeWithAI(item, concept, answer, followUp = null) {
  const a = api();
  if (!a) return { ok: false, error: "no-bridge" };
  const points = rubricFor(item);
  const res = wrap(await a.grade({
    prompt: item.prompt, modelAnswer: item.answer, points, misconceptions: item.misconceptions || [],
    excerpt: concept?.source?.excerpt || "", answer, followUp,
  }));
  if (!res.ok) return res;
  const d = res.data;
  const raw = points.map((text, i) => ({ text, met: Boolean(d.points[i]?.met), evidence: d.points[i]?.evidence || "" }));
  const full = [answer, followUp?.answer].filter(Boolean).join("\n");
  const checked = verifyPoints(raw, full);
  const corrections = checked.filter(p => p.corrected);
  return {
    ok: true,
    points: checked,
    misconceptionsFound: d.misconceptions_found || [],
    uncertain: Boolean(d.uncertain) && !followUp && !corrections.length,
    followUp: d.follow_up || "",
    // If our checks overruled the grader, its feedback no longer applies.
    feedback: corrections.length ? "" : d.feedback || "",
  };
}

export async function teachBackWithAI({ title, concepts, text }) {
  const a = api();
  if (!a) return { ok: false, error: "AI features need the desktop app." };
  return wrap(await a.teachback({ title, concepts, text }));
}

/**
 * Ask Claude for a better version of a question you reported. The proposal
 * goes through the same rule checks before it's offered.
 * Returns { ok, worthKeeping, reason, question, issues }.
 */
export async function rewriteQuestion({ item, concept, problem, note = "" }) {
  const a = api();
  if (!a?.rewrite) return { ok: false, error: "AI features need the desktop app." };
  const res = wrap(await a.rewrite({
    concept: { name: concept.name, summary: concept.summary, excerpt: concept.source?.excerpt || "" },
    question: { ability: item.ability, prompt: item.prompt, answer: item.answer, points: item.points },
    problem, note,
  }));
  if (!res.ok) return res;
  const q = toQuestion(res.data.question, item.id);
  const lint = lintQuestion(q);
  return { ok: true, worthKeeping: res.data.worth_keeping, reason: res.data.reason, question: q, issues: lint.issues };
}

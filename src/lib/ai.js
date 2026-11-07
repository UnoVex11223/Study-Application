// Renderer-side orchestration of the AI features. The actual API calls run in
// Electron's main process (see electron.cjs) so the API key never reaches the UI.

import { index, makeSection, makeConcept, makeItem, makeEdge, ABILITIES, IMPORTANCE, clampLevel, levelOf } from "./model.js";
import { selectForConcept, lintQuestion, similarity, QUESTION_CAP } from "./quality.js";
import { verifyPoints, normalize } from "./grade.js";
import { parseDiagram, describeDiagram } from "./diagram.js";
import { makeLesson } from "./ladder.js";

export const api = () => (typeof window !== "undefined" && window.tenax?.ai) || null;

export const aiBridge = () => Boolean(api());

export async function aiAvailable() {
  const a = api();
  if (!a?.status) return false;
  try { return Boolean((await a.status()).hasKey); } catch { return false; }
}

const NO_KEY = "Add an Anthropic API key in Settings to use this.";
const wrap = (res) => (res?.ok ? res : { ok: false, error: res?.error === "no-key" ? NO_KEY : res?.error || "Something went wrong." });

/** Call one of the main process's AI handlers by name. */
export async function callAi(method, payload) {
  const a = api();
  if (!a?.[method]) return { ok: false, error: "AI features need the desktop app." };
  try { return wrap(await a[method](payload)); } catch (err) { return { ok: false, error: err?.message || "Something went wrong." }; }
}

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
export async function extractMaterial({ state, courseId, title, location, text, onProgress, alsoKnown = [] }) {
  const a = api();
  if (!a) return { ok: false, error: "AI features need the desktop app." };
  const ix = index(state);
  const course = ix.course[courseId];
  // Concepts already in the course (plus any the caller knows about, e.g. earlier
  // chapters of a book still being imported) can be referenced as prerequisites
  // and aren't extracted again.
  const seen = new Set();
  const known = [...(ix.conceptsByCourse[courseId] || []).map(c => ({ name: c.name, section: ix.section[c.sectionId]?.title })), ...alsoKnown]
    .filter(k => { const n = k.name.trim().toLowerCase(); return !seen.has(n) && seen.add(n); });
  const chunks = splitSource(text);
  const out = { title: title || "", summary: "", sections: [], gaps: [] };

  for (let ci = 0; ci < chunks.length; ci++) {
    onProgress?.({ step: "extract", part: ci + 1, parts: chunks.length });
    const res = wrap(await a.extract({ courseName: course?.name ?? "", title, location, text: chunks[ci], known }));
    if (!res.ok) return out.sections.length ? { ok: true, ...out, partial: res.error } : res;
    const d = res.data;
    if (!out.title && d.title) out.title = d.title;
    if (!out.summary && d.summary) out.summary = d.summary;
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

/** A question as Claude wrote it, in the app's shape. Its diagram (a JSON string) is checked here. */
const toQuestion = (t, id) => {
  const drawn = parseDiagram(t.diagram);
  const level = clampLevel(t.level);
  return {
    id,
    ability: t.ability,
    ...(level ? { level } : {}),
    shape: String(t.shape || "").trim(),
    prompt: String(t.prompt || "").trim(),
    answer: String(t.model_answer || "").trim(),
    // Accepted short answers: a recall term, or the exact value, output or line of code a step asks for.
    accept: [...new Set((t.accept || []).map(x => String(x).trim()).filter(Boolean))],
    points: (t.required_points || []).map(x => String(x).trim()).filter(Boolean),
    misconceptions: (t.misconceptions || []).map(x => String(x).trim()).filter(Boolean),
    hint: String(t.hint || "").trim(),
    diagram: drawn.ok ? drawn.diagram : null,
    ...(drawn.ok ? {} : { diagramError: drawn.error }),
  };
};

/** A question as the reviewer sees it. */
export const forReview = (q) => ({
  id: q.id, concept_key: q.conceptKey, level: levelOf(q), ability: q.ability, shape: q.shape || "", prompt: q.prompt, model_answer: q.answer,
  accept: q.accept, required_points: q.points, misconceptions: q.misconceptions, diagram: q.diagram ? JSON.stringify(q.diagram) : "",
});

/** The lessons Claude wrote, by concept key: { [key]: lesson }. */
export function toLessons(data) {
  const out = {};
  for (const l of data?.lessons || []) {
    const drawn = parseDiagram(l.diagram);
    const lesson = makeLesson({ terms: l.terms, example: l.worked_example, diagram: drawn.ok ? drawn.diagram : null });
    if (l.concept_key && lesson) out[l.concept_key] = lesson;
  }
  return out;
}

/**
 * Step 2: write candidate questions for the chosen concepts, have an
 * independent reviewer score them, and keep only the ones that pass the
 * quality gate (see quality.js).
 * Returns { ok, groups: [{ section, concept, kept, dropped }], written, reviewed, partial }.
 */
export async function generateTasks({ state, courseId, sections, onProgress, courseName: nameOverride }) {
  const a = api();
  if (!a) return { ok: false, error: "AI features need the desktop app." };
  const courseName = nameOverride ?? index(state).course[courseId]?.name ?? "";
  const batches = splitBatches(sections);
  if (!batches.length) return { ok: false, error: "Pick at least one concept." };

  // Each group is written and then reviewed on its own, so groups run side by
  // side instead of one after another. Most of the wait is the model writing
  // text, so this cuts a chapter's wait roughly by the number of groups.
  const runBatch = async ({ section, concepts }, bi) => {
    const r = await writeAndReview({ a, courseName, sectionTitle: section.title, concepts, tag: `q${bi}`, writer: writerOf(state) });
    if (!r.ok) return r;
    const groups = concepts.map(c => {
      // Concepts that already have questions (e.g. a note matching one you study) count those.
      const { kept, dropped } = selectForConcept(r.candidates.filter(q => q.conceptKey === c.key), r.reviews, c.importance,
        { existing: c.existingItems || [], extra: c.extra || 0 });
      return {
        sectionTitle: section.title, conceptKey: c.key, conceptName: c.name, importance: c.importance, reviewed: r.reviewed,
        lesson: r.lessons[c.key] ?? null,
        kept: kept.map(q => ({ ...q, selected: true })),
        dropped: dropped.map(q => ({ ...q, selected: false })),
      };
    });
    return { ok: true, groups, written: r.candidates.length, reviewed: r.reviewed };
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

// How much care (and money) question writing takes: Settings → Question writing.
export const WRITERS = {
  thorough: { label: "Thorough", blurb: "Opus, thinking more. The most careful, and the most expensive." },
  standard: { label: "Standard", blurb: "Opus at its usual effort. Usually about as good, for less." },
  economy: { label: "Economy", blurb: "Sonnet writes, Opus still reviews. Each word costs half as much." },
};
export const writerOf = (state) => (WRITERS[state?.settings?.questionWriting] ? state.settings.questionWriting : "thorough");

// Dollars per concept for writing and reviewing a full ladder, live. Measured
// on November 6, 2026 by rebuilding a 17-concept K&R chapter both ways:
// Thorough 5.8¢ a concept, Standard 5.5¢ (a range around each, since chapters
// differ). Economy isn't measured yet: Sonnet writes at half the price, and
// writing was about three quarters of the cost. The Batch API halves it all.
// Settings → AI and cost shows what calls really cost.
const COST_PER_CONCEPT = { thorough: [0.045, 0.075], standard: [0.04, 0.07], economy: [0.03, 0.05] };

/** [low, high] dollars to write ladders for n concepts with these settings. */
export function ladderCost(n, { writer = "thorough", batch = false } = {}) {
  const [lo, hi] = COST_PER_CONCEPT[writer] ?? COST_PER_CONCEPT.thorough;
  const f = batch ? 0.5 : 1;
  return [n * lo * f, n * hi * f];
}

/** A concept as the question writer sees it. */
export function writerConcept(c) {
  const existing = c.existing ?? c.existingItems?.map(i => i.prompt) ?? [];
  const steps = c.existingSteps ?? c.existingItems?.map(levelOf) ?? [];
  return {
    key: c.key, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance, excerpt: c.excerpt,
    ...(c.current?.length ? { current: c.current } : {}),
    ...(!c.current?.length && existing.length ? { existing, steps, want: c.want ?? 2 } : {}),
  };
}

/**
 * Write candidates for up to a few concepts and have the critic review them.
 * concepts: [{ key, name, summary, kind, importance, excerpt, existing?: [prompt], want?, current?: [prompt] }]
 * (current: rebuilding a concept's questions as a ladder, these are the ones it has now.)
 * Returns { ok, candidates: [{ ...question, conceptKey }], reviews, reviewed, lessons }.
 */
export async function writeAndReview({ a, courseName, sectionTitle, concepts, tag, writer = "thorough" }) {
  const ctx = concepts.map(writerConcept);
  const res = wrap(await a.items({ courseName, sectionTitle, concepts: ctx, writer }));
  if (!res.ok) return { ok: false, error: res.error };
  const candidates = toCandidates(res.data, concepts, tag);
  const lessons = toLessons(res.data);

  let reviews = {};
  const crit = a.critique ? wrap(await a.critique({ courseName, sectionTitle, concepts: ctx, questions: candidates.map(forReview) })) : { ok: false };
  if (crit.ok) reviews = reviewsById(crit.data);
  return { ok: true, candidates, reviews, reviewed: crit.ok, lessons };
}

/** The critic's verdicts by question id, each with its revision attached (revisions come as a separate list). */
export function reviewsById(data) {
  const revisions = Object.fromEntries((data.revisions || []).map(r => [r.id, r]));
  return Object.fromEntries((data.reviews || []).map(r => [r.id, { ...r, revision: r.revision ?? revisions[r.id] ?? null }]));
}

/** The writer's usable candidates for these concepts, with stable ids. */
export function toCandidates(data, concepts, tag) {
  const keys = new Set(concepts.map(c => c.key));
  const raw = (data?.tasks || []).filter(t => keys.has(t.concept_key) && ABILITIES[t.ability] && t.prompt?.trim() && t.model_answer?.trim());
  return raw.map((t, i) => ({ ...toQuestion(t, `${tag}_${i}`), conceptKey: t.concept_key }));
}

/** A question that passed (or was kept past) the gate, as a stored item. */
export function itemFromQuestion(conceptId, q, extra = {}) {
  const level = clampLevel(q.level);
  return makeItem({
    conceptId, ability: q.ability, prompt: q.prompt, answer: q.answer,
    ...(level ? { level } : {}),
    ...(q.shape ? { shape: q.shape } : {}),
    ...(q.diagram ? { diagram: q.diagram } : {}),
    accept: q.accept || [],
    points: q.points.length ? q.points : [q.answer],
    misconceptions: q.misconceptions, hint: q.hint,
    quality: { score: q.score, dims: q.dims, revised: Boolean(q.revised), reviewed: q.dims != null, overruled: !Array.isArray(q.warnings) },
    ...extra,
  });
}

/** Concepts that have room for more questions, with how many more each can take. */
export function roomForQuestions(state, conceptIds) {
  const ix = index(state);
  return conceptIds.map(id => ix.concept[id]).filter(c => c && !c.suspended).map(c => {
    const existing = (ix.itemsByConcept[c.id] || []).filter(i => !i.flag);
    return { concept: c, existing, room: Math.max(0, (QUESTION_CAP[c.importance] ?? 2) - existing.length) };
  }).filter(t => t.room > 0);
}

/**
 * Top up concepts that have fewer questions than their target with new
 * variants that test other facets (the ladder's missing steps). Same writer,
 * critic and gate as new material; what passes is added without a review
 * step. Items (and lessons for concepts that had none) are handed to
 * onItems(items, lessons) as each group finishes, so partial progress is kept.
 * extraSource: { [conceptId]: text } — e.g. a note that should shape new questions.
 */
export async function moreQuestions({ state, conceptIds, onItems, onProgress, extraSource = {} }) {
  const a = api();
  if (!a) return { ok: false, error: "AI features need the desktop app." };
  const ix = index(state);
  const targets = roomForQuestions(state, conceptIds);
  if (!targets.length) return { ok: true, added: 0, concepts: 0 };

  // Groups of up to GROUP_SIZE concepts from the same section.
  const bySection = new Map();
  for (const t of targets) {
    const list = bySection.get(t.concept.sectionId) || [];
    list.push(t);
    bySection.set(t.concept.sectionId, list);
  }
  const batches = [];
  for (const list of bySection.values()) for (let i = 0; i < list.length; i += GROUP_SIZE) batches.push(list.slice(i, i + GROUP_SIZE));

  let done = 0, added = 0, failed = null;
  const touched = new Set();
  onProgress?.({ done, total: batches.length, added });
  const run = async (batch, bi) => {
    const first = batch[0].concept;
    const concepts = batch.map(({ concept: c, existing, room }) => ({
      key: c.id, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance,
      excerpt: [c.source?.excerpt, extraSource[c.id]].filter(Boolean).join("\n"),
      existing: existing.map(i => i.prompt), existingSteps: existing.map(levelOf), want: Math.min(room + 1, 5),
    }));
    const r = await writeAndReview({
      a, courseName: ix.course[first.courseId]?.name ?? "", sectionTitle: ix.section[first.sectionId]?.title ?? "",
      concepts, tag: `m${bi}`, writer: writerOf(state),
    });
    if (!r.ok) return r;
    const items = [];
    const lessons = {};
    for (const { concept: c, existing } of batch) {
      const { kept } = selectForConcept(r.candidates.filter(q => q.conceptKey === c.id), r.reviews, c.importance, { existing });
      for (const q of kept) { items.push(itemFromQuestion(c.id, q, { topUp: true })); touched.add(c.id); }
      if (!c.lesson && r.lessons[c.id]) lessons[c.id] = r.lessons[c.id];
    }
    return { ok: true, items, lessons };
  };
  const attempt = (b, bi) => run(b, bi).catch(err => ({ ok: false, error: err?.message || "Something went wrong." }));
  const settle = (r) => {
    if (r.ok) { if (r.items.length || Object.keys(r.lessons).length) onItems?.(r.items, r.lessons); added += r.items.length; } else failed = r.error;
    done++;
    onProgress?.({ done, total: batches.length, added });
  };
  await inParallel(batches, PARALLEL_GROUPS, async (b, bi) => settle(await attempt(b, bi)));
  if (!added && failed) return { ok: false, error: failed };
  return { ok: true, added, concepts: touched.size, partial: failed };
}

// A rebuilt step this close to an old question is the old question: it keeps its history.
const SAME_QUESTION = 0.85;

/** Questions a rebuild never replaces: ones you wrote yourself and code questions with tests. */
export const keepsOnRebuild = (item) => !item.quality || Boolean(item.tests?.code);

/**
 * Plan one concept's rebuilt ladder from the questions that passed the gate.
 * Old questions the new ladder repeats are kept (their history with them)
 * and moved to their step; your own questions and code questions stay as
 * they are; the rest are replaced.
 * Returns { add: [item], keep: [{ id, patch }], remove: [id] }.
 */
export function planRebuild(concept, existing, kept) {
  const keep = [], add = [], remove = [];
  const mine = existing.filter(keepsOnRebuild);
  const replaceable = existing.filter(i => !keepsOnRebuild(i));
  const reused = new Set();
  // The old question keeps its own prompt and answer but takes the new step's accepted
  // answers, so they have to agree: one of them must appear in its model answer.
  const agrees = (old, q) => !q.accept?.length || q.accept.some(a => normalize(old.answer).includes(normalize(a)));
  for (const q of kept) {
    const old = replaceable.find(i => !reused.has(i.id) && similarity(i.prompt, q.prompt) >= SAME_QUESTION && agrees(i, q));
    if (old) {
      reused.add(old.id);
      keep.push({ id: old.id, patch: { level: clampLevel(q.level) ?? levelOf(old), ...(q.shape ? { shape: q.shape } : {}), ...(q.accept?.length ? { accept: q.accept } : {}), ...(q.diagram ? { diagram: q.diagram } : {}) } });
    } else if (!mine.some(i => similarity(i.prompt, q.prompt) >= SAME_QUESTION)) {
      add.push(itemFromQuestion(concept.id, q, { ladder: true }));
    }
  }
  for (const i of replaceable) if (!reused.has(i.id)) remove.push(i.id);
  return { add, keep, remove };
}

/**
 * Rebuild concepts' questions as ladders: Claude sees each concept and the
 * questions it has now, writes the whole ladder (reusing what already fits),
 * and the same review and gate decide what's kept. Each concept's new ladder
 * is handed to onLadder({ conceptId, add, keep, remove, lesson }) as its group
 * finishes. A concept nothing passed for keeps the questions it had.
 * The concept's memory schedule is never touched.
 */
export async function rebuildLadders({ state, conceptIds, onLadder, onProgress }) {
  const a = api();
  if (!a) return { ok: false, error: "AI features need the desktop app." };
  const ix = index(state);
  const targets = conceptIds.map(id => ix.concept[id]).filter(Boolean);
  if (!targets.length) return { ok: true, rebuilt: 0, concepts: 0 };
  const bySection = new Map();
  for (const c of targets) {
    if (!bySection.has(c.sectionId)) bySection.set(c.sectionId, []);
    bySection.get(c.sectionId).push(c);
  }
  const batches = [];
  for (const list of bySection.values()) for (let i = 0; i < list.length; i += GROUP_SIZE) batches.push(list.slice(i, i + GROUP_SIZE));

  let done = 0, rebuilt = 0, steps = 0, failed = null;
  onProgress?.({ done, total: batches.length, rebuilt, steps });
  const run = async (batch, bi) => {
    const first = batch[0];
    const concepts = batch.map(c => ({
      key: c.id, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance, excerpt: c.source?.excerpt || "",
      current: (ix.itemsByConcept[c.id] || []).map(i => i.prompt),
    }));
    const r = await writeAndReview({
      a, courseName: ix.course[first.courseId]?.name ?? "", sectionTitle: ix.section[first.sectionId]?.title ?? "", concepts, tag: `r${bi}`,
      writer: writerOf(state),
    });
    if (!r.ok) return r;
    const ladders = [];
    for (const c of batch) {
      const existing = ix.itemsByConcept[c.id] || [];
      const { kept } = selectForConcept(r.candidates.filter(q => q.conceptKey === c.id), r.reviews, c.importance);
      if (!kept.length) continue;
      ladders.push({ conceptId: c.id, ...planRebuild(c, existing, kept), lesson: r.lessons[c.id] ?? c.lesson ?? null, steps: kept.length });
    }
    return { ok: true, ladders };
  };
  const attempt = (b, bi) => run(b, bi).catch(err => ({ ok: false, error: err?.message || "Something went wrong." }));
  await inParallel(batches, PARALLEL_GROUPS, async (b, bi) => {
    const r = await attempt(b, bi);
    if (r.ok) for (const l of r.ladders) { onLadder?.(l); rebuilt++; steps += l.steps; } else failed = r.error;
    done++;
    onProgress?.({ done, total: batches.length, rebuilt, steps });
  });
  if (!rebuilt && failed) return { ok: false, error: failed };
  return { ok: true, rebuilt, steps, concepts: targets.length, partial: failed };
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

/**
 * Turn an extraction + reviewed questions into records ready for the store.
 * Only questions still selected are added; a concept with no selected
 * questions is left out (it would never come up in a session anyway).
 */
export function buildImport({ state, courseId, extraction, groups, sourceLabel = "", alsoKnown = [] }) {
  const ix = index(state);
  const existing = [...(ix.conceptsByCourse[courseId] || []), ...alsoKnown];
  const byName = new Map(existing.map(c => [c.name.trim().toLowerCase(), c.id]));
  let order = Math.max(-1, ...(ix.sectionsByCourse[courseId] || []).map(s => s.order)) + 1;

  const chosenByKey = {}, lessonByKey = {};
  for (const g of groups) {
    const qs = [...g.kept, ...g.dropped].filter(q => q.selected);
    if (qs.length) chosenByKey[g.conceptKey] = qs;
    if (g.lesson) lessonByKey[g.conceptKey] = g.lesson;
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
        lesson: lessonByKey[c.key] ?? null,
      });
      concepts.push(concept);
      keyToId[c.key] = concept.id;
      byName.set(concept.name.toLowerCase(), concept.id);
      for (const q of chosenByKey[c.key]) items.push(itemFromQuestion(concept.id, q));
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
  // Links across courses only: within a course, prerequisites come from
  // extraction (which sees the course's other concepts). With nothing else to
  // link to, skip the call entirely.
  const courses = new Set(fresh.map(c => c.courseId));
  const existing = state.concepts
    .filter(c => !courses.has(c.courseId) && !c.suspended)
    .sort((a2, b) => IMPORTANCE[a2.importance].rank - IMPORTANCE[b.importance].rank || a2.createdAt - b.createdAt)
    .slice(0, 350);
  if (!existing.length) return { ok: true, edges: [] };
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

/** The question as text, with its diagram described, for the grader and Go deeper (they can't see the drawing). */
const withDiagram = (item) => (item.diagram ? `${item.prompt}\n\nThe question shows this diagram (as JSON): ${describeDiagram(item.diagram)}` : item.prompt);

export async function gradeWithAI(item, concept, answer, followUp = null) {
  const a = api();
  if (!a) return { ok: false, error: "no-bridge" };
  const points = rubricFor(item);
  const res = wrap(await a.grade({
    prompt: withDiagram(item), modelAnswer: item.answer, points, misconceptions: item.misconceptions || [],
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

const conceptCtx = (concept) => ({ name: concept?.name ?? "", summary: concept?.summary ?? "", excerpt: concept?.source?.excerpt ?? "" });

/**
 * Go deeper: the interviewer's next step. `turns` are the follow-ups so far,
 * the last one answered. Returns { ok, lastVerdict, lastFeedback, next, gap }.
 */
export async function probeWithAI({ item, concept, answer, turns = [], last = false }) {
  const res = await callAi("probe", {
    concept: conceptCtx(concept), question: withDiagram(item), modelAnswer: item.answer, answer,
    turns: turns.map(t => ({ question: t.question, answer: t.answer })), last,
  });
  if (!res.ok) return res;
  const d = res.data;
  return {
    ok: true, lastVerdict: d.last_verdict, lastFeedback: String(d.last_feedback || "").trim(),
    next: String(d.next_question || "").trim(), gap: String(d.gap || "").trim(),
  };
}

/**
 * A fresh version of a question you've answered before: same idea and skill,
 * a new example. It has to pass the same rule checks as any new question.
 * Returns { ok, question } (prompt, answer, points, misconceptions, hint).
 */
export async function freshVersion({ item, concept }) {
  const res = await callAi("variant", {
    concept: conceptCtx(concept),
    question: {
      ability: item.ability, level: item.level ?? null, shape: item.shape || "", prompt: item.prompt, answer: item.answer,
      accept: item.accept || [], points: item.points, misconceptions: item.misconceptions, diagram: item.diagram ? JSON.stringify(item.diagram) : "",
    },
  });
  if (!res.ok) return res;
  const q = toQuestion({ ...res.data, ability: item.ability, level: item.level ?? null }, item.id);
  // A question with a picture needs a new picture: the old one would give the old answer away.
  if (item.diagram && !q.diagram) return { ok: false, error: "The fresh version lost its diagram." };
  if (!q.points.length || !lintQuestion(q).ok) return { ok: false, error: "The fresh version didn't pass the checks." };
  if (q.prompt.replace(/\s+/g, " ") === item.prompt.replace(/\s+/g, " ")) return { ok: false, error: "Same as the original." };
  return { ok: true, question: { prompt: q.prompt, answer: q.answer, shape: q.shape || item.shape || "", accept: q.accept, points: q.points, misconceptions: q.misconceptions, hint: q.hint, diagram: q.diagram } };
}

/** Claude writes tests for a code question. Returns { ok, tests, notes }. */
export async function writeTests({ lang, prompt, answer }) {
  const res = await callAi("tests", { lang, prompt, answer });
  if (!res.ok) return res;
  return { ok: true, tests: String(res.data.tests || "").trim(), notes: String(res.data.notes || "").trim() };
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
    question: { ability: item.ability, level: levelOf(item), shape: item.shape || "", prompt: item.prompt, answer: item.answer, points: item.points, diagram: item.diagram ? JSON.stringify(item.diagram) : "" },
    problem, note,
  }));
  if (!res.ok) return res;
  const q = toQuestion({ level: levelOf(item), ...res.data.question }, item.id);
  const lint = lintQuestion(q);
  return { ok: true, worthKeeping: res.data.worth_keeping, reason: res.data.reason, question: q, issues: lint.issues };
}

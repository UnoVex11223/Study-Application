// Renderer-side orchestration of the AI features. The actual API calls run in
// Electron's main process (see electron.cjs) so the API key never reaches the UI.

import { index, makeSection, makeConcept, makeItem, makeEdge, ABILITIES, IMPORTANCE } from "./model.js";

const api = () => (typeof window !== "undefined" && window.aeroflash?.ai) || null;

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

/** Step 2: write practice tasks (with rubrics) for the selected concepts, section by section. */
export async function generateTasks({ state, courseId, sections, onProgress }) {
  const a = api();
  if (!a) return { ok: false, error: "AI features need the desktop app." };
  const courseName = index(state).course[courseId]?.name ?? "";
  const batches = [];
  for (const s of sections) {
    const chosen = s.concepts.filter(c => c.selected);
    for (let i = 0; i < chosen.length; i += 10) batches.push({ section: s, concepts: chosen.slice(i, i + 10) });
  }
  const tasks = [];
  let failed = null;
  for (let bi = 0; bi < batches.length; bi++) {
    const { section, concepts } = batches[bi];
    onProgress?.({ step: "tasks", part: bi + 1, parts: batches.length, section: section.title });
    const res = wrap(await a.items({
      courseName, sectionTitle: section.title,
      concepts: concepts.map(c => ({ key: c.key, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance, excerpt: c.excerpt })),
    }));
    if (!res.ok) { failed = res.error; break; }
    const keys = new Set(concepts.map(c => c.key));
    tasks.push(...res.data.tasks.filter(t => keys.has(t.concept_key) && t.prompt?.trim() && t.model_answer?.trim()));
  }
  if (!tasks.length && failed) return { ok: false, error: failed };
  return { ok: true, tasks, partial: failed };
}

/**
 * Turn an extraction + generated tasks into records ready for the store.
 * Concepts without generated tasks get a basic "explain" task from their summary.
 */
export function buildImport({ state, courseId, extraction, tasks, sourceLabel = "" }) {
  const ix = index(state);
  const existing = ix.conceptsByCourse[courseId] || [];
  const byName = new Map(existing.map(c => [c.name.trim().toLowerCase(), c.id]));
  let order = Math.max(-1, ...(ix.sectionsByCourse[courseId] || []).map(s => s.order)) + 1;

  const sections = [], concepts = [], items = [], edges = [];
  const keyToId = {};

  for (const s of extraction.sections) {
    const chosen = s.concepts.filter(c => c.selected);
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

  for (const t of tasks) {
    const conceptId = keyToId[t.concept_key];
    if (!conceptId || !ABILITIES[t.ability]) continue;
    const points = (t.required_points || []).map(p => p.trim()).filter(Boolean);
    items.push(makeItem({
      conceptId, ability: t.ability, prompt: t.prompt.trim(), answer: t.model_answer.trim(),
      accept: t.ability === "recall" ? (t.accept || []).map(x => x.trim()).filter(Boolean) : [],
      points: points.length ? points : [t.model_answer.trim()],
      misconceptions: (t.misconceptions || []).map(m => m.trim()).filter(Boolean),
      hint: (t.hint || "").trim(),
    }));
  }
  const covered = new Set(items.map(i => i.conceptId));
  for (const c of concepts) {
    if (covered.has(c.id)) continue;
    items.push(makeItem({
      conceptId: c.id, ability: "explain",
      prompt: `Explain **${c.name}** in your own words.`, answer: c.summary || c.name,
      points: [c.summary || c.name],
    }));
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
  return {
    ok: true,
    points: points.map((text, i) => ({ text, met: Boolean(d.points[i]?.met), evidence: d.points[i]?.evidence || "" })),
    misconceptionsFound: d.misconceptions_found || [],
    uncertain: Boolean(d.uncertain) && !followUp,
    followUp: d.follow_up || "",
    feedback: d.feedback || "",
  };
}

export async function teachBackWithAI({ title, concepts, text }) {
  const a = api();
  if (!a) return { ok: false, error: "AI features need the desktop app." };
  return wrap(await a.teachback({ title, concepts, text }));
}

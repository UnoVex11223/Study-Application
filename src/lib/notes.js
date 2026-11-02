// Notes: things you want to remember that come from projects, docs and
// everyday work rather than a course. Claude files each idea under a broad
// area ("Web development", "Security"…), and each area is a course of its own
// (kind "notes"), with a section per topic ("Authentication", "REST APIs"), so
// it gets its own place on Today and on the map. Areas are made as notes need
// them, and can be regrouped into broader ones later. An idea you already
// study, in any course, is left out; a related one is linked to it on the map.
//
//   note { id, text, context, source, createdAt, hash, force?,
//          status: inbox | done | skipped, reason?, result?: { conceptIds, covered } }

import { index, makeCourse, makeSection, makeConcept, makeEdge, removeConcepts, uid, IMPORTANCE } from "./model.js";
import { callAi, generateTasks, itemFromQuestion } from "./ai.js";

// ── Splitting and fingerprints ─────────────────────────────────────────────
const MIN_CHARS = 12;
const MAX_CHARS = 1500;

/** Stable fingerprint of a note's text, ignoring case and spacing. */
export function noteHash(text) {
  const s = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Split a notes file into individual notes: one per list item (with its
 * sub-items) or paragraph, keeping fenced code with the text around it, and
 * carrying the nearest heading along as context.
 * Returns [{ text, context }].
 */
export function splitNotes(raw, { context = "" } = {}) {
  const lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let heading = "", buf = [], inFence = false;
  const flush = () => {
    // A list item's own marker isn't part of the note ("- WAL mode…" → "WAL mode…").
    const text = buf.join("\n").replace(/\s+$/g, "").replace(/^\n+/, "").replace(/^([-*+]|\d+[.)])\s+/, "");
    buf = [];
    if (text.replace(/[\s#*`>-]/g, "").length < MIN_CHARS) return;
    const ctx = [context, heading].filter(Boolean).join(" › ");
    if (text.length <= MAX_CHARS) { out.push({ text, context: ctx }); return; }
    // Very long block: cut at sentence ends into roughly even parts.
    let part = "";
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (part && part.length + sentence.length > MAX_CHARS) { out.push({ text: part, context: ctx }); part = ""; }
      part += (part ? " " : "") + sentence;
    }
    if (part) out.push({ text: part, context: ctx });
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; buf.push(line); continue; }
    if (inFence) { buf.push(line); continue; }
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { flush(); heading = h[1].trim(); continue; }
    if (!line.trim()) {
      // A blank line ends a paragraph, but not a list item followed by its code block.
      if (buf.length) flush();
      continue;
    }
    // A new top-level list item starts a new note.
    if (/^([-*+]|\d+[.)])\s+/.test(line) && buf.length && !/^\s*```/.test(buf.at(-1))) flush();
    buf.push(line);
  }
  flush();
  return out;
}

/** Notes ready to add to the inbox, minus any you've added before. */
export function newNotes(state, pieces, { source = "", createdAt = Date.now() } = {}) {
  const seen = new Set((state.notes || []).map(n => n.hash));
  const fresh = [];
  let duplicates = 0;
  for (const p of pieces) {
    const hash = noteHash(p.text);
    if (seen.has(hash)) { duplicates++; continue; }
    seen.add(hash);
    fresh.push({ id: uid("n"), text: p.text, context: p.context || "", source, createdAt, hash, status: "inbox" });
  }
  return { notes: fresh, duplicates };
}

// ── Areas ──────────────────────────────────────────────────────────────────
/** The courses made from your notes, one per area. */
export const noteAreas = (state) => state.courses.filter(c => c.kind === "notes");

// Earlier versions kept every note in one course called "Notes", a section per topic.
const OLD_SPACE = "Notes";
const oldSpace = (state) => state.courses.find(c => c.kind === "notes" && c.name === OLD_SPACE) || null;
export const hasNotesSpace = (state) => Boolean(oldSpace(state));

/**
 * Turn the old single Notes course into areas: each topic becomes a course of
 * its own. The old course keeps its first topic (renamed after it) and every
 * other topic moves to a new course, concepts and history included. New ids
 * come from the topic's id, so two computers doing this end up with the same
 * courses.
 */
export function splitNotesSpace(state) {
  const space = oldSpace(state);
  if (!space) return state;
  const [first, ...rest] = index(state).sectionsByCourse[space.id] || [];
  if (!first) return { ...state, courses: state.courses.filter(c => c !== space) };
  const moveTo = new Map();
  const added = rest.map((s, i) => {
    const course = makeCourse({ id: `c_${s.id}`, name: s.title, kind: "notes", createdAt: space.createdAt }, state.courses.length + i);
    moveTo.set(s.id, course.id);
    return course;
  });
  return {
    ...state,
    courses: [...state.courses.map(c => (c === space ? { ...c, name: first.title } : c)), ...added],
    sections: state.sections.map(s => (moveTo.has(s.id) ? { ...s, courseId: moveTo.get(s.id), order: 0 } : s)),
    concepts: state.concepts.map(k => (moveTo.has(k.sectionId) ? { ...k, courseId: moveTo.get(k.sectionId) } : k)),
  };
}

/** Ask Claude to put your topics into a few broad areas. Returns { ok, moves: [{ sectionId, area, topic }] }. */
export async function planRegroup(state) {
  const ix = index(state);
  const areas = noteAreas(state).map(c => ({
    name: c.name,
    topics: (ix.sectionsByCourse[c.id] || []).map(s => ({ id: s.id, name: s.title, concepts: (ix.conceptsBySection[s.id] || []).slice(0, 12).map(k => k.name) })),
  }));
  if (!areas.length) return { ok: false, error: "There are no areas to regroup yet." };
  const res = await callAi("areas", { areas });
  if (!res.ok) return res;
  const moves = (res.data.topics || [])
    .filter(t => ix.section[t.id] && t.area?.trim())
    .map(t => ({ sectionId: t.id, area: t.area.trim(), topic: (t.topic || "").trim() || ix.section[t.id].title }));
  return moves.length ? { ok: true, moves } : { ok: false, error: "Claude didn't regroup anything. Try again." };
}

/**
 * Move topics into the areas Claude chose for them: [{ sectionId, area, topic }].
 * An area keeps the course already called that; otherwise the course giving
 * it the most concepts is renamed for it (so its colour and place stay), or
 * a new one is made. Topics that end up with the same name in an area become
 * one, and areas left with no topics go. Concepts keep their history.
 */
export function regroupAreas(state, moves, now = Date.now()) {
  const ix = index(state);
  const areas = noteAreas(state);
  const isArea = new Set(areas.map(c => c.id));
  const plan = new Map(moves.filter(m => nameKey(m.area || "") && isArea.has(ix.section[m.sectionId]?.courseId)).map(m => [m.sectionId, m]));
  if (!plan.size) return state;

  // 1. A course for each area named.
  const targets = new Map();
  for (const m of plan.values()) {
    const k = nameKey(m.area);
    if (!targets.has(k)) targets.set(k, { name: m.area.trim(), moves: [] });
    targets.get(k).moves.push(m);
  }
  const courseOf = new Map(), claimed = new Set(), names = new Map(), added = [];
  for (const [k] of targets) {
    const same = areas.find(c => nameKey(c.name) === k);
    if (same) { courseOf.set(k, same.id); claimed.add(same.id); }
  }
  const taken = new Set(state.courses.map(c => c.id));
  for (const [k, t] of targets) {
    if (courseOf.has(k)) continue;
    const gives = {};
    for (const m of t.moves) {
      const from = ix.section[m.sectionId].courseId;
      gives[from] = (gives[from] || 0) + 1 + (ix.conceptsBySection[m.sectionId] || []).length;
    }
    let id = Object.keys(gives).filter(c => !claimed.has(c)).sort((a, b) => gives[b] - gives[a])[0];
    if (id) names.set(id, t.name);
    else {
      // Made from the first topic's id, so it reads the same on every computer.
      id = `c_${t.moves[0].sectionId}`;
      while (taken.has(id)) id += "_";
      added.push(makeCourse({ id, name: t.name, kind: "notes", createdAt: now }, state.courses.length + added.length));
      taken.add(id);
    }
    courseOf.set(k, id); claimed.add(id);
  }

  // 2. Topics into their areas: those already there keep their place, the
  // rest follow; a topic named like one already in the area merges into it.
  const rank = Object.fromEntries(state.courses.map((c, i) => [c.id, i]));
  const target = (s) => (plan.has(s.id) ? courseOf.get(nameKey(plan.get(s.id).area)) : s.courseId);
  const stays = (s) => (target(s) === s.courseId ? 0 : 1);
  const order = state.sections.filter(s => isArea.has(s.courseId))
    .sort((a, b) => stays(a) - stays(b) || rank[a.courseId] - rank[b.courseId] || a.order - b.order);
  const home = new Map(), into = new Map(), place = new Map(), count = {};
  for (const s of order) {
    const courseId = target(s), title = plan.get(s.id)?.topic || s.title, k = `${courseId}|${nameKey(title)}`;
    if (home.has(k)) { into.set(s.id, home.get(k)); continue; }
    home.set(k, s.id);
    count[courseId] = (count[courseId] ?? -1) + 1;
    place.set(s.id, { courseId, title, order: count[courseId] });
  }
  const sections = state.sections.filter(s => !into.has(s.id)).map(s => {
    const p = place.get(s.id);
    return p && (p.courseId !== s.courseId || p.title !== s.title || p.order !== s.order) ? { ...s, ...p } : s;
  });

  // 3. Concepts follow their topic; merged ones go after the topic's own.
  const next = {};
  const concepts = state.concepts.map(c => {
    const sectionId = into.get(c.sectionId) ?? c.sectionId;
    const p = place.get(sectionId);
    if (!p || (sectionId === c.sectionId && p.courseId === c.courseId)) return c;
    if (sectionId === c.sectionId) return { ...c, courseId: p.courseId };
    next[sectionId] ??= Math.max(-1, ...(ix.conceptsBySection[sectionId] || []).map(k => k.order)) + 1;
    return { ...c, sectionId, courseId: p.courseId, order: next[sectionId]++ };
  });

  const used = new Set(sections.map(s => s.courseId));
  const courses = [...state.courses, ...added]
    .filter(c => !isArea.has(c.id) || used.has(c.id))
    .map(c => (names.has(c.id) && names.get(c.id) !== c.name ? { ...c, name: names.get(c.id) } : c));
  return { ...state, courses, sections, concepts };
}

// ── Processing ─────────────────────────────────────────────────────────────
const BATCH_NOTES = 12, BATCH_CHARS = 10000;

export function batchNotes(notes) {
  const batches = [];
  let cur = [], size = 0;
  for (const n of notes) {
    if (cur.length && (cur.length >= BATCH_NOTES || size + n.text.length > BATCH_CHARS)) { batches.push(cur); cur = []; size = 0; }
    cur.push(n); size += n.text.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const STOP = new Set("the and for are but not you all any can had her was one our out has have from that this with what when your into than then them they will just like also only more most such very used uses using".split(" "));
const words = (text) => String(text).toLowerCase().match(/[a-z][a-z0-9_]{2,}/g)?.filter(w => !STOP.has(w)) ?? [];

/**
 * Concepts a note can match or link to: everything you study. The likeliest
 * matches for these notes (by shared words) come with their summaries; the
 * rest are listed by name only, which is enough to recognize a match and
 * keeps the prompt small. The list is the same for every batch of a run, so
 * it's cached after the first.
 */
function knownConcepts(state, notes, { limit = 700, detailed = 80 } = {}) {
  const ix = index(state);
  const vocab = new Set(words(notes.map(n => `${n.text} ${n.context || ""}`).join(" ")));
  const scored = state.concepts
    .filter(c => !c.suspended)
    .map(c => {
      const name = words(c.name), summary = words(c.summary);
      const score = 2 * name.filter(w => vocab.has(w)).length + summary.filter(w => vocab.has(w)).length;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score || IMPORTANCE[a.c.importance].rank - IMPORTANCE[b.c.importance].rank)
    .slice(0, limit);
  return scored.map(({ c, score }, i) => ({
    id: c.id, name: c.name, course: ix.course[c.courseId]?.name ?? "",
    summary: i < detailed && score > 0 ? (c.summary || "").replace(/\s+/g, " ").slice(0, 160) : "",
  }));
}

const NOTE_EXCERPT = 900;
/** A name for comparing: case, punctuation and spacing don't count. */
export const nameKey = (name) => {
  const s = String(name).toLowerCase().trim();
  return s.replace(/[^a-z0-9]+/g, " ").trim() || s;
};

/**
 * Turn inbox notes into reviewable results.
 * Returns { ok, entries: [{ note, outcome, reason, covered: [{ id, name, course }],
 *   concepts: [{ key, name, summary, kind, importance, area, topic, filledIn, corrected, related, group }] }], partial }.
 * `covered` is what a note says that you already study (left out); a note
 * with nothing else is skipped. Keep anyway (force) brings it in regardless.
 */
export async function processNotes({ state, noteIds, onProgress }) {
  const ix = index(state);
  const notes = noteIds.map(id => state.notes.find(n => n.id === id)).filter(Boolean);
  if (!notes.length) return { ok: false, error: "No notes to process." };
  const areas = noteAreas(state).map(c => ({ name: c.name, topics: (ix.sectionsByCourse[c.id] || []).map(s => s.title) }));
  const known = knownConcepts(state, notes);
  // A concept named exactly like one you study is covered, even if Claude didn't say so.
  const byName = new Map(state.concepts.map(c => [nameKey(c.name), c.id]));
  const thisRun = new Set(); // ideas already taken from an earlier note of this run
  const coveredBy = (id) => ({ id, name: ix.concept[id].name, course: ix.course[ix.concept[id].courseId]?.name ?? "" });

  // 1. Sort out what each note holds and where it belongs.
  const batches = batchNotes(notes);
  const classified = [];
  let failed = null, done = 0;
  onProgress?.({ step: "read", done, total: batches.length });
  for (const batch of batches) {
    const res = await callAi("notes", {
      areas, known,
      notes: batch.map(n => ({ id: n.id, text: n.text, context: n.context, force: Boolean(n.force) })),
    });
    done++;
    onProgress?.({ step: "read", done, total: batches.length });
    if (!res.ok) { failed = res.error; continue; }
    const byId = Object.fromEntries(res.data.notes.map(r => [r.note_id, r]));
    for (const n of batch) {
      const r = byId[n.id];
      if (!r) { classified.push({ note: n, outcome: "error", reason: "Claude didn't return this note; process it again.", concepts: [], covered: [] }); continue; }
      const concepts = [], covered = [];
      for (const c of r.outcome === "keep" ? r.concepts : []) {
        if (!c.name?.trim() || !c.summary?.trim()) continue;
        const key = nameKey(c.name);
        const same = n.force ? "" : (ix.concept[c.same_as] ? c.same_as : byName.get(key) || "");
        if (same) { covered.push(coveredBy(same)); continue; }
        if (!n.force && thisRun.has(key)) { covered.push({ id: "", name: c.name.trim(), course: "" }); continue; }
        thisRun.add(key);
        const area = (c.area || c.topic || "").trim() || "General";
        concepts.push({
          key: `${n.id}:${c.key}`,
          name: c.name.trim(), summary: c.summary.trim(), kind: c.kind || "definition",
          importance: IMPORTANCE[c.importance] ? c.importance : "supporting",
          area, topic: (c.topic || "").trim() || area,
          filledIn: Boolean(c.filled_in), corrected: (c.corrected || "").trim(),
          related: (c.related || []).filter(l => ix.concept[l.id]).slice(0, 2),
        });
      }
      if (concepts.length) { classified.push({ note: n, outcome: "keep", reason: "", concepts, covered }); continue; }
      const reason = covered.length
        ? `Already covered: ${covered.map(c => c.name).join(", ")}.`
        : r.reason || "Nothing definite to remember.";
      classified.push({ note: n, outcome: "skip", reason, concepts: [], covered });
    }
  }
  if (!classified.length) return { ok: false, error: failed || "Couldn't process these notes." };

  // 2. Questions for the new ideas, grouped by area and topic.
  const sections = new Map();
  for (const e of classified) {
    for (const c of e.concepts) {
      const k = nameKey(`${c.area} ${c.topic}`);
      if (!sections.has(k)) sections.set(k, { title: `${c.area} › ${c.topic}`, concepts: [] });
      const excerpt = [e.note.text.slice(0, NOTE_EXCERPT), c.corrected && `Correction: ${c.corrected}`].filter(Boolean).join("\n");
      sections.get(k).concepts.push({ key: c.key, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance, selected: true, excerpt });
    }
  }
  let groups = [];
  if (sections.size) {
    onProgress?.({ step: "write" });
    const res = await generateTasks({ state, courseName: "Your notes", sections: [...sections.values()] });
    if (res.ok) { groups = res.groups; if (res.partial) failed = res.partial; } else failed = res.error;
  }
  const groupOf = Object.fromEntries(groups.map(g => [g.conceptKey, g]));
  const entries = classified.map(e => ({ ...e, concepts: e.concepts.map(c => ({ ...c, group: groupOf[c.key] || null })) }));
  return { ok: true, entries, partial: failed };
}

// ── Saving ─────────────────────────────────────────────────────────────────
const selectedOf = (g) => (g ? [...g.kept, ...g.dropped].filter(q => q.selected) : []);

/**
 * Store records for reviewed note results, plus each note's new status.
 * Creates the areas (courses) and topics (sections) the new concepts need.
 */
export function buildNotesImport({ state, entries, now = Date.now() }) {
  const ix = index(state);
  const courses = [], sections = [], concepts = [], items = [], edges = [], noteUpdates = [];
  const areas = new Map(noteAreas(state).map(c => [nameKey(c.name), c]));
  const topics = new Map();
  for (const c of areas.values()) for (const s of ix.sectionsByCourse[c.id] || []) topics.set(`${c.id}|${nameKey(s.title)}`, s);
  const nextTopic = {}, nextConcept = {}; // the order the next section or concept takes

  const areaFor = (name) => {
    const k = nameKey(name);
    if (!areas.has(k)) {
      const course = makeCourse({ name, kind: "notes", createdAt: now }, state.courses.length + courses.length);
      courses.push(course); areas.set(k, course);
    }
    return areas.get(k);
  };
  const topicFor = (course, title) => {
    const k = `${course.id}|${nameKey(title)}`;
    if (!topics.has(k)) {
      nextTopic[course.id] ??= Math.max(-1, ...(ix.sectionsByCourse[course.id] || []).map(s => s.order)) + 1;
      const s = makeSection({ courseId: course.id, title, order: nextTopic[course.id]++ });
      sections.push(s); topics.set(k, s);
    }
    return topics.get(k);
  };
  const date = new Date(now).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  for (const e of entries) {
    if (e.outcome === "error") continue; // stays in the inbox
    const covered = (e.covered || []).map(c => c.id).filter(Boolean);
    if (e.outcome !== "keep") {
      noteUpdates.push({ id: e.note.id, patch: { status: "skipped", reason: e.reason, processedAt: now, force: false, result: { conceptIds: [], covered } } });
      continue;
    }
    const conceptIds = [];
    for (const c of e.concepts) {
      const qs = selectedOf(c.group);
      if (!qs.length) continue;
      const course = areaFor(c.area);
      const section = topicFor(course, c.topic);
      nextConcept[section.id] ??= (ix.conceptsBySection[section.id] || []).length;
      const concept = makeConcept({
        courseId: course.id, sectionId: section.id, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance,
        order: nextConcept[section.id]++,
        source: { excerpt: e.note.text.slice(0, NOTE_EXCERPT), location: "", label: `Your note${e.note.context ? ` (${e.note.context})` : ""}, ${date}` },
        noteId: e.note.id, filledIn: c.filledIn, corrected: c.corrected,
      });
      concepts.push(concept);
      conceptIds.push(concept.id);
      for (const q of qs) items.push(itemFromQuestion(concept.id, q, { fromNote: e.note.id }));
      for (const l of c.related) {
        edges.push(makeEdge({ type: ["related", "contrast", "application"].includes(l.type) ? l.type : "related", from: concept.id, to: l.id, why: l.why || "", confidence: 0.8, origin: "note" }));
      }
    }
    const noneKept = e.concepts.every(c => !c.group || c.group.kept.length === 0);
    noteUpdates.push(conceptIds.length
      ? { id: e.note.id, patch: { status: "done", processedAt: now, force: false, result: { conceptIds, covered } } }
      : { id: e.note.id, patch: { status: "skipped", processedAt: now, force: false, result: { conceptIds: [], covered },
          reason: noneKept ? "No question for it passed the quality check." : "You left out all of its questions." } });
  }
  return { courses, sections, concepts, items, edges, noteUpdates };
}

// ── Deleting ───────────────────────────────────────────────────────────────
/** The concepts made from these notes. */
export const madeFrom = (state, ids) => {
  const notes = new Set(ids);
  return state.concepts.filter(c => notes.has(c.noteId));
};

/**
 * Delete notes and everything made from them: their concepts (with their
 * questions, links and review history) and any questions they added to other
 * concepts. A topic or area left empty goes too.
 */
export function deleteNotes(state, ids) {
  const gone = new Set(ids);
  const made = madeFrom(state, ids);
  let next = removeConcepts(state, made.map(c => c.id));
  next = {
    ...next,
    notes: next.notes.filter(n => !gone.has(n.id)),
    items: next.items.some(i => gone.has(i.fromNote)) ? next.items.filter(i => !gone.has(i.fromNote)) : next.items,
  };
  const areas = new Set(noteAreas(next).map(c => c.id));
  const touched = new Set(made.map(c => c.sectionId));
  const used = new Set(next.concepts.map(c => c.sectionId));
  const empty = new Set(next.sections.filter(s => touched.has(s.id) && areas.has(s.courseId) && !used.has(s.id)).map(s => s.id));
  if (!empty.size) return next;
  const sections = next.sections.filter(s => !empty.has(s.id));
  const left = new Set(sections.map(s => s.courseId));
  const emptied = new Set(made.map(c => c.courseId).filter(id => areas.has(id) && !left.has(id)));
  return { ...next, sections, courses: emptied.size ? next.courses.filter(c => !emptied.has(c.id)) : next.courses };
}

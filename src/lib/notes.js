// Notes: things you want to remember that come from projects, docs and
// everyday work rather than a course. They live in their own "Notes" space
// (a course with kind "notes", organized by topic) so they never stretch a
// course's totals. A note that restates an idea you already have becomes
// extra questions on that concept instead of a new one; a related note is
// linked to it on the map.
//
//   note { id, text, context, source, createdAt, hash, force?,
//          status: inbox | done | skipped, reason?, result?: { conceptIds, merged } }

import { index, makeCourse, makeSection, makeConcept, makeEdge, uid, IMPORTANCE } from "./model.js";
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

export const notesCourse = (state) => state.courses.find(c => c.kind === "notes") || null;

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
// Notes may add a question to a concept that already has its full set: your
// own example is worth a slot.
const NOTE_EXTRA = 1;

/**
 * Turn inbox notes into reviewable results.
 * Returns { ok, entries: [{ note, outcome, reason, concepts: [{ key, name, summary, kind, importance,
 *   topic, filledIn, corrected, sameAs, related, group }] }], partial }.
 */
export async function processNotes({ state, noteIds, onProgress }) {
  const ix = index(state);
  const notes = noteIds.map(id => state.notes.find(n => n.id === id)).filter(Boolean);
  if (!notes.length) return { ok: false, error: "No notes to process." };
  const nc = notesCourse(state);
  const topics = nc ? (ix.sectionsByCourse[nc.id] || []).map(s => s.title) : [];
  const known = knownConcepts(state, notes);
  const knownIds = new Set(state.concepts.map(c => c.id));

  // 1. Sort out what each note holds and where it belongs.
  const batches = batchNotes(notes);
  const classified = [];
  let failed = null, done = 0;
  onProgress?.({ step: "read", done, total: batches.length });
  for (const batch of batches) {
    const res = await callAi("notes", {
      topics, known,
      notes: batch.map(n => ({ id: n.id, text: n.text, context: n.context, force: Boolean(n.force) })),
    });
    done++;
    onProgress?.({ step: "read", done, total: batches.length });
    if (!res.ok) { failed = res.error; continue; }
    const byId = Object.fromEntries(res.data.notes.map(r => [r.note_id, r]));
    for (const n of batch) {
      const r = byId[n.id];
      if (!r) { classified.push({ note: n, outcome: "error", reason: "Claude didn't return this note; process it again.", concepts: [] }); continue; }
      const concepts = r.outcome === "keep" ? r.concepts.filter(c => c.name?.trim() && c.summary?.trim()).map(c => ({
        key: `${n.id}:${c.key}`,
        name: c.name.trim(), summary: c.summary.trim(), kind: c.kind || "definition",
        importance: IMPORTANCE[c.importance] ? c.importance : "supporting",
        topic: (c.topic || n.context || "General").trim(),
        filledIn: Boolean(c.filled_in), corrected: (c.corrected || "").trim(),
        sameAs: knownIds.has(c.same_as) ? c.same_as : "",
        related: (c.related || []).filter(l => knownIds.has(l.id) && l.id !== c.same_as).slice(0, 2),
      })) : [];
      const outcome = r.outcome === "keep" && concepts.length ? "keep" : "skip";
      classified.push({ note: n, outcome, reason: outcome === "skip" ? (r.reason || "Nothing definite to remember.") : "", concepts });
    }
  }
  if (!classified.length) return { ok: false, error: failed || "Couldn't process these notes." };

  // 2. Questions: new concepts grouped by topic; matches as extra variants.
  const sections = new Map();
  const add = (title, entry) => { if (!sections.has(title)) sections.set(title, { title, concepts: [] }); sections.get(title).concepts.push(entry); };
  for (const e of classified) {
    for (const c of e.concepts) {
      const excerpt = [e.note.text.slice(0, NOTE_EXCERPT), c.corrected && `Correction: ${c.corrected}`].filter(Boolean).join("\n");
      if (c.sameAs) {
        const target = ix.concept[c.sameAs];
        add(`Adds to: ${ix.section[target.sectionId]?.title ?? ""}`, {
          key: c.key, name: target.name, summary: target.summary, kind: target.kind, importance: target.importance, selected: true,
          excerpt, existingItems: (ix.itemsByConcept[target.id] || []).filter(i => !i.flag), want: 2, extra: NOTE_EXTRA,
        });
      } else {
        add(c.topic, { key: c.key, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance, selected: true, excerpt });
      }
    }
  }
  let groups = [];
  if (sections.size) {
    onProgress?.({ step: "write" });
    const res = await generateTasks({ state, courseId: nc?.id, courseName: "Your notes", sections: [...sections.values()] });
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
 * Creates the Notes space and any new topics as needed.
 */
export function buildNotesImport({ state, entries, now = Date.now() }) {
  const ix = index(state);
  let course = notesCourse(state);
  let newCourse = null;
  const needsSpace = entries.some(e => e.outcome === "keep" && e.concepts.some(c => !c.sameAs && selectedOf(c.group).length));
  if (!course && needsSpace) { newCourse = makeCourse({ name: "Notes", kind: "notes" }, state.courses.length); course = newCourse; }

  const topicSection = new Map((course ? ix.sectionsByCourse[course.id] || [] : []).map(s => [s.title.toLowerCase(), s]));
  let order = Math.max(-1, ...[...topicSection.values()].map(s => s.order)) + 1;
  const sections = [], concepts = [], items = [], edges = [], noteUpdates = [];
  const conceptsInSection = {};
  const sectionFor = (topic) => {
    const k = topic.toLowerCase();
    if (!topicSection.has(k)) {
      const s = makeSection({ courseId: course.id, title: topic, order: order++ });
      sections.push(s); topicSection.set(k, s);
    }
    return topicSection.get(k);
  };
  const date = new Date(now).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  for (const e of entries) {
    if (e.outcome === "error") continue; // stays in the inbox
    if (e.outcome !== "keep") {
      noteUpdates.push({ id: e.note.id, patch: { status: "skipped", reason: e.reason, processedAt: now, force: false } });
      continue;
    }
    const conceptIds = [], merged = [];
    for (const c of e.concepts) {
      const qs = selectedOf(c.group);
      if (!qs.length) continue;
      if (c.sameAs) {
        for (const q of qs) items.push(itemFromQuestion(c.sameAs, q, { fromNote: e.note.id }));
        merged.push(c.sameAs);
        continue;
      }
      const section = sectionFor(c.topic);
      conceptsInSection[section.id] = (conceptsInSection[section.id] ?? (ix.conceptsBySection[section.id] || []).length);
      const concept = makeConcept({
        courseId: course.id, sectionId: section.id, name: c.name, summary: c.summary, kind: c.kind, importance: c.importance,
        order: conceptsInSection[section.id]++,
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
    noteUpdates.push(conceptIds.length || merged.length
      ? { id: e.note.id, patch: { status: "done", processedAt: now, force: false, result: { conceptIds, merged } } }
      : { id: e.note.id, patch: { status: "skipped", processedAt: now, force: false,
          reason: noneKept ? "No question for it passed the quality check." : "You left out all of its questions." } });
  }
  return { course: newCourse, sections, concepts, items, edges, noteUpdates };
}

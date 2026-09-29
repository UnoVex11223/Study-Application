// Core data model: courses → sections → concepts → practice items,
// plus relation edges between concepts and an attempt log.
//
//   course   { id, name, color, status: active|maintain|paused, createdAt, kind? }
//            kind "notes" = the Notes space: your own notes, organized by topic, not a curriculum.
//   section  { id, courseId, title, summary, order, sourceLabel, locked, pages? }
//            locked = a book chapter you haven't read yet: no new concepts from it.
//   concept  { id, courseId, sectionId, name, summary, kind, importance: core|supporting|detail,
//              order, source: { excerpt, location } | null, suspended, srs }
//   item     { id, conceptId, ability, prompt, answer, accept[], points[], misconceptions[], hint,
//              flag, flagCleared, resetAt }
//
// Memory is scheduled per CONCEPT (concept.srs). A concept's questions are
// variants that take turns at its reviews, so extra questions add variety,
// not review time. Per-question history (times asked, misses) comes from the
// attempt log; see index().itemStats.
//   edge     { id, type: prereq|related|contrast|application, from, to, why, confidence, origin }
//            prereq edges mean "from must be learned before to".
//   attempt  { ts, day, itemId, conceptId, courseId, ability, verdict, rating, aided, mode, ms, ... }

import { newSrs, RATING } from "./fsrs.js";

export const SCHEMA_VERSION = 5;

export const ABILITIES = {
  recall:      { label: "Recall",      estSec: 25, rank: 0, blurb: "Produce a term, fact or definition from memory" },
  explain:     { label: "Explain",     estSec: 70, rank: 1, blurb: "Explain what something is and why it matters" },
  distinguish: { label: "Distinguish", estSec: 60, rank: 2, blurb: "Tell apart two ideas that are easy to confuse" },
  apply:       { label: "Apply",       estSec: 90, rank: 3, blurb: "Use the idea on a new example or problem" },
  connect:     { label: "Connect",     estSec: 90, rank: 4, blurb: "Explain how several ideas work together" },
};
export const ABILITY_KEYS = Object.keys(ABILITIES);

export const IMPORTANCE = {
  core:       { label: "Core",       weight: 1,    rank: 0 },
  supporting: { label: "Supporting", weight: 0.75, rank: 1 },
  detail:     { label: "Detail",     weight: 0.5,  rank: 2 },
};

export const COURSE_STATUS = {
  active:   { label: "Active",      blurb: "Reviews plus new concepts" },
  maintain: { label: "Maintaining", blurb: "Reviews only, no new concepts" },
  paused:   { label: "Paused",      blurb: "Hidden from daily sessions" },
};

// Muted, similar-lightness hues so no course shouts over another.
export const COURSE_COLORS = ["#6F7FD4", "#5BA68A", "#C9A061", "#A286CC", "#D08A7E", "#5EA2BF", "#C087A8", "#8A93A6"];

export const DEFAULT_SETTINGS = {
  batchImports: true, // book imports write questions through the Batch API (half price, slower)
  dailyMinutes: 20,
  maxNewPerDay: 6,
  rolloverHour: 4,
  retention: 0.9,
  theme: "dark",
  themeVersion: 2,
};

let counter = 0;
export const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    courses: [], sections: [], concepts: [], items: [], edges: [], attempts: [],
    settings: { ...DEFAULT_SETTINGS },
    days: {}, // per study day: { extraSec }
    bookJobs: [], // whole-book imports in progress (see state/bookImport.jsx)
    notes: [], // your own notes, raw (see lib/notes.js); what they became lives in the Notes space
    shelf: [], // books and courses on your shelf, with covers (see lib/shelf.js)
  };
}

/** Fill in anything missing from a stored state (forward-compatible loads). */
export function normalizeState(s) {
  const base = emptyState();
  const out = { ...base, ...s, settings: { ...base.settings, ...(s?.settings || {}) } };
  // The monochrome redesign defaults to the black theme once; later choices stick.
  if (s?.settings && s.settings.themeVersion !== 2) out.settings = { ...out.settings, theme: "dark", themeVersion: 2 };
  for (const k of ["courses", "sections", "concepts", "items", "edges", "attempts", "bookJobs", "notes", "shelf"]) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (!out.tombstones || typeof out.tombstones !== "object" || Array.isArray(out.tombstones)) out.tombstones = {};
  // A chapter that was mid-import when the app closed starts over, unless its
  // questions were already in a batch (then the import picks the batch back up).
  const interrupted = (c) => c.status === "reading" || (c.status === "writing" && !c.pending?.ex);
  out.bookJobs = out.bookJobs.map(j => (j.chapters.some(interrupted)
    ? { ...j, chapters: j.chapters.map(c => (interrupted(c) ? { ...c, status: "pending" } : c)) }
    : j));
  // v4: schedules moved from questions to concepts. A concept keeps the
  // schedule of whichever of its questions was reviewed most recently.
  const oldSrs = {};
  for (const i of out.items) {
    const srs = i.srs;
    if (!srs || srs.state === "new") continue;
    const cur = oldSrs[i.conceptId];
    if (!cur || (srs.lastReview ?? 0) > (cur.lastReview ?? 0)) oldSrs[i.conceptId] = srs;
  }
  out.concepts = out.concepts.map(c => (c.srs ? c : { ...c, srs: oldSrs[c.id] ?? newSrs() }));
  out.items = out.items.map(i => {
    const { srs, lapsesAtClear, ...rest } = i; // eslint-disable-line no-unused-vars
    return { accept: [], points: [], misconceptions: [], hint: "", ...rest };
  });
  out.version = SCHEMA_VERSION;
  return out;
}

export const makeCourse = (fields, existingCount = 0) => ({
  id: uid("c"), name: "Untitled course", status: "active",
  color: COURSE_COLORS[existingCount % COURSE_COLORS.length], createdAt: Date.now(), ...fields,
});

export const makeSection = (fields) => ({ id: uid("s"), title: "Section", summary: "", order: 0, sourceLabel: "", locked: false, ...fields });

export const makeConcept = (fields) => ({
  id: uid("k"), name: "", summary: "", kind: "definition", importance: "core",
  order: 0, source: null, suspended: false, createdAt: Date.now(), ...fields, srs: fields?.srs ?? newSrs(),
});

export const makeItem = (fields) => ({
  id: uid("i"), ability: "recall", prompt: "", answer: "", accept: [], points: [], misconceptions: [], hint: "",
  createdAt: Date.now(), ...fields,
});

export const makeEdge = (fields) => ({ id: uid("e"), type: "related", why: "", confidence: 0.8, origin: "ai", ...fields });

// ── Indexing ────────────────────────────────────────────────────────────────
// Views and the planner need lots of lookups; build them once per state object.

const cache = new WeakMap();

export function index(state) {
  const hit = cache.get(state);
  if (hit) return hit;

  const course = {}, section = {}, concept = {}, item = {};
  const lockedConcepts = new Set();
  const sectionsByCourse = {}, conceptsBySection = {}, conceptsByCourse = {}, itemsByConcept = {};
  const attemptsByConcept = {}, prereqsOf = {}, dependentsOf = {}, relatedOf = {};

  for (const c of state.courses) { course[c.id] = c; sectionsByCourse[c.id] = []; conceptsByCourse[c.id] = []; }
  for (const s of state.sections) {
    section[s.id] = s; conceptsBySection[s.id] = [];
    (sectionsByCourse[s.courseId] ||= []).push(s);
  }
  for (const k of state.concepts) {
    concept[k.id] = k; itemsByConcept[k.id] = [];
    if (section[k.sectionId]?.locked) lockedConcepts.add(k.id);
    (conceptsBySection[k.sectionId] ||= []).push(k);
    (conceptsByCourse[k.courseId] ||= []).push(k);
  }
  for (const i of state.items) { item[i.id] = i; (itemsByConcept[i.conceptId] ||= []).push(i); }
  // Per-question history: rated attempts since the question was last rewritten.
  // A "miss" is a study day on which you answered Again at least once.
  const itemStats = {};
  for (const i of state.items) itemStats[i.id] = { seen: 0, lastSeen: 0, missDays: [] };
  for (const a of state.attempts) {
    (attemptsByConcept[a.conceptId] ||= []).push(a);
    const st = itemStats[a.itemId];
    if (!st || a.rating == null || a.ts <= (item[a.itemId].resetAt || 0)) continue;
    st.seen++;
    if (a.ts > st.lastSeen) st.lastSeen = a.ts;
    if (a.rating === RATING.AGAIN && st.missDays.at(-1)?.day !== a.day) st.missDays.push({ day: a.day, ts: a.ts });
  }
  for (const e of state.edges) {
    if (!concept[e.from] || !concept[e.to]) continue;
    if (e.type === "prereq") {
      (prereqsOf[e.to] ||= []).push(e);
      (dependentsOf[e.from] ||= []).push(e);
    } else {
      (relatedOf[e.from] ||= []).push(e);
      (relatedOf[e.to] ||= []).push(e);
    }
  }
  for (const list of Object.values(sectionsByCourse)) list.sort((a, b) => a.order - b.order);
  const byOrder = (a, b) => (a.order - b.order) || (IMPORTANCE[a.importance]?.rank ?? 1) - (IMPORTANCE[b.importance]?.rank ?? 1);
  for (const list of Object.values(conceptsBySection)) list.sort(byOrder);
  for (const list of Object.values(itemsByConcept)) list.sort((a, b) => ABILITIES[a.ability].rank - ABILITIES[b.ability].rank);

  const ix = {
    course, section, concept, item, sectionsByCourse, conceptsBySection, conceptsByCourse, itemsByConcept,
    attemptsByConcept, itemStats, prereqsOf, dependentsOf, relatedOf, lockedConcepts,
  };
  cache.set(state, ix);
  return ix;
}

/** Plain-text preview of markdown-ish content (for lists and graphs). */
export const plain = (s, max = 140) => {
  const t = String(s || "").replace(/```[\s\S]*?```/g, " [code] ").replace(/[`*_$#>]/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

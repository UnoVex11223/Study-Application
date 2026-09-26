// Core data model: courses → sections → concepts → practice items,
// plus relation edges between concepts and an attempt log.
//
//   course   { id, name, color, status: active|maintain|paused, createdAt }
//   section  { id, courseId, title, summary, order, sourceLabel }
//   concept  { id, courseId, sectionId, name, summary, kind, importance: core|supporting|detail,
//              order, source: { excerpt, location } | null, suspended }
//   item     { id, conceptId, ability, prompt, answer, accept[], points[], misconceptions[], hint, srs }
//   edge     { id, type: prereq|related|contrast|application, from, to, why, confidence, origin }
//            prereq edges mean "from must be learned before to".
//   attempt  { ts, day, itemId, conceptId, courseId, ability, verdict, rating, aided, mode, ms, ... }

import { newSrs } from "./fsrs.js";

export const SCHEMA_VERSION = 3;

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

export const COURSE_COLORS = ["#2F6FDB", "#2F8F62", "#B7791F", "#8A4FBF", "#C8463D", "#1F8A99", "#B04A82", "#5C6B7A"];

export const DEFAULT_SETTINGS = {
  dailyMinutes: 20,
  maxNewPerDay: 6,
  rolloverHour: 4,
  retention: 0.9,
  theme: "system",
};

let counter = 0;
export const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    courses: [], sections: [], concepts: [], items: [], edges: [], attempts: [],
    settings: { ...DEFAULT_SETTINGS },
    days: {},          // per study day: { extraSec }
    legacyDaily: {},   // review counts carried over from the old app, for the activity chart
  };
}

/** Fill in anything missing from a stored state (forward-compatible loads). */
export function normalizeState(s) {
  const base = emptyState();
  const out = { ...base, ...s, settings: { ...base.settings, ...(s?.settings || {}) } };
  for (const k of ["courses", "sections", "concepts", "items", "edges", "attempts"]) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  out.items = out.items.map(i => ({ accept: [], points: [], misconceptions: [], hint: "", ...i, srs: i.srs ?? newSrs() }));
  return out;
}

export const makeCourse = (fields, existingCount = 0) => ({
  id: uid("c"), name: "Untitled course", status: "active",
  color: COURSE_COLORS[existingCount % COURSE_COLORS.length], createdAt: Date.now(), ...fields,
});

export const makeSection = (fields) => ({ id: uid("s"), title: "Section", summary: "", order: 0, sourceLabel: "", ...fields });

export const makeConcept = (fields) => ({
  id: uid("k"), name: "", summary: "", kind: "definition", importance: "core",
  order: 0, source: null, suspended: false, createdAt: Date.now(), ...fields,
});

export const makeItem = (fields) => ({
  id: uid("i"), ability: "recall", prompt: "", answer: "", accept: [], points: [], misconceptions: [], hint: "",
  createdAt: Date.now(), ...fields, srs: fields?.srs ?? newSrs(),
});

export const makeEdge = (fields) => ({ id: uid("e"), type: "related", why: "", confidence: 0.8, origin: "ai", ...fields });

// ── Indexing ────────────────────────────────────────────────────────────────
// Views and the planner need lots of lookups; build them once per state object.

const cache = new WeakMap();

export function index(state) {
  const hit = cache.get(state);
  if (hit) return hit;

  const course = {}, section = {}, concept = {}, item = {};
  const sectionsByCourse = {}, conceptsBySection = {}, conceptsByCourse = {}, itemsByConcept = {};
  const attemptsByConcept = {}, prereqsOf = {}, dependentsOf = {}, relatedOf = {};

  for (const c of state.courses) { course[c.id] = c; sectionsByCourse[c.id] = []; conceptsByCourse[c.id] = []; }
  for (const s of state.sections) {
    section[s.id] = s; conceptsBySection[s.id] = [];
    (sectionsByCourse[s.courseId] ||= []).push(s);
  }
  for (const k of state.concepts) {
    concept[k.id] = k; itemsByConcept[k.id] = [];
    (conceptsBySection[k.sectionId] ||= []).push(k);
    (conceptsByCourse[k.courseId] ||= []).push(k);
  }
  for (const i of state.items) { item[i.id] = i; (itemsByConcept[i.conceptId] ||= []).push(i); }
  for (const a of state.attempts) (attemptsByConcept[a.conceptId] ||= []).push(a);
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
    attemptsByConcept, prereqsOf, dependentsOf, relatedOf,
  };
  cache.set(state, ix);
  return ix;
}

/** Plain-text preview of markdown-ish content (for lists and graphs). */
export const plain = (s, max = 140) => {
  const t = String(s || "").replace(/```[\s\S]*?```/g, " [code] ").replace(/[`*_$#>]/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

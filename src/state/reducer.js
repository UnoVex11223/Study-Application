// All state changes, as a pure reducer (unit-tested in tests/).
import { emptyState, normalizeState, index } from "../lib/model.js";
import { rate, newSrs } from "../lib/fsrs.js";
import { makeLoadAt } from "../lib/planner.js";
import { mergeEdges } from "../lib/graph.js";
import { dayKey } from "../lib/time.js";
import { LEECH_LAPSES, DISPUTE_LIMIT } from "../lib/quality.js";

const MAX_ATTEMPTS = 30000;

function removeConcepts(state, ids) {
  const gone = new Set(ids);
  const itemIds = new Set(state.items.filter(i => gone.has(i.conceptId)).map(i => i.id));
  return {
    ...state,
    concepts: state.concepts.filter(c => !gone.has(c.id)),
    items: state.items.filter(i => !itemIds.has(i.id)),
    edges: state.edges.filter(e => !gone.has(e.from) && !gone.has(e.to)),
    attempts: state.attempts.filter(a => !gone.has(a.conceptId)),
  };
}

export function reducer(state, action) {
  if (action.type === "load") return action.state;
  if (!state) return state;

  switch (action.type) {
    case "course/add":
      return { ...state, courses: [...state.courses, action.course] };
    case "course/update":
      return { ...state, courses: state.courses.map(c => (c.id === action.id ? { ...c, ...action.patch } : c)) };
    case "course/delete": {
      const ids = state.concepts.filter(c => c.courseId === action.id).map(c => c.id);
      const next = removeConcepts(state, ids);
      return {
        ...next,
        courses: next.courses.filter(c => c.id !== action.id),
        sections: next.sections.filter(s => s.courseId !== action.id),
      };
    }

    case "section/update":
      return { ...state, sections: state.sections.map(s => (s.id === action.id ? { ...s, ...action.patch } : s)) };
    case "section/add":
      return { ...state, sections: [...state.sections, action.section] };
    case "section/delete": {
      const ids = state.concepts.filter(c => c.sectionId === action.id).map(c => c.id);
      const next = removeConcepts(state, ids);
      return { ...next, sections: next.sections.filter(s => s.id !== action.id) };
    }

    case "import": {
      const { sections = [], concepts = [], items = [], edges = [] } = action.payload;
      const merged = mergeEdges(state.edges, edges);
      return {
        ...state,
        sections: [...state.sections, ...sections],
        concepts: [...state.concepts, ...concepts],
        items: [...state.items, ...items],
        edges: [...state.edges, ...merged.accepted],
      };
    }

    case "edges/add": {
      const merged = mergeEdges(state.edges, action.edges);
      return merged.accepted.length ? { ...state, edges: [...state.edges, ...merged.accepted] } : state;
    }
    case "edge/delete":
      return { ...state, edges: state.edges.filter(e => e.id !== action.id) };
    case "edge/confirm":
      return { ...state, edges: state.edges.map(e => (e.id === action.id ? { ...e, confidence: 1, origin: "user" } : e)) };

    case "concept/update":
      return { ...state, concepts: state.concepts.map(c => (c.id === action.id ? { ...c, ...action.patch } : c)) };
    case "concept/delete":
      return removeConcepts(state, [action.id]);

    case "item/add":
      return { ...state, items: [...state.items, action.item] };
    case "item/update":
      return { ...state, items: state.items.map(i => (i.id === action.id ? { ...i, ...action.patch } : i)) };
    case "item/delete":
      return { ...state, items: state.items.filter(i => i.id !== action.id) };

    // Reported or automatically flagged questions leave sessions until fixed.
    case "item/flag":
      return { ...state, items: state.items.map(i => (i.id === action.id ? { ...i, flag: { reason: action.reason, note: action.note || "", at: action.now } } : i)) };
    case "item/unflag":
      return { ...state, items: state.items.map(i => (i.id === action.id ? { ...i, flag: null, flagCleared: action.now, lapsesAtClear: i.srs?.lapses ?? 0 } : i)) };
    case "item/replace":
      // A rewritten question is a new question: fresh schedule, no flag.
      return {
        ...state,
        items: state.items.map(i => (i.id === action.id
          ? { ...i, ...action.fields, srs: newSrs(), flag: null, flagCleared: action.now, quality: { ...(i.quality || {}), rewritten: true } }
          : i)),
      };

    case "items/bringForward": {
      const ids = new Set(action.ids);
      return {
        ...state,
        items: state.items.map(i => (ids.has(i.id) && i.srs.state !== "new" ? { ...i, srs: { ...i.srs, due: Math.min(i.srs.due ?? action.now, action.now) } } : i)),
      };
    }

    case "attempt": {
      const { itemId, verdict, rating, aided = false, ms = 0, mode = "session", misconceptions = [], overridden = false, now } = action;
      const ix = index(state);
      const item = ix.item[itemId];
      if (!item) return state;
      const concept = ix.concept[item.conceptId];
      const srs = rating
        ? rate(item.srs, rating, now, { retention: state.settings.retention, loadAt: makeLoadAt(state) })
        : item.srs;
      const attempt = {
        ts: now, day: dayKey(now, state.settings.rolloverHour),
        itemId, conceptId: item.conceptId, courseId: concept?.courseId ?? null, ability: item.ability,
        verdict, rating: rating ?? null, aided, mode, ms: Math.round(ms),
        ...(misconceptions.length ? { misconceptions } : {}),
        ...(overridden ? { overridden: true } : {}),
      };
      const attempts = state.attempts.length >= MAX_ATTEMPTS
        ? [...state.attempts.slice(-MAX_ATTEMPTS + 1), attempt]
        : [...state.attempts, attempt];
      // Questions you keep missing, or whose grading you keep overruling, are
      // usually bad questions: pull them until you fix or restore them.
      let flag = item.flag || null;
      if (!flag) {
        const since = item.flagCleared || 0;
        const lapsesSince = srs.lapses - (item.lapsesAtClear ?? 0);
        const disputes = attempts.filter(a => a.itemId === itemId && a.overridden && a.ts > since).length;
        if (lapsesSince >= LEECH_LAPSES) flag = { reason: "leech", at: now };
        else if (disputes >= DISPUTE_LIMIT) flag = { reason: "disputed", at: now };
      }
      return { ...state, items: state.items.map(i => (i.id === itemId ? { ...i, srs, flag } : i)), attempts };
    }

    case "day/extra": {
      const day = dayKey(action.now, state.settings.rolloverHour);
      const cur = state.days?.[day] || {};
      return { ...state, days: { ...state.days, [day]: { ...cur, extraSec: (cur.extraSec || 0) + action.sec } } };
    }

    case "settings":
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case "replace":
      return normalizeState(action.state);
    case "reset":
      return { ...emptyState(), settings: state.settings };
    default:
      return state;
  }
}

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { loadState, saveState, flush } from "../lib/persist.js";
import { emptyState, normalizeState, index } from "../lib/model.js";
import { rate } from "../lib/fsrs.js";
import { makeLoadAt } from "../lib/planner.js";
import { mergeEdges } from "../lib/graph.js";
import { dayKey, setRolloverHour } from "../lib/time.js";

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

function reducer(state, action) {
  if (action.type === "load") return { ...action.state, _migrated: action.migrated };
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
      return { ...state, items: state.items.map(i => (i.id === itemId ? { ...i, srs } : i)), attempts };
    }

    case "day/extra": {
      const day = dayKey(action.now, state.settings.rolloverHour);
      const cur = state.days?.[day] || {};
      return { ...state, days: { ...state.days, [day]: { ...cur, extraSec: (cur.extraSec || 0) + action.sec } } };
    }

    case "migrated/dismiss":
      return { ...state, _migrated: false };

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

const StoreCtx = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null);
  const loaded = useRef(false);

  useEffect(() => {
    loadState().then(({ state: s, migrated }) => dispatch({ type: "load", state: s, migrated }));
  }, []);

  useEffect(() => {
    if (!state) return;
    setRolloverHour(state.settings.rolloverHour);
    if (!loaded.current) { loaded.current = true; return; }
    const { _migrated, ...persisted } = state;
    saveState(persisted);
  }, [state]);

  useEffect(() => () => flush(), []);

  const act = useCallback((type, payload = {}) => dispatch({ type, now: Date.now(), ...payload }), []);
  const value = useMemo(() => ({ state, dispatch, act }), [state, act]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useStore = () => useContext(StoreCtx);

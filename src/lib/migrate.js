// Converts data from the original AeroFlash (topics of flashcards) into the
// course/concept model. Nothing is thrown away: every card keeps its schedule,
// and review history becomes attempt records.

import { emptyState, COURSE_COLORS } from "./model.js";
import { newSrs } from "./fsrs.js";
import { dayKey } from "./time.js";

const CLOZE_RE = /\{\{c\d+::(.+?)\}\}/;

const VERDICT_FOR_RATING = { 1: "incorrect", 2: "partial", 3: "correct", 4: "correct" };
// Multiple-choice answers were recognition, not recall: kept in history but
// not counted as evidence of mastery.
const LEGACY_MODE = { review: "review", flashcard: "review", typed: "review", quiz: "recognition", sim: "recognition" };

function cardToPromptAnswer(card) {
  if (card.type === "cloze") {
    const m = CLOZE_RE.exec(card.text || "");
    if (m) {
      const answer = m[1];
      const prompt = `${card.text.slice(0, m.index)}_____${card.text.slice(m.index + m[0].length)}`.replace(CLOZE_RE, (_, a) => a);
      return { prompt: `Fill in the blank:\n\n${prompt}`, answer, accept: [answer], name: answer };
    }
  }
  const front = String(card.front || "").trim();
  const back = String(card.back || "").trim();
  return {
    prompt: front,
    answer: back,
    accept: back.length <= 40 ? [back] : [],
    name: front.length > 90 ? `${front.slice(0, 89)}…` : front,
  };
}

export function migrateLegacy({ topics = [], log = null } = {}) {
  const state = emptyState();
  const itemKey = {};

  topics.forEach((t, ti) => {
    const courseId = `c_${t.id}`;
    const sectionId = `s_${t.id}`;
    state.courses.push({
      id: courseId, name: t.name || "Imported topic", status: "active",
      color: COURSE_COLORS[ti % COURSE_COLORS.length], createdAt: typeof t.id === "number" ? t.id : Date.now(),
      ...(t.image ? { image: t.image } : {}),
    });
    state.sections.push({ id: sectionId, courseId, title: "Imported cards", summary: "", order: 0, sourceLabel: "From the previous version" });

    (t.cards || []).forEach((card, ci) => {
      const { prompt, answer, accept, name } = cardToPromptAnswer(card);
      if (!prompt || !answer) return;
      const conceptId = `k_${t.id}_${card.id}`;
      const itemId = `i_${t.id}_${card.id}`;
      state.concepts.push({
        id: conceptId, courseId, sectionId, name: name || answer, summary: "", kind: "fact",
        importance: "core", order: ci, source: null, suspended: false, createdAt: typeof card.id === "number" ? card.id : Date.now(),
      });
      state.items.push({
        id: itemId, conceptId, ability: "recall", prompt, answer, accept, points: [], misconceptions: [], hint: "",
        srs: card.srs ?? newSrs(), createdAt: typeof card.id === "number" ? card.id : Date.now(),
        legacy: { type: card.type || "basic", ...(card.wrong?.length ? { wrong: card.wrong } : {}) },
      });
      itemKey[`${t.id}:${card.id}`] = { itemId, conceptId, courseId };
    });
  });

  for (const e of log?.entries || []) {
    const ref = itemKey[`${e.topicId}:${e.cardId}`];
    if (!ref) continue;
    state.attempts.push({
      ts: e.ts, day: dayKey(e.ts), ...ref, ability: "recall",
      verdict: VERDICT_FOR_RATING[e.rating] || "incorrect", rating: e.rating,
      aided: false, mode: LEGACY_MODE[e.mode] || "review", ms: 0, legacy: true,
    });
  }
  state.legacyDaily = { ...(log?.daily || {}) };
  return state;
}

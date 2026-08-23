// Card helpers shared across review modes.

const CLOZE_RE = /\{\{c\d+::(.+?)\}\}/;

/** Split a cloze card's text into { before, answer, after }. Null if no marker. */
export function clozeParts(text) {
  const m = CLOZE_RE.exec(text || "");
  if (!m) return null;
  return {
    before: text.slice(0, m.index),
    answer: m[1],
    after: text.slice(m.index + m[0].length),
  };
}

export const isCloze = (card) => card.type === "cloze" && Boolean(clozeParts(card.text));

/** The answer to a card, whatever its format. */
export function cardAnswer(card) {
  if (isCloze(card)) return clozeParts(card.text).answer;
  return card.back;
}

/** Plain-text prompt (used by typed mode and quiz question text). */
export function cardPromptText(card) {
  if (isCloze(card)) {
    const p = clozeParts(card.text);
    return `${p.before}_____${p.after}`;
  }
  return card.front;
}

/** Cards usable in multiple-choice modes (need front/back + distractor pool). */
export const isQuizzable = (card) => card.type !== "cloze" && card.front && card.back;

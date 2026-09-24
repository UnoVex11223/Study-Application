import { ASSESSMENT_VERSION, MAX_ANSWER_CHARS, uncertainAssessment } from '../../assessment-engine.mjs';
import { cardAnswer, cardPromptText } from './cards.js';
import { newSrs, rate, RATING } from './fsrs.js';

export const RECALL_SESSION_LIMIT = 12;
const MAX_LOG_ENTRIES = 5000;
const DAY_MS = 864e5;
const skills = ['recall', 'explain', 'apply', 'distinguish'];
const keyFor = card => JSON.stringify([card.topicId, card.id ?? card.cardId]);
const srsStamp = card => JSON.stringify(card.srs ?? newSrs());

export function inputForCard(card, userAnswer) {
  return {
    question: cardPromptText(card) ?? '', correctAnswer: cardAnswer(card) ?? '', userAnswer,
    rubric: card.rubric, sourceQuote: card.source?.quote ?? '',
  };
}

const contentStamp = card => JSON.stringify({ ...inputForCard(card, ''), type: card.type, skill: card.skill });
export const dueForRecall = (card, now) => !card.srs || card.srs.state === 'new'
  || (card.srs.due != null && card.srs.due <= now);

/** Due before new before optional early practice; rotate previously seen cards. */
export function selectRecallCards(cards, log, now = Date.now(), limit = RECALL_SESSION_LIMIT) {
  const seenAt = new Map();
  for (const entry of log.entries) seenAt.set(keyFor(entry), Math.max(seenAt.get(keyFor(entry)) ?? 0, entry.ts));
  const priority = card => !card.srs || card.srs.state === 'new' ? 1 : dueForRecall(card, now) ? 0 : 2;
  const unique = [...new Map(cards.map(card => [keyFor(card), card])).values()];
  return unique.sort((a, b) => priority(a) - priority(b)
    || (seenAt.get(keyFor(a)) ?? 0) - (seenAt.get(keyFor(b)) ?? 0)
    || (a.srs?.due ?? 0) - (b.srs?.due ?? 0))
    .slice(0, Math.min(RECALL_SESSION_LIMIT, Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : RECALL_SESSION_LIMIT)));
}

/** Save the original answer before any grading or answer reveal. */
export function beginRecallAttempt(log, card, { id, sessionId, answer, hinted = false, declaredFailure = false, allowNew = true }, now = Date.now()) {
  if (!id || log.entries.some(entry => entry.attempt?.id === id)) return log;
  if (typeof answer !== 'string' || answer.length > MAX_ANSWER_CHARS || (!declaredFailure && !answer.trim())) return log;
  const previous = log.entries.filter(entry => entry.cardId === card.id && entry.topicId === card.topicId);
  const previousExposure = Math.max(card.srs?.lastReview ?? 0,
    ...previous.map(entry => entry.attempt?.completedAt ?? entry.attempt?.feedbackShownAt ?? (entry.attempt ? 0 : entry.ts)));
  const assistance = [...(hinted ? ['hint'] : []), ...(previousExposure && now - previousExposure < 60000 ? ['recent-feedback'] : [])];
  const isNew = !card.srs || card.srs.state === 'new';
  const attempt = {
    id, sessionId, version: ASSESSMENT_VERSION, status: 'pending',
    input: inputForCard(card, answer), skill: skills.includes(card.skill) ? card.skill : 'recall',
    assistance, declaredFailure, startedAt: now,
    scheduled: dueForRecall(card, now) && (!isNew || allowNew),
    previousReviewAt: card.srs?.lastReview ?? null,
    delayed: Boolean(previousExposure && now - previousExposure >= DAY_MS),
    contentStamp: contentStamp(card), srsStamp: srsStamp(card),
  };
  return { ...log, entries: [...log.entries, { ts: now, cardId: card.id, topicId: card.topicId, rating: null, mode: 'written', attempt }].slice(-MAX_LOG_ENTRIES) };
}

export function failedRecallAssessment() {
  return { outcome: 'incorrect', method: 'self-report', checks: [], errors: [], feedback: 'You marked this as not recalled. Read the reference, then return to it after a gap.' };
}

/** Preserve feedback even if the user exits before confirming a scheduling change. */
export function noteRecallFeedback(log, attemptId, assessment, now = Date.now()) {
  const entry = log.entries.find(item => item.attempt?.id === attemptId);
  if (!entry || entry.attempt.status !== 'pending') return log;
  return { ...log, entries: log.entries.map(item => item !== entry ? item : {
    ...item, attempt: { ...item.attempt, feedbackShownAt: now,
      assessments: [...(item.attempt.assessments ?? []), { at: now, result: assessment }].slice(-2) },
  }) };
}

/** Pure, idempotent completion: scheduling and evidence always use the first answer. */
export function finishRecallAttempt(log, topics, attemptId, { assessment, difficult = false, disputed = false, selfAssessment = null }, now = Date.now()) {
  const original = log.entries.find(entry => entry.attempt?.id === attemptId);
  if (!original || original.attempt.status !== 'pending') return { log, topics, saved: false };
  const attempt = original.attempt;
  const topic = topics.find(item => item.id === original.topicId);
  const card = topic?.cards.find(item => item.id === original.cardId);
  const assessed = attempt.declaredFailure ? failedRecallAssessment() : assessment ?? uncertainAssessment();
  const knownOutcome = ['correct', 'incorrect', 'uncertain'].includes(assessed.outcome);
  const reliableMethod = ['ai', 'exact'].includes(assessed.method) || (attempt.declaredFailure && assessed.method === 'self-report');
  const outcome = !knownOutcome || disputed ? 'uncertain' : assessed.outcome;
  const selfCheck = ['complete', 'partial', 'missed'].includes(selfAssessment) ? selfAssessment : null;
  let practiceReason = null;
  if (!card) practiceReason = 'The question was removed.';
  else if (contentStamp(card) !== attempt.contentStamp || srsStamp(card) !== attempt.srsStamp) practiceReason = 'The question or its schedule changed during this attempt.';
  else if (disputed) practiceReason = 'You disputed the grade; it stays ungraded.';
  else if (outcome === 'uncertain' || !reliableMethod) practiceReason = 'No reliable grade is available.';
  else if (attempt.assistance.includes('hint')) practiceReason = 'A hint was used before submitting.';
  else if (attempt.assistance.includes('recent-feedback')) practiceReason = 'You saw feedback less than a minute ago.';
  else if (!attempt.scheduled) practiceReason = 'This is extra practice outside the scheduled queue or today’s new-card allowance.';
  const rating = practiceReason ? null : outcome === 'incorrect' ? RATING.AGAIN : difficult ? RATING.HARD : RATING.GOOD;
  const nextSrs = rating ? rate(card.srs ?? newSrs(), rating, now) : null;
  const entry = {
    ...original, rating,
    attempt: { ...attempt, status: 'complete', completedAt: now, assessment: assessed, disputed,
      selfAssessment: selfCheck, outcome, difficult: outcome === 'correct' && Boolean(difficult),
      evidence: rating ? 'unaided' : attempt.assistance.length ? 'assisted' : selfCheck ? 'self-assessed' : 'ungraded',
      practiceReason,
    },
  };
  const date = new Date(now).toISOString().slice(0, 10);
  const day = log.daily[date] ?? { reviews: 0, correct: 0 };
  return {
    saved: true, entry, rating, wasNew: Boolean(rating && (!card.srs || card.srs.state === 'new')),
    topics: rating ? topics.map(item => item.id !== topic.id ? item : {
      ...item, cards: item.cards.map(itemCard => itemCard.id !== card.id ? itemCard : { ...itemCard, srs: nextSrs }),
    }) : topics,
    log: { ...log, entries: log.entries.map(item => item === original ? entry : item),
      daily: { ...log.daily, [date]: { ...day, reviews: day.reviews + 1,
        ratedReviews: (day.ratedReviews ?? day.reviews) + (rating ? 1 : 0),
        correct: day.correct + (rating >= RATING.GOOD ? 1 : 0) } },
    },
  };
}

/** This measures recorded outcomes, not whole-course mastery or future recall probability. */
export function recallSummary(log, days = 30, now = Date.now()) {
  const summary = { total: 0, correct: 0, delayed: 0, practice: 0,
    skills: Object.fromEntries(skills.map(skill => [skill, { total: 0, correct: 0 }])) };
  for (const entry of log.entries) {
    const attempt = entry.attempt;
    if (!attempt || attempt.version !== ASSESSMENT_VERSION || attempt.status !== 'complete'
      || attempt.completedAt < now - days * DAY_MS || attempt.completedAt > now) continue;
    if (attempt.evidence !== 'unaided') { summary.practice++; continue; }
    summary.total++;
    summary.correct += attempt.outcome === 'correct' ? 1 : 0;
    summary.delayed += attempt.delayed ? 1 : 0;
    const skill = summary.skills[attempt.skill];
    if (skill) { skill.total++; skill.correct += attempt.outcome === 'correct' ? 1 : 0; }
  }
  return summary;
}

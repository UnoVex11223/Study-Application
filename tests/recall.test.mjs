import test from 'node:test';
import assert from 'node:assert/strict';
import { beginRecallAttempt, finishRecallAttempt, noteRecallFeedback, recallSummary, selectRecallCards } from '../src/lib/recall.js';
import { newSrs, RATING } from '../src/lib/fsrs.js';
import { loadAll, storeSet, saveLog, logReview, retention, resetProgress } from '../src/lib/storage.js';

const NOW = Date.UTC(2026, 8, 24, 12);
const DAY = 864e5;
const card = { id: 1, type: 'basic', front: 'What is a magic number?', back: 'An unexplained numeric literal in code.', rubric: ['An unexplained numeric literal in code.'], skill: 'explain', srs: newSrs() };
const topics = [{ id: 10, name: 'Programming', cards: [card], customMetadata: 'preserve me' }, { id: 20, name: 'Other', cards: [{ ...card, id: 2 }] }];
const emptyLog = () => ({ entries: [], daily: {} });
const grade = (outcome = 'correct') => ({ method: 'ai', outcome, checks: [], errors: [], feedback: 'Fixture assessment.' });
const start = (options = {}, initialLog = emptyLog(), item = card, now = NOW) => beginRecallAttempt(initialLog, { ...item, topicId: 10 }, { id: 'attempt-1', sessionId: 'session-1', answer: 'A literal with no explained purpose.', ...options }, now);
const finish = (log, options = {}, collection = topics, now = NOW + 1000) => finishRecallAttempt(log, collection, 'attempt-1', { assessment: grade(), ...options }, now);

test('the first answer is captured before feedback; duplicate submission cannot replace it', () => {
  const original = emptyLog();
  const log = start({}, original);
  assert.equal(original.entries.length, 0);
  assert.equal(log.entries[0].attempt.status, 'pending');
  assert.equal(log.entries[0].attempt.input.userAnswer, 'A literal with no explained purpose.');
  assert.equal(start({ answer: 'Now I copied the reference.' }, log), log);
  assert.deepEqual(log.daily, {});
});

test('blank and oversized accidental submissions are ignored; an explicit miss is accepted', () => {
  const original = emptyLog();
  assert.equal(start({ answer: '' }, original), original);
  assert.equal(start({ answer: 'x'.repeat(4001) }, original), original);
  assert.equal(start({ answer: '', declaredFailure: true }, original).entries.length, 1);
});

test('an unaided due answer schedules Good, never speed-based Easy, preserving every other card', () => {
  const log = start();
  const result = finish(log);
  assert.equal(result.rating, RATING.GOOD);
  assert.equal(result.entry.attempt.evidence, 'unaided');
  assert.equal(result.topics[0].cards[0].srs.reps, 1);
  assert.equal(result.topics[0].cards[0].srs.due, NOW + 1000 + 10 * 60000);
  assert.equal(result.topics[1], topics[1]);
  assert.equal(result.topics[0].customMetadata, 'preserve me');
  assert.equal(topics[0].cards[0].srs.reps, 0);
  assert.equal(log.entries[0].attempt.status, 'pending');
  assert.equal(result.wasNew, true);
  assert.equal(finish(result.log, {}, result.topics).saved, false);
});

test('Hard is available only for correct effortful recall; partial/incorrect recall uses Again', () => {
  assert.equal(finish(start(), { difficult: true }).rating, RATING.HARD);
  const missed = finish(start(), { assessment: grade('incorrect'), difficult: true });
  assert.equal(missed.rating, RATING.AGAIN);
  assert.equal(missed.entry.attempt.difficult, false);
  const declared = finish(start({ answer: '', declaredFailure: true }));
  assert.equal(declared.rating, RATING.AGAIN);
  assert.equal(declared.entry.attempt.assessment.method, 'self-report');
});

test('uncertain, disputed, self-checked and hinted attempts do not reschedule or count as unaided success', () => {
  const cases = [
    [start(), { assessment: grade('uncertain') }],
    [start(), { disputed: true }],
    [start(), { assessment: grade('uncertain'), selfAssessment: 'complete' }],
    [start({ hinted: true }), {}],
    [start({ allowNew: false }), {}],
    [start(), { assessment: { ...grade(), method: 'keyword' } }],
  ];
  for (const [log, options] of cases) {
    const result = finish(log, options);
    assert.equal(result.rating, null);
    assert.equal(result.topics, topics);
    assert.equal(result.wasNew, false);
    assert.equal(recallSummary(result.log, 30, NOW + 2000).total, 0);
    assert.equal(recallSummary(result.log, 30, NOW + 2000).practice, 1);
  }
});

test('early practice and stale or deleted questions cannot extend a schedule', () => {
  const futureCard = { ...card, srs: { ...newSrs(), state: 'review', due: NOW + DAY, lastReview: NOW - DAY, stability: 5 } };
  const futureTopics = [{ ...topics[0], cards: [futureCard] }];
  assert.equal(finish(start({}, emptyLog(), futureCard), {}, futureTopics).rating, null);
  assert.equal(finish(start(), {}, [{ ...topics[0], cards: [] }]).rating, null);
  assert.equal(finish(start(), {}, [{ ...topics[0], cards: [{ ...card, back: 'An edited reference.' }] }]).rating, null);
  assert.equal(finish(start(), {}, [{ ...topics[0], cards: [{ ...card, srs: { ...card.srs, reps: 1 } }] }]).rating, null);
});

test('feedback survives leaving before confirmation and protects against immediate replay', () => {
  let log = start();
  log = noteRecallFeedback(log, 'attempt-1', grade(), NOW + 1000);
  assert.equal(log.entries[0].attempt.status, 'pending');
  assert.equal(log.entries[0].attempt.assessments[0].result.outcome, 'correct');
  assert.deepEqual(log.daily, {});
  const repeat = start({ id: 'repeat' }, log, card, NOW + 2000);
  assert.deepEqual(repeat.entries[1].attempt.assistance, ['recent-feedback']);
  const result = finishRecallAttempt(repeat, topics, 'repeat', { assessment: grade() }, NOW + 3000);
  assert.equal(result.rating, null);
  assert.equal(result.topics, topics);
});

test('completed attempts are immutable and activity only increments once', () => {
  const log = start();
  const result = finish(log);
  assert.equal(result.log.daily['2026-09-24'].reviews, 1);
  assert.equal(noteRecallFeedback(result.log, 'attempt-1', grade('incorrect')), result.log);
  const again = finish(result.log, { assessment: grade('incorrect') }, result.topics);
  assert.equal(again.saved, false);
  assert.equal(again.log, result.log);
  assert.equal(again.topics, result.topics);
});

test('ungraded practice adds activity without lowering the legacy positive-rating statistic', () => {
  const oldLog = { entries: [], daily: { '2026-09-24': { reviews: 2, correct: 2 } } };
  const result = finish(start({}, oldLog), { assessment: grade('uncertain') });
  assert.equal(result.log.daily['2026-09-24'].reviews, 3);
  assert.equal(result.log.daily['2026-09-24'].ratedReviews, 2);
  assert.equal(retention(result.log, 30, NOW + 2000), 1);
  const mixed = logReview(result.log, { cardId: 2, topicId: 20, mode: 'flip', rating: 1 }, NOW + 3000);
  assert.equal(mixed.daily['2026-09-24'].reviews, 4);
  assert.equal(mixed.daily['2026-09-24'].ratedReviews, 3);
  assert.equal(retention(mixed, 30, NOW + 4000), 2 / 3);
  const onlyUngraded = finish(start(), { assessment: grade('uncertain') });
  assert.equal(retention(onlyUngraded.log, 30, NOW + 2000), null);
});

test('session selection caps at twelve, prioritizes due cards, rotates seen cards and avoids duplicate IDs per topic', () => {
  const cards = Array.from({ length: 30 }, (_, index) => ({ ...card, id: index + 1, topicId: 10 }));
  cards[15] = { ...cards[15], srs: { ...newSrs(), state: 'review', due: NOW - 1000 } };
  const log = { entries: [{ cardId: 1, topicId: 10, ts: NOW - 5000 }], daily: {} };
  const selected = selectRecallCards([...cards, cards[15]], log, NOW, 1000);
  assert.equal(selected.length, 12);
  assert.equal(selected[0].id, 16);
  assert.equal(selected.some(item => item.id === 1), false);
  assert.equal(selectRecallCards(cards, log, NOW, 2).length, 2);
  assert.equal(selectRecallCards(cards, log, NOW, NaN).length, 12);
  assert.equal(cards.length, 30);
});

test('skills and delay are tracked separately; old recognition ratings cannot become recall evidence', () => {
  const older = { ...card, srs: { ...newSrs(), state: 'review', due: NOW - 1000, lastReview: NOW - 2 * DAY, stability: 2, reps: 4 } };
  const log = start({}, { entries: [{ cardId: 2, topicId: 20, ts: NOW - DAY, rating: 4, mode: 'quiz' }], daily: {} }, older);
  const result = finish(log, { difficult: true }, [{ ...topics[0], cards: [older] }]);
  const stats = recallSummary(result.log, 30, NOW + 2000);
  assert.equal(stats.total, 1);
  assert.equal(stats.correct, 1);
  assert.equal(stats.delayed, 1);
  assert.deepEqual(stats.skills.explain, { total: 1, correct: 1 });
  assert.deepEqual(stats.skills.recall, { total: 0, correct: 0 });
  assert.equal(recallSummary(result.log, 30, NOW + 32 * DAY).total, 0);
});

test('loading existing storage preserves cards, schedules and legacy entries with new attempt metadata', async () => {
  resetProgress();
  const legacy = { ts: NOW - DAY, cardId: 1, topicId: 10, rating: 4, mode: 'typed' };
  const log = start({}, { entries: [legacy], daily: { '2026-09-23': { reviews: 1, correct: 1 } } });
  storeSet('af_schema_version', 2);
  storeSet('af_topics', topics);
  saveLog(log);
  const loaded = await loadAll();
  assert.deepEqual(loaded.topics, topics);
  assert.deepEqual(loaded.log.entries[0], legacy);
  assert.equal(loaded.log.entries[1].attempt.input.userAnswer, 'A literal with no explained purpose.');
  assert.equal(recallSummary(loaded.log, 30, NOW).total, 0);
  resetProgress();
});

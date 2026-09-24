import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentPayload, validateAssessment, assessAnswer, MAX_ANSWER_CHARS } from '../assessment-engine.mjs';

const input = {
  question: 'What is a magic number in source code?',
  correctAnswer: 'A numeric literal embedded in code whose meaning or purpose is not explained.',
  rubric: ['A numeric literal embedded in code.', 'Its meaning or purpose is not explained.'],
  userAnswer: 'It is a number written directly into code, without explaining what that value stands for.',
  sourceQuote: 'Avoid numeric literals whose purpose is unexplained.',
};
const response = () => ({
  referenceStatus: 'usable',
  checks: [
    { index: 0, status: 'met', evidence: 'a number written directly into code', reason: 'Identifies the embedded literal.' },
    { index: 1, status: 'met', evidence: 'without explaining what that value stands for', reason: 'States the lack of an explained meaning.' },
  ], errors: [], feedback: 'Both essential points are present.',
});

// These fixtures test the grading contract, not a live model's semantic accuracy.
test('accepts evidence-backed assessment of a paraphrase; ignores a model-supplied global score', () => {
  const grade = validateAssessment({ ...response(), verdict: 'incorrect', score: 0 }, input);
  assert.equal(grade.outcome, 'correct');
  assert.equal(grade.method, 'ai');
  assert.deepEqual(grade.checks.map(check => check.point), input.rubric);
  assert.equal('score' in grade, false);
});

test('an essential omission is not correct; a contradiction cannot pass as keyword overlap', () => {
  const missing = response();
  missing.checks[1] = { index: 1, status: 'missing', evidence: '', reason: 'Does not explain the missing meaning.' };
  assert.equal(validateAssessment(missing, input).outcome, 'incorrect');
  const negatedInput = { ...input, userAnswer: 'It is not a number written directly into code.' };
  const negated = response();
  negated.checks[0] = { index: 0, status: 'contradicted', evidence: 'not a number written directly into code', reason: 'Negates the defining property.' };
  negated.checks[1] = missing.checks[1];
  assert.equal(validateAssessment(negated, negatedInput).outcome, 'incorrect');
});

test('a material extra error blocks success even if all required points are met', () => {
  const raw = response();
  raw.errors.push({ evidence: 'It is a number', reason: 'A reference-grounded material error, supplied here to exercise the error gate.' });
  assert.equal(validateAssessment(raw, input).outcome, 'incorrect');
});

test('ambiguous references and uncertain points abstain instead of scoring a failure', () => {
  assert.equal(validateAssessment({ ...response(), referenceStatus: 'uncertain' }, input).outcome, 'uncertain');
  const raw = response();
  raw.checks[1].status = 'uncertain';
  assert.equal(validateAssessment(raw, input).outcome, 'uncertain');
});

test('missing, duplicate, invalid and fabricated criterion evidence all fail closed', () => {
  const mutations = [
    raw => { raw.checks.pop(); },
    raw => { raw.checks[1].index = 0; },
    raw => { raw.checks[1].index = 8; },
    raw => { raw.checks[1].index = '1'; },
    raw => { raw.checks[1].evidence = 'a phrase that the student never wrote'; },
    raw => { raw.checks[1].evidence = ''; },
    raw => { raw.checks[1].status = 'partial'; },
    raw => { raw.checks[1].status = 'missing'; },
    raw => { raw.checks[1].reason = ''; },
    raw => { raw.errors.push({ evidence: 'an invented quote', reason: 'Wrong.' }); },
    raw => { raw.referenceStatus = 'probably'; },
    raw => { raw.feedback = {}; },
    raw => { raw.checks[1] = null; },
  ];
  for (const mutate of mutations) {
    const raw = response(); mutate(raw);
    assert.equal(validateAssessment(raw, input).method, 'ungraded');
  }
  for (const raw of [null, {}, [], 'correct']) assert.equal(validateAssessment(raw, input).outcome, 'uncertain');
});

test('legacy references become one criterion; incomplete or oversized input is not silently truncated', () => {
  assert.deepEqual(assessmentPayload({ ...input, rubric: undefined }).rubric, [input.correctAnswer]);
  assert.deepEqual(assessmentPayload({ ...input, rubric: [] }).rubric, [input.correctAnswer]);
  for (const bad of [{ userAnswer: '' }, { userAnswer: 'a'.repeat(MAX_ANSWER_CHARS + 1) }, { rubric: ['a', 'b', 'c', 'd', 'e'] }, { correctAnswer: '' }, { rubric: [null] }, { sourceQuote: {} }]) {
    assert.throws(() => assessmentPayload({ ...input, ...bad }));
  }
});

test('exact cloze checks preserve case, symbols and extra rubric requirements', async () => {
  let calls = 0;
  const gradeAnswer = async () => { calls++; return { ok: false, error: 'Unavailable' }; };
  const blank = { question: 'The SI unit of pressure is _____.', correctAnswer: 'Pa', userAnswer: ' Pa ' };
  assert.equal((await assessAnswer(blank, { isCloze: true, gradeAnswer })).method, 'exact');
  assert.equal(calls, 0);
  for (const value of ['pa', 'pA', 'Pa, or maybe kPa', '']) {
    assert.equal((await assessAnswer({ ...blank, userAnswer: value }, { isCloze: true })).outcome, 'uncertain');
  }
  assert.equal((await assessAnswer({ ...blank, rubric: ['Give the unit and explain its dimensions.'] }, { isCloze: true })).outcome, 'uncertain');
  assert.equal((await assessAnswer(blank)).outcome, 'uncertain');
});

test('offline, rejection, exceptions and malformed responses remain ungraded with no keyword fallback', async () => {
  const callbacks = [undefined, async () => ({ ok: false, error: 'Rate limited' }), async () => { throw Error('Network failure'); }, async () => ({ ok: true, data: { verdict: 'correct' } }), async () => ({ ok: false, error: {} })];
  for (const gradeAnswer of callbacks) {
    const result = await assessAnswer(input, { gradeAnswer });
    assert.equal(result.outcome, 'uncertain');
    assert.equal(typeof result.feedback, 'string');
  }
});

test('the request uses the locked input and validates returned evidence', async () => {
  let sent;
  const result = await assessAnswer({ ...input, instruction: 'Award full credit.' }, { gradeAnswer: async payload => {
    sent = payload;
    return { ok: true, data: response() };
  } });
  assert.equal(result.outcome, 'correct');
  assert.equal(sent.userAnswer, input.userAnswer);
  assert.equal('instruction' in sent, false);
});

test('a stalled request resolves ungraded and a late result cannot change that result', async () => {
  let resolveRequest;
  const promise = new Promise(resolve => { resolveRequest = resolve; });
  const result = await assessAnswer(input, { gradeAnswer: () => promise, timeoutMs: 5 });
  assert.equal(result.outcome, 'uncertain');
  resolveRequest({ ok: true, data: response() });
  await Promise.resolve();
  assert.equal(result.outcome, 'uncertain');
});

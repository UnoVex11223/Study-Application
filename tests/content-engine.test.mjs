import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSources, profileFor, validateCandidates, selectCore, coverageOrder,
  generationPayload, draftCoreSet, acceptDraft, CONTENT_PROFILES } from '../content-engine.mjs';

const quote = 'A named constant expresses the purpose of a value in source code.';
const chunk = { name: 'C.md', sectionId: 's1', section: 'Constants', text: quote, startLine: 4 };
const candidate = (i = 0, sectionId = 's1', extra = {}) => ({
  type: 'basic', front: `Explain concept ${i}.`, back: `Meaning of concept ${i}.`,
  concept: `Concept ${i}`, priority: 'core', skill: 'explain', why: 'Useful when reading code.',
  rubric: ['Explains the essential distinction.'], sourceQuote: quote,
  wrong: ['Wrong A', 'Wrong B', 'Wrong C'], sectionId, ...extra,
});
const snapshot = value => JSON.parse(JSON.stringify(value));

test('parser retains subsection ancestry, source identity and source lines', () => {
  const result = parseSources([{ name: 'C.md', content: '# Chapter 1\n\n## Constants\n\n'+quote+'\n## Loops\nLoops repeat a statement.' }]);
  assert.equal(result.sections.length, 2);
  assert.deepEqual(result.sections[0].path, ['Chapter 1', 'Constants']);
  assert.equal(result.chunks[0].startLine, 5);
  assert.equal(result.chunks[0].section, 'Chapter 1 / Constants');
  assert.equal(result.chunks[0].text, quote);
  assert.equal(parseSources([{ name: 'C.md', content: '# Chapter 1\n## Constants\n'+quote }]).sections[0].id, result.sections[0].id);
});

test('headings inside code fences do not become subsections; header-only material creates no cards', () => {
  const r = parseSources([{ name: 'C.md', content: '# Heading only\n## Code\n```c\n# define SIZE 10\n```\n'+quote+'\n### Empty' }]);
  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0].title, 'Code');
  assert.match(r.chunks[0].text, /# define SIZE/);
});

test('long sections use bounded chunks without multiplying section identities or losing code', () => {
  const content = '# Long\n'+('abc '.repeat(70)+'\n\n').repeat(7);
  const { chunks, sections } = parseSources([{ name: 'C.md', content }], 120);
  assert.equal(sections.length, 1);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every(c => c.text.length <= 120 && c.sectionId === sections[0].id));
  assert.equal(chunks.map(c => c.text).join('').replace(/\s/g, ''), content.split('\n').slice(1).join('').replace(/\s/g, ''));
});

test('same heading names in different files or chapters stay separate', () => {
  const { sections } = parseSources([{ name: 'A.md', content: '# One\n## Basics\n'+quote+'\n# Two\n## Basics\n'+quote }, { name: 'B.md', content: '# One\n## Basics\n'+quote }]);
  assert.equal(new Set(sections.map(s => s.id)).size, 3);
});

test('filters unsupported quotes, malformed rubrics and duplicate concepts without trusting model source locators', () => {
  const { cards, rejected } = validateCandidates([
    candidate(0, 'forged'), candidate(1, 's1', { concept: ' CONCEPT 0 ' }),
    candidate(2, 's1', { sourceQuote: 'An invented quotation from elsewhere.' }),
    candidate(3, 's1', { rubric: [] }), candidate(4, 's1', { skill: 'invented' }),
  ], chunk);
  assert.equal(cards.length, 1); assert.equal(rejected, 4);
  assert.equal(cards[0].sectionId, 's1');
  assert.equal(cards[0].source.name, 'C.md');
  assert.equal(cards[0].source.startLine, 4);
});

test('reimports reject matching concepts and question fingerprints even with changed question wording', () => {
  const existing = [candidate(0)];
  assert.equal(validateCandidates([candidate(1, 's1', { front: 'Another phrasing?', concept: 'concept 0' })], chunk, existing).cards.length, 0);
  assert.equal(validateCandidates([candidate(2, 's1', { front: 'EXPLAIN   CONCEPT 0?' })], chunk, existing).cards.length, 0);
});

test('breadth comes before extra questions from one section; core beats supporting within a round', () => {
  const pool = [...Array.from({ length: 12 }, (_, i) => candidate(i)),
    candidate(12, 's2'), candidate(13, 's3', { priority: 'supporting' }), candidate(14, 's3')];
  const picked = selectCore(pool, [], 'balanced', 3);
  assert.equal(new Set(picked.map(c => c.sectionId)).size, 3);
  assert.ok(picked.some(c => c.concept === 'Concept 14'));
});

test('all profiles enforce per-import, per-topic and per-section ceilings', () => {
  for (const [key, p] of Object.entries(CONTENT_PROFILES)) {
    const pool = Array.from({ length: 300 }, (_, i) => candidate(i, 's'+Math.floor(i / 20)));
    const picked = selectCore(pool, [], key);
    assert.equal(picked.length, p.perImport);
    for (const s of new Set(picked.map(c => c.sectionId))) assert.ok(picked.filter(c => c.sectionId === s).length <= p.perSection);
    const existing = Array.from({ length: p.perTopic - 1 }, (_, i) => candidate(1000 + i, 'old'));
    assert.equal(selectCore(pool, existing, key).length, 1);
    assert.equal(selectCore(pool, [...existing, candidate(2000)], key).length, 0);
  }
});

test('section ceilings include previously accepted cards and optional additions do not fill a quota', () => {
  assert.equal(selectCore([candidate(10)], [candidate(1), candidate(2)], 'essentials').length, 0);
  assert.equal(selectCore([candidate(10)], [], 'balanced').length, 1);
  assert.equal(selectCore([], [], 'balanced').length, 0);
});

test('acceptance preserves every existing card and scheduling object, respects omissions and is idempotent', () => {
  const old = { ...candidate(500), id: 42, srs: { stability: 17, due: 9000, reps: 8 } };
  const topic = { id: 1, name: 'C', cards: [old], contentProfile: 'balanced', sections: [],
    contentDraft: { cards: [candidate(1, 's2'), candidate(2, 's2', { excluded: true })], sections: [{ id: 's2', title: 'Loops' }] } };
  const before = snapshot(topic);
  const accepted = acceptDraft(topic, () => 'new-id', () => ({ state: 'new' }));
  assert.deepEqual(topic, before);
  assert.equal(accepted.cards.length, 2); assert.equal(accepted.cards[0], old);
  assert.equal(accepted.cards[1].id, 'new-id'); assert.equal(accepted.cards[1].excluded, undefined);
  assert.equal(accepted.sections.length, 1); assert.equal(accepted.contentDraft, null);
  assert.equal(acceptDraft(accepted, () => 'duplicate-id', () => ({})), accepted);
});

test('acceptance rechecks latest topic size and a narrowed depth, preserving legacy decks above the limit', () => {
  const cards = Array.from({ length: 15 }, (_, i) => candidate(i + 100, 'old'));
  const topic = { cards, contentProfile: 'essentials', contentDraft: { cards: [candidate(1), candidate(2)], sections: [] } };
  assert.equal(acceptDraft(topic, () => 'new', () => ({})).cards.length, 16);
  const large = { ...topic, cards: [...cards, candidate(200), candidate(201)] };
  assert.equal(acceptDraft(large, () => 'new', () => ({})), large);
});

test('coverage order includes every section, rotates files and reaches the end of long sources', () => {
  const sections = [...Array.from({ length: 20 }, (_, i) => ({ id: 'a'+i, name: 'A' })), { id: 'b', name: 'B' }];
  const order = coverageOrder(sections);
  assert.deepEqual(order.slice(0, 3), ['a0', 'b', 'a19']);
  assert.equal(order.length, 21); assert.equal(new Set(order).size, 21);
});

test('streaming selection stays bounded while considering later sections and additional files', async () => {
  const sources = [{ name: 'A', content: Array.from({ length: 18 }, (_, i) => `# Section ${i}\n${quote}`).join('\n') }, { name: 'B', content: '# Final\n'+quote }];
  const parsed = parseSources(sources), saved = [];
  let requests = 0;
  const result = await draftCoreSet({ ...parsed, generate: async payload => {
    requests++;
    return { ok: true, data: Array.from({ length: 20 }, (_, i) => candidate(`${payload.section}-${i}`)) };
  }, onDraft: draft => saved.push(draft) });
  assert.equal(requests, 19); assert.equal(result.cards.length, 12);
  assert.ok(saved.every(d => d.cards.length <= 12));
  assert.ok(result.cards.some(c => c.source.name === 'B'));
  assert.ok(result.cards.some(c => c.source.section === 'Section 17'));
  assert.equal(new Set(result.cards.map(c => c.sectionId)).size, 12);
});

test('API failure keeps completed snapshots without promoting partial cards to the study queue', async () => {
  const parsed = parseSources([{ name: 'A', content: '# One\n'+quote+'\n# Two\n'+quote }]);
  let saved, calls = 0;
  await assert.rejects(() => draftCoreSet({ ...parsed, generate: async () => ++calls === 1
    ? { ok: true, data: [candidate()] } : { ok: false, error: 'Offline' }, onDraft: d => { saved = d; } }), /Offline/);
  assert.equal(saved.cards.length, 1); assert.equal(saved.processed, 1); assert.equal(saved.total, 2);
  assert.equal(saved.cards[0].srs, undefined);
});

test('cancelling a pending request ignores its late result and makes no further requests', async () => {
  const parsed = parseSources([{ name: 'A', content: '# One\n'+quote+'\n# Two\n'+quote }]);
  let stopped = false, calls = 0, saved = 0;
  const result = await draftCoreSet({ ...parsed, generate: async () => { calls++; stopped = true; return { ok: true, data: [candidate()] }; },
    cancelled: () => stopped, onDraft: () => { saved++; } });
  assert.equal(calls, 1); assert.equal(saved, 0); assert.equal(result.cards.length, 0);
});

test('full topics make no paid generation calls; source limit rejects excessive batches', async () => {
  const parsed = parseSources([{ name: 'A', content: quote }]);
  let calls = 0;
  const result = await draftCoreSet({ ...parsed, existing: Array.from({ length: 24 }, (_, i) => candidate(i)), generate: () => { calls++; } });
  assert.equal(calls, 0); assert.equal(result.cards.length, 0);
  await assert.rejects(() => draftCoreSet({ chunks: Array.from({ length: 49 }, () => chunk), sections: [], generate: () => {} }), /Import a chapter/);
});

test('payload validation keeps requests bounded and treats unknown profiles safely', () => {
  assert.throws(() => generationPayload(quote));
  for (const count of [0, -1, 7, 2.5, Infinity]) assert.throws(() => generationPayload({ notes: quote, count }));
  assert.throws(() => generationPayload({ notes: 'x'.repeat(12001), count: 4 }));
  assert.equal(generationPayload({ notes: quote, count: 4, alreadyCovered: Array(500).fill('a') }).alreadyCovered.length, 100);
  assert.equal(profileFor('toString'), CONTENT_PROFILES.balanced);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { detectChapters, chaptersFromStarts, estimate, isMatter } from "../src/lib/book.js";
import { runBookJob } from "../src/lib/bookRunner.js";
import { reducer } from "../src/state/reducer.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, makeEdge, normalizeState, index } from "../src/lib/model.js";
import { buildPlan } from "../src/lib/planner.js";
import { courseMastery } from "../src/lib/mastery.js";

// ── Finding chapters ───────────────────────────────────────────────────────
const o = (title, page, depth, end) => ({ title, page, depth, end });

test("chapters come from the top level, skipping front and back matter", () => {
  const outline = [
    o("Contents", 3, 0, 6), o("Preface", 7, 0, 10),
    o("Chapter 1: Introduction", 11, 0, 30), o("1.1 History", 12, 1, 20),
    o("Chapter 2: C Fundamentals", 31, 0, 60),
    o("Appendix A: Operators", 61, 0, 70), o("Index", 71, 0, 80),
  ];
  const ch = detectChapters(outline, 80);
  assert.deepEqual(ch.map(c => [c.title, c.include]), [
    ["Contents", false], ["Preface", false], ["Chapter 1: Introduction", true],
    ["Chapter 2: C Fundamentals", true], ["Appendix A: Operators", false], ["Index", false],
  ]);
  assert.deepEqual([ch[2].from, ch[2].to], [11, 30]);
  assert.equal(isMatter("Introduction"), false, "an Introduction chapter is real content");
});

test("parts are replaced by the chapters inside them", () => {
  const outline = [
    o("Preface", 5, 0, 9),
    o("Part I: Basics", 10, 0, 99), o("1 Getting Started", 11, 1, 40), o("2 Types", 41, 1, 99),
    o("Part II: Memory", 100, 0, 200), o("3 Pointers", 101, 1, 150), o("4 Arrays", 151, 1, 200),
  ];
  assert.deepEqual(detectChapters(outline, 200).filter(c => c.include).map(c => c.title), ["1 Getting Started", "2 Types", "3 Pointers", "4 Arrays"]);
});

test("a single top-level entry (the book's title) is looked inside", () => {
  const outline = [o("The C Book", 1, 0, 90), o("Chapter 1", 2, 1, 30), o("Chapter 2", 31, 1, 60), o("Chapter 3", 61, 1, 90)];
  assert.deepEqual(detectChapters(outline, 90).map(c => c.title), ["Chapter 1", "Chapter 2", "Chapter 3"]);
});

test("typed-in start pages become page ranges; estimates scale with pages", () => {
  const ch = chaptersFromStarts([{ title: "Two", from: 31 }, { title: "One", from: 1 }], 60);
  assert.deepEqual(ch.map(c => [c.title, c.from, c.to]), [["One", 1, 30], ["Two", 31, 60]]);
  const e = estimate([{ from: 1, to: 200, include: true }, { from: 201, to: 400, include: true }, { from: 401, to: 500, include: false }]);
  assert.equal(e.pages, 400);
  assert.equal(e.chapters, 2);
  assert.ok(e.dollars[0] >= 5 && e.dollars[1] <= 20);
});

// ── Locked chapters ────────────────────────────────────────────────────────
function lockedWorld() {
  const s = emptyState();
  s.settings.dailyMinutes = 60;
  const course = makeCourse({ name: "Book" });
  const read = makeSection({ courseId: course.id, title: "Chapter 1", order: 0 });
  const unread = makeSection({ courseId: course.id, title: "Chapter 2", order: 1, locked: true });
  s.courses.push(course); s.sections.push(read, unread);
  const a = makeConcept({ courseId: course.id, sectionId: read.id, name: "A" });
  const b = makeConcept({ courseId: course.id, sectionId: unread.id, name: "B" });
  const c = makeConcept({ courseId: course.id, sectionId: read.id, name: "C", order: 1 });
  s.concepts.push(a, b, c);
  for (const k of [a, b, c]) s.items.push(makeItem({ conceptId: k.id, ability: "explain", prompt: "q", answer: "a" }));
  s.edges.push(makeEdge({ type: "prereq", from: b.id, to: c.id, confidence: 0.9 })); // C (read) builds on B (unread)
  return { s, course, read, unread, a, b, c };
}

test("locked chapters introduce nothing; their prerequisites don't block read chapters", () => {
  const { s, a, b, c, unread } = lockedWorld();
  const picked = buildPlan(s).tasks.map(t => t.conceptId);
  assert.ok(picked.includes(a.id));
  assert.ok(picked.includes(c.id), "C isn't held back by a prerequisite in an unread chapter");
  assert.ok(!picked.includes(b.id));
  const opened = reducer(s, { type: "section/lock", id: unread.id, locked: false, now: Date.now() });
  assert.ok(buildPlan(opened).tasks.some(t => t.conceptId === b.id));
  assert.ok(opened.sections.find(x => x.id === unread.id).readAt);
});

test("course totals count only unlocked chapters", () => {
  const { s, course } = lockedWorld();
  const m = courseMastery(s, course.id);
  assert.equal(m.total, 2);
  assert.equal(m.locked, 1);
});

// ── Running an import ──────────────────────────────────────────────────────
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function fakes({ itemDelay = {}, failExtract = new Set(), emptyPages = new Set() } = {}) {
  const calls = { extract: [], items: 0, link: 0 };
  const ai = {
    extract: async (p) => {
      calls.extract.push({ title: p.title, known: p.known.map(k => k.name) });
      await wait(5);
      if (failExtract.has(p.title)) return { ok: false, error: "Overloaded" };
      const n = p.title.match(/\d+/)[0];
      return { ok: true, data: {
        title: p.title, summary: `What chapter ${n} covers.`, gaps: [],
        sections: [{ title: `${n}.1`, summary: "", concepts: [
          { key: "k1", name: `Idea ${n}`, summary: "s", kind: "definition", importance: "core", importance_reason: "r", excerpt: "e", location: "p. 1",
            prerequisites: n === "1" ? [] : [`Idea ${Number(n) - 1}`] },
          { key: "k2", name: `Aside ${n}`, summary: "s", kind: "fact", importance: "detail", importance_reason: "r", excerpt: "e", location: "", prerequisites: [] },
        ] }],
      } };
    },
    items: async (p) => {
      calls.items++;
      await wait(itemDelay[p.sectionTitle] ?? 5);
      return { ok: true, data: { tasks: p.concepts.map(c => ({
        concept_key: c.key, ability: "explain", prompt: `Why does ${c.name} matter when you design a program?`,
        model_answer: "Because it shapes the design.", accept: [], required_points: ["Shapes the design"], misconceptions: [], hint: "",
      })) } };
    },
    critique: async ({ questions }) => ({ ok: true, data: { reviews: questions.map(q => ({
      id: q.id, verdict: "keep", scores: { importance: 5, clarity: 5, retrieval: 5, gradability: 5, accuracy: 5 }, reason: "",
      revision: { prompt: "", model_answer: "", accept: [], required_points: [], misconceptions: [], hint: "" },
    })) } }),
    link: async () => { calls.link++; return { ok: true, data: { links: [] } }; },
  };
  const book = { text: async ({ from }) => ({ ok: true, text: `[Page ${from}]\n` + (emptyPages.has(from) ? "" : "Real chapter text. ".repeat(40)) }) };
  return { ai, book, calls };
}

function storeWith(job, course) {
  let state = normalizeState({ ...emptyState(), courses: [course], bookJobs: [job] });
  return {
    getState: () => state,
    act: (type, payload = {}) => { state = reducer(state, { type, now: Date.now(), ...payload }); },
  };
}

const chapter = (n, extra = {}) => ({ title: `Chapter ${n}`, from: n * 10, to: n * 10 + 9, include: true, read: false, status: "pending", ...extra });
const newJob = (chapters, id = "job1") => ({ id, courseId: "c1", bookId: "b1", title: "Book", status: "running", baseOrder: 0, chapters });

test("a book imports chapter by chapter, in order, with prerequisites across chapters", async () => {
  // Chapter 1's questions take longest, so chapter 2 finishes writing first.
  const { ai, book, calls } = fakes({ itemDelay: { "1.1": 60, "2.1": 5, "3.1": 5 } });
  globalThis.window = { tenax: { ai } };
  const course = makeCourse({ name: "Book" }); course.id = "c1";
  const st = storeWith(newJob([chapter(1, { read: true }), chapter(2), { ...chapter(3), include: false }]), course);
  const result = await runBookJob({ jobId: "job1", getState: st.getState, act: st.act, book });
  await wait(10);
  delete globalThis.window;

  assert.equal(result, "done");
  const s = st.getState();
  assert.deepEqual(s.sections.map(x => [x.title, x.locked]), [["Chapter 1", false], ["Chapter 2", true]], "imported in chapter order; read chapters unlocked");
  assert.equal(s.sections[0].summary, "What chapter 1 covers.");
  assert.deepEqual(s.concepts.map(c => c.name), ["Idea 1", "Idea 2"], "details are left out");
  assert.deepEqual(calls.extract[1].known, ["Idea 1", "Aside 1"], "chapter 2 sees chapter 1's concepts");
  const ix = index(s);
  const edge = s.edges.find(e => e.type === "prereq");
  assert.equal(ix.concept[edge.from].name, "Idea 1");
  assert.equal(ix.concept[edge.to].name, "Idea 2");
  assert.deepEqual(s.bookJobs[0].chapters.map(c => c.status), ["done", "done", "pending"]);
  assert.equal(s.bookJobs[0].chapters[0].questions, 1);
  assert.equal(s.bookJobs[0].status, "done");
  assert.equal(calls.link, 0, "no other course to link to: no linking calls");
});

test("chapters are linked to your other courses, and only those", async () => {
  const { ai, book, calls } = fakes();
  const sent = [];
  ai.link = async (p) => { calls.link++; sent.push(p.existing.map(e => e.name)); return { ok: true, data: { links: [] } }; };
  globalThis.window = { tenax: { ai } };
  const course = makeCourse({ name: "Book" }); course.id = "c1";
  const st = storeWith(newJob([chapter(1), chapter(2)], "job6"), course);
  const other = makeCourse({ name: "Networking" });
  const sec = makeSection({ courseId: other.id, title: "Ch 1" });
  st.act("course/add", { course: other });
  st.act("section/add", { section: sec });
  st.act("import", { payload: { concepts: [makeConcept({ courseId: other.id, sectionId: sec.id, name: "Checksum" })] } });
  await runBookJob({ jobId: "job6", getState: st.getState, act: st.act, book });
  await wait(10);
  delete globalThis.window;
  assert.equal(calls.link, 2);
  assert.ok(sent.every(list => list.length === 1 && list[0] === "Checksum"), "the book's own concepts aren't sent");
});

test("scanned chapters fail on their own; repeated API failures pause the import", async () => {
  const { ai, book } = fakes({ emptyPages: new Set([10]), failExtract: new Set(["Chapter 2", "Chapter 3"]) });
  globalThis.window = { tenax: { ai } };
  const course = makeCourse({ name: "Book" }); course.id = "c1";
  const st = storeWith(newJob([chapter(1), chapter(2), chapter(3), chapter(4)], "job2"), course);
  const result = await runBookJob({ jobId: "job2", getState: st.getState, act: st.act, book });
  delete globalThis.window;
  const job = st.getState().bookJobs[0];
  assert.equal(result, "paused");
  assert.equal(job.status, "paused");
  assert.equal(job.error, "Overloaded");
  assert.deepEqual(job.chapters.map(c => c.status), ["failed", "failed", "failed", "pending"]);
  assert.match(job.chapters[0].error, /no readable text/);
});

test("a restarted import skips finished chapters and redoes interrupted ones", async () => {
  const { ai, book, calls } = fakes();
  globalThis.window = { tenax: { ai } };
  const course = makeCourse({ name: "Book" }); course.id = "c1";
  const saved = newJob([chapter(1, { status: "done" }), chapter(2, { status: "writing" })], "job3");
  const st = storeWith(saved, course); // normalizeState turns "writing" back into "pending"
  assert.equal(st.getState().bookJobs[0].chapters[1].status, "pending");
  await runBookJob({ jobId: "job3", getState: st.getState, act: st.act, book });
  delete globalThis.window;
  assert.deepEqual(calls.extract.map(c => c.title), ["Chapter 2"]);
  assert.equal(st.getState().bookJobs[0].status, "done");
});

test("a chapter with only minor details finishes with nothing added", async () => {
  const { ai, book } = fakes();
  const base = ai.extract;
  ai.extract = async (p) => {
    const r = await base(p);
    if (p.title === "Chapter 1") r.data.sections[0].concepts = r.data.sections[0].concepts.filter(c => c.importance === "detail");
    return r;
  };
  globalThis.window = { tenax: { ai } };
  const course = makeCourse({ name: "Book" }); course.id = "c1";
  const st = storeWith(newJob([chapter(1), chapter(2)], "job4"), course);
  const result = await runBookJob({ jobId: "job4", getState: st.getState, act: st.act, book });
  delete globalThis.window;
  const job = st.getState().bookJobs[0];
  assert.equal(result, "done");
  assert.deepEqual(job.chapters.map(c => [c.status, c.concepts]), [["done", 0], ["done", 1]]);
  assert.deepEqual(st.getState().sections.map(x => x.title), ["Chapter 2"]);
});

test("deleting the course mid-import stops it without leaving stray chapters", async () => {
  const { ai, book } = fakes({ itemDelay: { "1.1": 40 } });
  globalThis.window = { tenax: { ai } };
  const course = makeCourse({ name: "Book" }); course.id = "c1";
  const st = storeWith(newJob([chapter(1), chapter(2)], "job5"), course);
  const run = runBookJob({ jobId: "job5", getState: st.getState, act: st.act, book });
  await wait(20);
  st.act("course/delete", { id: "c1" });
  await run;
  delete globalThis.window;
  const s = st.getState();
  assert.equal(s.sections.length, 0);
  assert.equal(s.concepts.length, 0);
  assert.equal(s.bookJobs.length, 0);
});


// ── Half-price imports through the Batch API ───────────────────────────────
function withBatches(ai, { failAll = false, failIds = new Set(), pollsToEnd = 2 } = {}) {
  const live = { items: ai.items, critique: ai.critique };
  const calls = { create: [], liveItems: 0, liveCritique: 0 };
  ai.items = async (p) => { calls.liveItems++; return live.items(p); };
  ai.critique = async (p) => { calls.liveCritique++; return live.critique(p); };
  const batches = {};
  let n = 0;
  ai.batchCreate = async ({ kind, requests }) => {
    const id = `batch${++n}`;
    batches[id] = { kind, requests, polls: 0 };
    calls.create.push({ id, kind, count: requests.length });
    return { ok: true, batchId: id };
  };
  ai.batchStatus = async (id) => { batches[id].polls++; return { ok: true, status: batches[id].polls >= pollsToEnd ? "ended" : "in_progress" }; };
  ai.batchResults = async (id) => {
    const b = batches[id], results = {};
    for (const r of b.requests) {
      results[r.id] = failAll || failIds.has(r.id) ? { ok: false, error: "Request errored." } : await live[b.kind](r.payload);
    }
    return { ok: true, results };
  };
  return calls;
}
const fast = { sleep: async () => {}, pollMs: 0 };

test("with batches on, a chapter's questions are written and reviewed in two half-price batches", async () => {
  const { ai, book } = fakes();
  const calls = withBatches(ai);
  globalThis.window = { tenax: { ai } };
  const course = makeCourse({ name: "Book" }); course.id = "c1";
  const st = storeWith(newJob([chapter(1), chapter(2)], "jobB1"), course);
  const result = await runBookJob({ jobId: "jobB1", getState: st.getState, act: st.act, book, ...fast });
  delete globalThis.window;
  assert.equal(result, "done");
  assert.deepEqual(calls.create.map(c => c.kind).sort(), ["critique", "critique", "items", "items"], "one writer and one review batch per chapter");
  assert.equal(calls.liveItems + calls.liveCritique, 0, "nothing went live");
  const s = st.getState();
  assert.deepEqual(s.bookJobs[0].chapters.map(c => [c.status, c.questions, c.pending ?? null]), [["done", 1, null], ["done", 1, null]]);
  assert.equal(s.items.length, 2);
});

test("a paused batch import picks the same batch back up instead of paying twice", async () => {
  const { ai, book, calls: aiCalls } = fakes();
  const calls = withBatches(ai, { pollsToEnd: 3 });
  globalThis.window = { tenax: { ai } };
  const course = makeCourse({ name: "Book" }); course.id = "c1";
  const st = storeWith(newJob([chapter(1)], "jobB2"), course);
  let polls = 0;
  const sleep = async () => { if (++polls === 1) st.act("book/patch", { id: "jobB2", patch: { status: "paused" } }); };
  assert.equal(await runBookJob({ jobId: "jobB2", getState: st.getState, act: st.act, book, sleep, pollMs: 0 }), "stopped");
  const saved = st.getState().bookJobs[0].chapters[0];
  assert.equal(saved.status, "writing");
  assert.equal(saved.pending.batch.stage, "write");

  // "Restart": reload the saved state and resume.
  const reloaded = normalizeState(JSON.parse(JSON.stringify({ ...st.getState(), bookJobs: [{ ...st.getState().bookJobs[0], status: "running" }] })));
  let state = reloaded;
  const act = (type, payload = {}) => { state = reducer(state, { type, now: Date.now(), ...payload }); };
  assert.equal(state.bookJobs[0].chapters[0].status, "writing", "a chapter waiting on a batch isn't restarted");
  assert.equal(await runBookJob({ jobId: "jobB2", getState: () => state, act, book, ...fast }), "done");
  delete globalThis.window;
  assert.equal(aiCalls.extract.length, 1, "the chapter wasn't extracted again");
  assert.equal(calls.create.filter(c => c.kind === "items").length, 1, "no second writer batch");
  assert.equal(state.bookJobs[0].chapters[0].status, "done");
});

test("a request a batch can't handle is redone live; if batches don't work at all, the import goes live", async () => {
  const one = fakes();
  const partial = withBatches(one.ai, { failIds: new Set(["c0"]) });
  globalThis.window = { tenax: { ai: one.ai } };
  const course = makeCourse({ name: "Book" }); course.id = "c1";
  let st = storeWith(newJob([chapter(1)], "jobB3"), course);
  await runBookJob({ jobId: "jobB3", getState: st.getState, act: st.act, book: one.book, ...fast });
  assert.equal(partial.liveCritique, 1, "the review that errored was redone live");
  assert.equal(st.getState().bookJobs[0].chapters[0].status, "done");

  const two = fakes();
  const broken = withBatches(two.ai, { failAll: true });
  globalThis.window = { tenax: { ai: two.ai } };
  st = storeWith(newJob([chapter(1), chapter(2)], "jobB4"), course);
  await runBookJob({ jobId: "jobB4", getState: st.getState, act: st.act, book: two.book, ...fast });
  delete globalThis.window;
  assert.ok(broken.liveItems >= 2, "every chapter was redone live");
  assert.equal(broken.create.filter(c => c.kind === "critique").length, 0, "no review batch after the writer batch failed");
  assert.deepEqual(st.getState().bookJobs[0].chapters.map(c => c.status), ["done", "done"]);
});

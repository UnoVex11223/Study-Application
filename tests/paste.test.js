import { test } from "node:test";
import assert from "node:assert/strict";

import { segments, numberedLines, readPlan, pasteJob, pasteEstimate } from "../src/lib/paste.js";
import { runBookJob } from "../src/lib/bookRunner.js";
import { reducer } from "../src/state/reducer.js";
import { emptyState, makeCourse, makeSection, normalizeState, index, dropJobCourse, jobCourseIds } from "../src/lib/model.js";
import { mergeStates } from "../src/lib/sync.js";

// ── Sorting a paste ────────────────────────────────────────────────────────
const GUIDE = [
  "How to use this guide",
  "Read the parts in order.",
  "",
  "Part 1: The machine",
  "A process is a running program.",
  "Part 2: Networking",
  "TCP gives a reliable stream.",
  "Part 3: React",
  "UI is a function of state.",
  "Self-check",
  "1. What does a state setter do?",
].join("\n");

test("a paste is numbered by its non-empty lines, each knowing where it starts", () => {
  const segs = segments(GUIDE);
  assert.equal(segs.length, 10, "the blank line isn't numbered");
  for (const s of segs) assert.equal(GUIDE.slice(s.at, s.at + s.text.length), s.text);
  const lines = numberedLines(segs).split("\n");
  assert.equal(lines[2], "3: Part 1: The machine");
});

test("a very long line is numbered in pieces cut at sentence ends", () => {
  const long = "This sentence is about forty characters. ".repeat(100);
  const segs = segments(`Title\n${long}`);
  assert.ok(segs.length > 3);
  assert.ok(segs.slice(1, -1).every(s => s.text.endsWith(". ")), "pieces end at a sentence");
  assert.equal(segs.slice(1).map(s => s.text).join(""), long);
  const tight = numberedLines(segs, 400);
  assert.ok(tight.length <= 400 + segs.length * 8, "lines are cut to fit the budget");
});

test("the sorting becomes character ranges per course; the intro is skipped", () => {
  const segs = segments(GUIDE);
  const plan = readPlan({
    title: "Web guide",
    courses: [
      { name: "Web development", existing: "", parts: [{ title: "The machine", start_line: 3 }, { title: "Networking", start_line: 5 }] },
      { name: "React", existing: "", parts: [{ title: "React", start_line: 7 }] },
    ],
    skip: [{ start_line: 1, reason: "navigation" }],
  }, { text: GUIDE, segs });
  assert.equal(plan.title, "Web guide");
  assert.deepEqual(plan.courses.map(c => [c.name, c.parts.map(p => p.title)]), [["Web development", ["The machine", "Networking"]], ["React", ["React"]]]);
  const [machine, net] = plan.courses[0].parts;
  assert.equal(GUIDE.slice(machine.from, machine.to), "Part 1: The machine\nA process is a running program.\n");
  assert.ok(GUIDE.slice(net.from, net.to).startsWith("Part 2: Networking"));
  const react = plan.courses[1].parts[0];
  assert.ok(GUIDE.slice(react.from, react.to).endsWith("What does a state setter do?"), "self-check stays in its chapter, to the end");
  assert.deepEqual(plan.skipped.map(s => [s.title, s.reason]), [["How to use this guide", "navigation"]]);
});

test("unclaimed lines join the chapter before them; bad and repeated lines are ignored; same names merge", () => {
  const segs = segments(GUIDE);
  const plan = readPlan({
    title: "",
    courses: [
      { name: "Web", existing: "", parts: [{ title: "Machine", start_line: 3 }, { title: "Ghost", start_line: 99 }, { title: "Again", start_line: 3 }] },
      { name: "web", existing: "", parts: [{ title: "React", start_line: 7 }] },
    ],
    skip: [],
  }, { text: GUIDE, segs });
  assert.equal(plan.courses.length, 1, "two entries named alike are one course");
  const [first, second] = plan.courses[0].parts;
  assert.equal(first.from, 0, "the intro goes with the first chapter");
  assert.ok(GUIDE.slice(first.from, first.to).includes("Part 2: Networking"), "networking had no start of its own");
  assert.equal(second.title, "React");
});

test("material for an existing course goes into it; nothing usable means one chapter of one course", () => {
  const segs = segments(GUIDE);
  const mine = makeCourse({ name: "Web Development" });
  const plan = readPlan({ title: "", courses: [{ name: "Web", existing: "web development", parts: [{ title: "All", start_line: 1 }] }], skip: [] }, { text: GUIDE, segs, courses: [mine] });
  assert.equal(plan.courses[0].courseId, mine.id);
  assert.equal(plan.courses[0].name, "Web Development");

  const none = readPlan({ title: "Notes", courses: [{ name: "Networking", existing: "", parts: [] }], skip: [] }, { text: GUIDE, segs });
  assert.deepEqual(none.courses.map(c => [c.name, c.parts.length, c.parts[0].from, c.parts[0].to]), [["Networking", 1, 0, GUIDE.length]]);
});

test("the import makes the new courses and puts each chapter in its course, after what's there", () => {
  const s = emptyState();
  const web = makeCourse({ name: "Web development" });
  s.courses.push(web);
  s.sections.push(makeSection({ courseId: web.id, title: "Old chapter", order: 4 }));
  const plan = {
    courses: [
      { key: "c0", name: "web development", courseId: null, parts: [{ title: "Machine", from: 0, to: 10, include: true }, { title: "Net", from: 10, to: 20, include: true }] },
      { key: "c1", name: "React", courseId: null, parts: [{ title: "React", from: 20, to: 30, include: true }, { title: "Hooks", from: 30, to: 40, include: false }] },
      { key: "c2", name: "Nothing", courseId: null, parts: [{ title: "Off", from: 40, to: 50, include: false }] },
    ],
  };
  const { job, courses } = pasteJob({ state: s, plan, bookId: "t1", title: "Guide", device: { id: "d1", name: "Desk" } });
  assert.deepEqual(courses.map(c => c.name), ["React"], "a name you already have goes into that course; an untouched course isn't made");
  const react = courses[0];
  assert.deepEqual(job.chapters.map(c => [c.title, c.courseId === web.id ? "web" : c.courseId === react.id ? "react" : "?", c.order]),
    [["Machine", "web", 5], ["Net", "web", 6], ["React", "react", 0]]);
  assert.ok(job.chapters.every(c => c.read && c.status === "pending" && c.include));
  assert.equal(job.source, "text");
  assert.deepEqual(jobCourseIds(job).sort(), [web.id, react.id].sort());
});

test("estimates grow with the text and halve with batches", () => {
  const one = pasteEstimate([{ from: 0, to: 10000, include: true }], { batch: false });
  const two = pasteEstimate([{ from: 0, to: 10000, include: true }, { from: 10000, to: 20000, include: true }], { batch: false });
  const half = pasteEstimate([{ from: 0, to: 10000, include: true }], { batch: true });
  assert.ok(one.dollars[0] < 1.5 && one.dollars[1] > 1.5, "the measured ~$1.60 for 10k characters is in range");
  assert.ok(two.dollars[1] > one.dollars[1] * 1.9);
  assert.ok(half.dollars[1] < one.dollars[1] * 0.6);
});

// ── Running it ─────────────────────────────────────────────────────────────
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function fakeAi() {
  const calls = { extract: [] };
  const ai = {
    extract: async (p) => {
      calls.extract.push({ title: p.title, location: p.location, course: p.courseName, known: p.known.map(k => k.name) });
      await wait(3);
      const n = p.title.match(/\d+/)[0];
      return { ok: true, data: {
        title: p.title, summary: `About ${n}.`, gaps: [],
        sections: [{ title: `${n}`, summary: "", concepts: [
          { key: "k1", name: `Idea ${n}`, summary: "s", kind: "definition", importance: "core", importance_reason: "r", excerpt: "e", location: "",
            prerequisites: n === "1" ? [] : [`Idea ${Number(n) - 1}`] },
        ] }],
      } };
    },
    items: async (p) => ({ ok: true, data: { tasks: p.concepts.map(c => ({
      concept_key: c.key, ability: "explain", prompt: `Why does ${c.name} matter when you design a program?`,
      model_answer: "Because it shapes the design.", accept: [], required_points: ["Shapes the design"], misconceptions: [], hint: "",
    })) } }),
    critique: async ({ questions }) => ({ ok: true, data: { reviews: questions.map(q => ({
      id: q.id, verdict: "keep", scores: { importance: 5, clarity: 5, retrieval: 5, gradability: 5, accuracy: 5 }, reason: "",
      revision: { prompt: "", model_answer: "", accept: [], required_points: [], misconceptions: [], hint: "" },
    })) } }),
    link: async () => ({ ok: true, data: { links: [] } }),
  };
  return { ai, calls };
}

const TEXT = ["Chapter 1 text. ".repeat(30), "Chapter 2 text. ".repeat(30), "x", "Chapter 3 text. ".repeat(30)];
const OFFSETS = TEXT.reduce((acc, t) => [...acc, acc.at(-1) + t.length], [0]);
const book = { text: async ({ from, to }) => ({ ok: true, text: TEXT.join("").slice(from, to) }) };

function pastedWorld() {
  const a = makeCourse({ name: "Web" }); a.id = "ca";
  const b = makeCourse({ name: "React" }); b.id = "cb";
  const ch = (n, courseId, order) => ({ title: `Chapter ${n}`, from: OFFSETS[n - 1], to: OFFSETS[n], courseId, order, include: true, read: true, status: "pending" });
  const job = { id: "jp", source: "text", courseId: "ca", bookId: "t1", title: "Guide", status: "running", baseOrder: 0,
    chapters: [ch(1, "ca", 0), ch(2, "cb", 0), { ...ch(3, "ca", 1), from: OFFSETS[2], to: OFFSETS[3] }, { ...ch(3, "ca", 1), title: "Chapter 4", from: OFFSETS[3], to: OFFSETS[4] }] };
  let state = normalizeState({ ...emptyState(), courses: [a, b], bookJobs: [job] });
  return {
    getState: () => state,
    act: (type, payload = {}) => { state = reducer(state, { type, now: Date.now(), ...payload }); },
  };
}

test("a pasted guide fills several courses in reading order, building on itself across them", async () => {
  const { ai, calls } = fakeAi();
  globalThis.window = { tenax: { ai } };
  const st = pastedWorld();
  const result = await runBookJob({ jobId: "jp", getState: st.getState, act: st.act, book });
  await wait(10);
  delete globalThis.window;

  assert.equal(result, "done");
  const s = st.getState();
  const ix = index(s);
  assert.deepEqual(ix.sectionsByCourse.ca.map(x => [x.title, x.order, x.locked]), [["Chapter 1", 0, false], ["Chapter 4", 1, false]]);
  assert.deepEqual(ix.sectionsByCourse.cb.map(x => [x.title, x.order]), [["Chapter 2", 0]]);
  assert.ok(s.sections.every(x => !x.pages), "a paste has no page numbers");
  assert.ok(calls.extract.every(c => c.location === ""));
  assert.deepEqual(calls.extract.map(c => c.course), ["Web", "React", "Web"], "each chapter is read as part of its course; the one-letter chapter is skipped");
  assert.deepEqual(calls.extract[1].known, ["Idea 1"], "the React chapter knows what the Web chapter covered");
  const edge = s.edges.find(e => e.type === "prereq" && ix.concept[e.to].name === "Idea 2");
  assert.equal(ix.concept[edge.from].courseId, "ca", "a prerequisite across courses");
  assert.equal(s.bookJobs[0].chapters[2].status, "done");
  assert.equal(s.bookJobs[0].chapters[2].concepts, 0);
});

test("deleting one course of a pasted guide leaves the import for the others", () => {
  const st = pastedWorld();
  const job = st.getState().bookJobs[0];
  const kept = dropJobCourse(job, "cb");
  assert.deepEqual(kept.chapters.map(c => c.include), [true, false, true, true]);
  assert.equal(kept.courseId, "ca");
  const moved = dropJobCourse(job, "ca");
  assert.equal(moved.courseId, "cb");
  assert.equal(dropJobCourse(moved, "cb"), null, "the last course gone, the import goes");
  st.act("course/delete", { id: "cb" });
  assert.equal(st.getState().bookJobs.length, 1);
  st.act("course/delete", { id: "ca" });
  assert.equal(st.getState().bookJobs.length, 0);
});

test("syncing keeps a pasted guide's import while any of its courses exists", () => {
  const st = pastedWorld();
  const s = st.getState();
  const job = { ...s.bookJobs[0], courseId: "gone" };
  const { state: merged } = mergeStates(s, [{ state: { ...s, bookJobs: [job] }, deviceName: "Laptop" }]);
  assert.equal(merged.bookJobs.length, 1);
  const { state: none } = mergeStates(s, [{ state: { ...s, courses: [], bookJobs: [job] }, deviceName: "Laptop" }]);
  assert.ok(none.bookJobs.length <= 1);
});

// What keeps a wrong or unchecked question out of your reviews: the holes
// found in a review of the question pipeline (November 2026), each pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";

import { judge, selectForConcept, lintQuestion } from "../src/lib/quality.js";
import { matchesAccepted } from "../src/lib/grade.js";
import { sourceIndex, locateQuote, groundQuote } from "../src/lib/source.js";
import { reviewCandidates, blindCheck, needsBlindSolve, applyLessonFixes, planRebuild, moreQuestions, writeAndReview, extractMaterial, NO_REVIEW } from "../src/lib/ai.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem } from "../src/lib/model.js";

const scores = { importance: 5, clarity: 5, focus: 5, retrieval: 5, gradability: 5, accuracy: 5 };
const keep = (id) => ({ id, verdict: "keep", scores, reason: "" });
const printQ = (o = {}) => ({
  id: "q0_0", conceptKey: "k", ability: "apply", level: 3, shape: "a number",
  prompt: "What does `printf(\"%d\", 7 / 2);` print in C?", answer: "3: integer division truncates.",
  accept: ["3"], points: ["3"], misconceptions: [], hint: "", diagram: null, ...o,
});
const termQ = (o = {}) => ({
  id: "q0_1", conceptKey: "k", ability: "recall", level: 1, shape: "one term",
  prompt: "Which term names a constant written directly in code without a name?", answer: "A magic number.",
  accept: ["magic number"], points: ["magic number"], misconceptions: [], hint: "", diagram: null, ...o,
});

// ── The gate ───────────────────────────────────────────────────────────────
test("a revision replaces the question whole: the old accepted answers never mark the new question", () => {
  const revision = { shape: "a number", prompt: "What does `printf(\"%d\", 9 / 2);` print in C?", model_answer: "4: integer division truncates.", accept: [], required_points: ["4"], misconceptions: [], hint: "", diagram: "" };
  const j = judge(printQ({ diagram: { type: "bits", bits: "1" } }), { verdict: "revise", scores, reason: "", revision });
  assert.equal(j.keep, true);
  assert.deepEqual(j.q.accept, [], "the original's accept list is gone");
  assert.equal(matchesAccepted("3", j.q.accept), false);
  assert.deepEqual(j.q.points, ["4"]);
  assert.equal(j.q.diagram, null, "and so is a diagram the revision doesn't have");
  // A revision that gives exact answers but no key point is graded against its first accepted answer.
  const exact = judge(printQ(), { verdict: "revise", scores, reason: "", revision: { ...revision, accept: ["4", " 4 "], required_points: [] } });
  assert.deepEqual([exact.q.accept, exact.q.points], [["4"], ["4"]]);
});

test("'revise' without the rewrite drops the question: its scores vouched for a rewrite that isn't there", () => {
  for (const revision of [null, { prompt: "  ", model_answer: "" }]) {
    const j = judge(termQ(), { verdict: "revise", scores, reason: "Asks two things", revision });
    assert.equal(j.keep, false);
    assert.match(j.reasons[0], /didn't supply one: Asks two things/);
  }
});

test("a question the critic skipped is dropped when the critic ran, and kept (rule checks only) when it didn't", () => {
  const a = termQ({ id: "a" }), b = printQ({ id: "b" });
  const ran = selectForConcept([a, b], { a: keep("a"), wrong_id: keep("wrong_id") }, "core");
  assert.deepEqual(ran.kept.map(q => q.id), ["a"]);
  assert.match(ran.dropped[0].reasons[0], /skipped/);
  assert.deepEqual(selectForConcept([a, b], {}, "core").kept.map(q => q.id), ["a", "b"], "no critic at all: the manual import warns and shows them");
  assert.deepEqual(selectForConcept([a, b], {}, "core", { reviewed: true }).kept, [], "told the critic ran, nothing unreviewed passes");
});

test("a question that failed the blind solve is dropped, reviewed or not", () => {
  const reason = "Solved without seeing the answer, a second model got \"4\"…";
  assert.deepEqual(judge(printQ(), { ...keep("q0_0"), blind: reason }).reasons, [reason]);
  const unreviewed = judge(printQ(), { blind: reason });
  assert.equal(unreviewed.keep, false);
  assert.equal(unreviewed.dims, null);
  assert.equal(selectForConcept([printQ()], { q0_0: { blind: reason } }, "core").kept.length, 0);
});

test("rule checks: a yes/no question is one wherever it sits, and true/false is a guess", () => {
  const codes = (prompt) => lintQuestion({ ability: "explain", level: 2, shape: "one word", prompt, answer: "yes", accept: [], points: ["yes"] }).issues.map(i => i.code);
  assert.ok(codes("Given a sorted array of numbers. Is binary search faster than linear search on it?").includes("yes-no"));
  assert.ok(codes("True or false: a C array name decays to a pointer when passed to a function.").includes("yes-no"));
  assert.ok(codes("Which is evaluated first in C, the left operand or the right operand of `&&`?").includes("either-or"));
  assert.deepEqual(codes("Which operand of `&&` does C evaluate first?"), []);
  assert.deepEqual(codes("A function is passed an array. What does the parameter actually hold?"), []);
  assert.ok(!codes("Is it safe to free a pointer twice, and what happens if you do? Explain why.").includes("yes-no"), "an open question that starts like one");
});

// ── Exact answers ──────────────────────────────────────────────────────────
test("instant marking forgives a slip of the fingers, never a different value or term", () => {
  for (const [answer, accepted] of [
    ["8 bytes", "4 bytes"], ["15 bits", "16 bits"], ["HTTP 403", "HTTP 404"], ["port 444", "port 443"], ["base 10", "base 16"],
    ["layer 4", "layer 3"], ["100 s", "100 ms"], ["0x1F3B", "0x1F3A"], ["asynchronous", "synchronous"], ["symmetric", "asymmetric"],
    ["hypotension", "hypertension"], ["intramolecular", "intermolecular"], ["propene", "propane"], ["adsorption", "absorption"],
    ["atypical", "typical"], ["sulfite", "sulfate"],
  ]) assert.equal(matchesAccepted(answer, [accepted]), false, `${answer} is not ${accepted}`);
  for (const [answer, accepted] of [
    ["magic numbr", "magic number"], ["dereferrence", "dereference"], ["polymorhpism", "polymorphism"], ["The Heap", "heap"],
    ["encapsulaton", "encapsulation"], ["4 bytes", "4 bytes"], ["synchronous", "Synchronous."],
  ]) assert.equal(matchesAccepted(answer, [accepted]), true, `${answer} is ${accepted}`);
});

// ── The source ─────────────────────────────────────────────────────────────
const CHAPTER = `[Page 12]
4.3 External Variables

A C program consists of a set of external objects, which are either variables or functions. External vari-
ables are defined outside of any function, and are thus potentially available to many functions.
[Page 13]
Because external variables are globally accessible, they provide an alternative to function arguments
and return values for communicating data between functions. Any function may access an external
variable by referring to it by name, if the name has been declared somehow.`;

test("a concept's quote is looked up in the source, across line breaks, hyphens and page markers", () => {
  const ix = sourceIndex(CHAPTER);
  const quote = "External variables are defined outside of any function, and are thus potentially available to many functions. Because external variables are globally accessible";
  const where = locateQuote(ix, quote);
  assert.ok(where, "found although the source breaks a word across lines and a page starts in the middle");
  assert.ok(CHAPTER.slice(where.start, where.end).startsWith("External vari-\nables are defined"));
  assert.ok(locateQuote(ix, "defined outside of any function … globally accessible, they provide an alternative"), "an elided quote is found by its longest run");
  assert.equal(locateQuote(ix, "External variables live in the data segment for the whole run."), null);
  assert.equal(locateQuote(ix, "a set of"), null, "too short to mean anything");
});

test("a quote that isn't in the source is discarded; one that is brings its passage for the writer and reviewer", async () => {
  const ix = sourceIndex(CHAPTER);
  const real = groundQuote(ix, "Any function may access an external variable by referring to it by name");
  assert.ok(real.excerpt && real.passage.includes("alternative to function arguments") && !real.passage.includes("[Page"));
  assert.deepEqual(groundQuote(ix, "External variables are always initialized to zero by the loader at startup."), { excerpt: "", passage: "" });
  const reworded = groundQuote(ix, "A C program consists of a set of external objects: variables and functions, nothing else.");
  assert.equal(reworded.excerpt, "", "not the source's words, so not shown as a quote");
  assert.ok(reworded.passage.includes("External Variables"), "but its opening is there, so the passage is still found");

  // End to end through extraction.
  const s = emptyState();
  const course = makeCourse({ name: "C" });
  s.courses.push(course);
  const concept = (key, excerpt) => ({ key, name: `Idea ${key}`, summary: "s", kind: "definition", importance: "core", importance_reason: "", excerpt, location: "", prerequisites: [] });
  globalThis.window = { tenax: { ai: { extract: async () => ({ ok: true, data: { title: "Ch 4", gaps: [], sections: [{ title: "4.3", concepts: [
    concept("k1", "they provide an alternative to function arguments and return values"),
    concept("k2", "External variables are stored in read-only memory until first use."),
  ] }] } }) } } };
  const ex = await extractMaterial({ state: s, courseId: course.id, title: "Ch 4", text: CHAPTER });
  delete globalThis.window;
  const [k1, k2] = ex.sections[0].concepts;
  assert.ok(k1.excerpt && k1.passage.includes("globally accessible"));
  assert.deepEqual([k2.excerpt, k2.passage], ["", ""], "an invented quote is never shown as your source's words");
});

// ── Review, re-ask, blind solve ────────────────────────────────────────────
function reviewer({ critique, solve, grade } = {}) {
  const calls = { critique: [], solve: [], grade: [] };
  const a = {
    critique: async (p) => { calls.critique.push(p); return critique(p, calls.critique.length); },
    ...(solve ? { solve: async (p) => { calls.solve.push(p); return { ok: true, data: { answers: solve(p) } }; } } : {}),
    ...(grade ? { grade: async (p) => { calls.grade.push(p); return { ok: true, data: grade(p) }; } } : {}),
  };
  return { a, calls };
}
const allKeep = (p) => ({ ok: true, data: { reviews: p.questions.map(q => keep(q.id)), revisions: [], lessons: [] } });
const run = (a, candidates, extra = {}) => reviewCandidates({ a, courseName: "C", sectionTitle: "Ch 1", concepts: [{ key: "k", name: "K", summary: "s", importance: "core" }], candidates, ...extra });

test("the critic is tried twice, and questions it left out are sent back once", async () => {
  const flaky = reviewer({ critique: (p, n) => (n === 1 ? { ok: false, error: "Overloaded" } : allKeep(p)) });
  globalThis.window = { tenax: { ai: flaky.a } };
  const r1 = await run(flaky.a, [termQ()]);
  assert.equal(r1.reviewed, true);
  assert.equal(flaky.calls.critique.length, 2);

  const forgetful = reviewer({ critique: (p, n) => (n === 1 ? { ok: true, data: { reviews: [keep(p.questions[0].id)], revisions: [], lessons: [] } } : allKeep(p)) });
  const r2 = await run(forgetful.a, [termQ({ id: "a" }), termQ({ id: "b", prompt: "Which keyword declares a variable that is defined in another file?", accept: ["extern"] })]);
  assert.deepEqual(forgetful.calls.critique.map(c => c.questions.map(q => q.id)), [["a", "b"], ["b"]]);
  assert.equal(r2.reviews.b.verdict, "keep");

  const down = reviewer({ critique: () => ({ ok: false, error: "Overloaded" }) });
  assert.equal((await run(down.a, [termQ()])).reviewed, false);
  delete globalThis.window;
});

test("where nobody looks questions over first, an unreviewed batch adds nothing", async () => {
  const down = reviewer({ critique: () => ({ ok: false, error: "Overloaded" }) });
  down.a.items = async ({ concepts }) => ({ ok: true, data: { lessons: [], tasks: concepts.map(c => ({ concept_key: c.key, level: 3, ability: "apply", shape: "a number", prompt: "What does `printf(\"%d\", 7 / 2);` print in C?", model_answer: "3", accept: ["3"], required_points: ["3"], misconceptions: [], hint: "", diagram: "" })) } });
  const concepts = [{ key: "k", name: "K", summary: "s", kind: "fact", importance: "core" }];
  const strict = await writeAndReview({ a: down.a, courseName: "C", sectionTitle: "S", concepts, tag: "q0", requireReview: true });
  assert.deepEqual(strict, { ok: false, error: NO_REVIEW });
  const manual = await writeAndReview({ a: down.a, courseName: "C", sectionTitle: "S", concepts, tag: "q0" });
  assert.equal(manual.ok && manual.reviewed, false, "a manual import still gets them, flagged as unreviewed");

  // A top-up goes straight into your library: nothing is added.
  const s = emptyState();
  const course = makeCourse({ name: "C" });
  const sec = makeSection({ courseId: course.id, title: "Ch 1" });
  const c = makeConcept({ courseId: course.id, sectionId: sec.id, name: "Division", importance: "core" });
  s.courses.push(course); s.sections.push(sec); s.concepts.push(c);
  globalThis.window = { tenax: { ai: down.a } };
  const added = [];
  const res = await moreQuestions({ state: s, conceptIds: [c.id], onItems: (items) => added.push(...items) });
  delete globalThis.window;
  assert.equal(res.ok, false);
  assert.deepEqual(added, []);
});

test("blind solve: a different answer drops the question; the same answer, in any accepted form, keeps it", async () => {
  const wrongKey = printQ({ id: "wrong", prompt: "What does `printf(\"%d\", 9 / 2);` print in C?", answer: "5", accept: ["5"], points: ["5"] });
  const rightKey = printQ({ id: "right" });
  const sentence = printQ({ id: "sentence", level: 4, ability: "distinguish", shape: "one sentence", prompt: "What makes `7 / 2` differ from `7 / 2.0` in C?", answer: "The first is integer division.", accept: [], points: ["Integer division truncates; with a double operand it doesn't"] });
  const { a, calls } = reviewer({
    critique: allKeep,
    solve: (p) => p.questions.map(q => ({ id: q.id, working: "", problem: "", answer: q.id === "sentence" ? "With two ints the result is truncated to 3; with a double it is 3.5." : q.id === "wrong" ? "4" : "3" })),
    grade: (p) => ({ points: [{ met: p.answer.includes("truncated"), evidence: p.answer.includes("truncated") ? "the result is truncated to 3" : "" }], misconceptions_found: [], uncertain: false, follow_up: "", feedback: "" }),
  });
  globalThis.window = { tenax: { ai: a } };
  const r = await run(a, [wrongKey, rightKey, sentence, termQ({ id: "term" })]);
  delete globalThis.window;
  assert.deepEqual(calls.solve[0].questions.map(q => q.id), ["wrong", "right", "sentence"], "a term's name isn't solved blind");
  assert.ok(!("model_answer" in calls.solve[0].questions[0]) && !JSON.stringify(calls.solve[0]).includes("truncates"), "the solver never sees an answer");
  assert.match(r.reviews.wrong.blind, /got "4"/);
  assert.equal(r.reviews.right.blind, undefined, "matched an accepted answer: no grader needed");
  assert.equal(r.reviews.sentence.blind, undefined, "graded by meaning, the expert's answer passes");
  assert.deepEqual(calls.grade.map(g => g.answer.slice(0, 1)), ["4", "W"], "only what didn't match exactly goes to the grader");
  const picked = selectForConcept([wrongKey, rightKey], r.reviews, "core", { reviewed: true });
  assert.deepEqual(picked.kept.map(q => q.id), ["right"]);
  assert.match(picked.dropped[0].reasons[0], /second model/);
});

test("blind solve checks the question as revised, and leaves alone what it can't check", async () => {
  const revised = { id: "q0_0", shape: "a number", prompt: "What does `printf(\"%d\", 9 / 2);` print in C?", model_answer: "4", accept: ["4"], required_points: ["4"], misconceptions: [], hint: "", diagram: "" };
  const { a, calls } = reviewer({
    critique: (p) => ({ ok: true, data: { reviews: [{ id: p.questions[0].id, verdict: "revise", scores, reason: "" }], revisions: [revised], lessons: [] } }),
    solve: (p) => p.questions.map(q => ({ id: q.id, working: "", answer: "4", problem: "" })),
  });
  const r = await run(a, [printQ()]);
  assert.match(calls.solve[0].questions[0].prompt, /9 \/ 2/);
  assert.equal(r.reviews.q0_0.blind, undefined);

  assert.equal(needsBlindSolve(termQ()), false);
  assert.equal(needsBlindSolve(termQ({ level: 2 })), true, "a fact with an exact answer");
  assert.deepEqual(await blindCheck({ a: {}, questions: [printQ()] }), {}, "no solver: nothing is failed");
  assert.deepEqual(await blindCheck({ a: { solve: async () => ({ ok: false, error: "x" }) }, questions: [printQ()] }), {});
  // No grader to settle a different form: only a plainly different number fails.
  const noGrader = { solve: async (p) => ({ ok: true, data: { answers: p.questions.map(q => ({ id: q.id, working: "", problem: "", answer: q.id === "n" ? "4" : "it prints three" })) } }) };
  assert.deepEqual(Object.keys(await blindCheck({ a: noGrader, questions: [printQ({ id: "n" }), printQ({ id: "w" })] })), ["n"]);
});

// ── Lessons and rebuilds ───────────────────────────────────────────────────
test("the reviewer's lesson corrections replace the lesson; a lesson it emptied is removed", async () => {
  const lessons = { k1: { terms: [{ term: "extern", definition: "Defines a variable." }], example: "bad", diagram: null }, k2: { terms: [], example: "gives the answer away", diagram: null }, k3: { terms: [], example: "fine", diagram: null } };
  const fixed = applyLessonFixes(lessons, { lessons: [
    { concept_key: "k1", problem: "extern declares, it doesn't define", terms: [{ term: "extern", definition: "Declares a variable defined elsewhere." }], worked_example: "good", diagram: "" },
    { concept_key: "k2", problem: "same snippet as step 3", terms: [], worked_example: "", diagram: "" },
    { concept_key: "unknown", problem: "", terms: [], worked_example: "x", diagram: "" },
  ] });
  assert.equal(fixed.k1.terms[0].definition, "Declares a variable defined elsewhere.");
  assert.equal(fixed.k1.example, "good");
  assert.deepEqual(Object.keys(fixed), ["k1", "k3"]);
  assert.equal(lessons.k1.example, "bad", "the originals aren't touched");

  // The critic is shown the lessons, and its fixes come back from a review.
  const { a, calls } = reviewer({ critique: (p) => ({ ok: true, data: { reviews: p.questions.map(q => keep(q.id)), revisions: [], lessons: [{ concept_key: "k", problem: "wrong", terms: [], worked_example: "right", diagram: "" }] } }) });
  const r = await run(a, [termQ()], { lessons: { k: { terms: [], example: "wrong", diagram: null } } });
  assert.equal(calls.critique[0].lessons[0].worked_example, "wrong");
  assert.equal(r.lessons.k.example, "right");
});

test("a rebuild never leaves a concept with less than it had", () => {
  const c = makeConcept({ courseId: "c", sectionId: "s", name: "extern", importance: "core" });
  const old = [
    makeItem({ conceptId: c.id, level: 1, ability: "recall", prompt: "Which keyword declares a variable that's defined in another file?", answer: "extern", accept: ["extern"], quality: { score: 5 } }),
    makeItem({ conceptId: c.id, level: 3, ability: "apply", prompt: "Write the declaration that lets this file use the int `count` defined elsewhere.", answer: "extern int count;", accept: ["extern int count;"], quality: { score: 5 } }),
    makeItem({ conceptId: c.id, level: 4, ability: "distinguish", prompt: "What separates declaring an external variable from defining it?", answer: "Defining allocates storage.", points: ["storage"], quality: { score: 5 } }),
    makeItem({ conceptId: c.id, level: 2, ability: "explain", prompt: "An old flagged question about linkage and storage duration", answer: "x", points: ["x"], quality: { score: 4 }, flag: { reason: "unclear" } }),
  ];
  const only = { id: "q", level: 3, ability: "apply", shape: "one line of code", prompt: "Write the line that makes the double `total`, defined in another file, usable here.", answer: "extern double total;", accept: ["extern double total;"], points: ["extern double total;"], misconceptions: [], hint: "" };
  const plan = planRebuild(c, old, [only]);
  assert.deepEqual(plan.remove, [old[1].id, old[3].id], "its step is replaced and the flagged one goes; steps 1 and 4 stay");
  assert.equal(plan.add.length, 1);
  // A full new ladder replaces everything it doesn't reuse.
  const full = [1, 2, 4].map(level => ({ ...only, id: `n${level}`, level, prompt: `${only.prompt} (${level})` }));
  assert.deepEqual(planRebuild(c, old, [only, ...full]).remove.length, 4);
});

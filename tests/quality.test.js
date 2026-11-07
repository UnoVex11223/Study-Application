import { test } from "node:test";
import assert from "node:assert/strict";

import { lintQuestion, judge, selectForConcept, similarity, LEECH_LAPSES } from "../src/lib/quality.js";
import { reducer } from "../src/state/reducer.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, index } from "../src/lib/model.js";
import { buildPlan } from "../src/lib/planner.js";
import { newSrs } from "../src/lib/fsrs.js";

const q = (fields) => ({ ability: "explain", prompt: "Why might you replace a numeric literal with a named constant?", answer: "It documents meaning and centralizes changes.", accept: [], points: ["Documents what the value means"], misconceptions: [], hint: "", ...fields });
const codes = (r) => r.issues.map(i => i.code);

// ── Rules ──────────────────────────────────────────────────────────────────
test("rules pass a well-formed question", () => {
  const r = lintQuestion(q());
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("rules block recall questions that contain their own answer", () => {
  const r = lintQuestion(q({ ability: "recall", prompt: "What is a magic number in C code, briefly?", answer: "Magic number", accept: ["magic number"] }));
  assert.ok(codes(r).includes("leak"));
  assert.equal(r.ok, false);
});

test("rules block yes/no, book-dependent and sentence-length recall questions", () => {
  assert.ok(codes(lintQuestion(q({ prompt: "Is a pointer a variable that stores an address?" }))).includes("yes-no"));
  assert.equal(lintQuestion(q({ prompt: "Is it better to use a pointer or an index here, and why?" })).ok, true);
  assert.ok(codes(lintQuestion(q({ prompt: "According to the author, what problem do pointers solve?" }))).includes("context"));
  assert.ok(codes(lintQuestion(q({ prompt: "What does the example in Figure 11.2 show about aliasing?" }))).includes("context"));
  assert.ok(codes(lintQuestion(q({ ability: "recall", prompt: "What happens when you dereference a null pointer in C?", answer: "x", accept: ["the program has undefined behavior and will probably crash at runtime"] }))).includes("recall-long"));
});

test("rules require a rubric or accepted answers", () => {
  assert.ok(codes(lintQuestion(q({ points: [] }))).includes("no-rubric"));
  assert.ok(codes(lintQuestion(q({ ability: "recall", prompt: "Name the operator that yields an object's address.", answer: "&", accept: [] }))).includes("no-accept"));
});

test("near-duplicates are caught", () => {
  const a = q({ prompt: "Why replace a magic number with a named constant in C code?" });
  const b = q({ prompt: "In C code, why would you replace a magic number with a named constant?" });
  assert.ok(similarity(a.prompt, b.prompt) >= 0.7);
  assert.ok(codes(lintQuestion(b, { others: [a] })).includes("duplicate"));
});

// ── Critic + selection ─────────────────────────────────────────────────────
const review = (verdict, scores, extra = {}) => ({ verdict, scores: { importance: 5, clarity: 5, retrieval: 5, gradability: 5, accuracy: 5, ...scores }, reason: "r", revision: { prompt: "", model_answer: "", accept: [], required_points: [], misconceptions: [], hint: "" }, ...extra });

test("critic: any score below 4 drops the question; revisions replace the original", () => {
  assert.equal(judge(q(), review("keep", {})).keep, true);
  assert.equal(judge(q(), review("keep", { importance: 3 })).keep, false);
  assert.equal(judge(q(), review("drop", {})).keep, false);
  const rev = judge(q(), review("revise", {}, { revision: { prompt: "Why is a named constant better than a bare 86400 in a timeout calculation?", model_answer: "It says what 86400 means.", accept: [], required_points: ["Names the meaning (seconds per day)"], misconceptions: [], hint: "" } }));
  assert.equal(rev.keep, true);
  assert.equal(rev.revised, true);
  assert.match(rev.q.prompt, /86400/);
  assert.equal(rev.score, 5);
});

test("selection caps questions per concept, preferring variety and higher scores", () => {
  const cands = [
    q({ id: "a", ability: "explain", prompt: "Why do C programmers name numeric constants instead of writing them inline?" }),
    q({ id: "b", ability: "explain", prompt: "What maintenance problem appears when the same unexplained literal is scattered through a codebase?" }),
    q({ id: "c", ability: "apply", prompt: "Rewrite `for (i = 0; i < 12; i++)` so the loop bound says what 12 means.", points: ["Introduces a named constant for 12"] }),
    q({ id: "d", ability: "recall", prompt: "What term describes an unexplained numeric literal in source code?", answer: "Magic number", accept: ["magic number"] }),
    q({ id: "e", ability: "explain", prompt: "Is this trivia?" }),
    q({ id: "f", ability: "explain", prompt: "How does a named constant make a later change to the value safer?" }),
  ];
  const reviews = { a: review("keep", {}), b: review("keep", { clarity: 4 }), c: review("keep", {}), d: review("keep", { importance: 4 }), e: review("drop", { importance: 2 }), f: review("keep", { clarity: 4, retrieval: 4 }) };
  const { kept, dropped } = selectForConcept(cands, reviews, "core");
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map(k => k.id), ["a", "c"], "one to know the idea, one to use it");
  assert.ok(dropped.find(d => d.id === "e"));
  assert.ok(dropped.find(d => d.id === "f").reasons[0].includes("already has its 2"));
  const supporting = selectForConcept(cands, reviews, "supporting");
  assert.deepEqual(supporting.kept.map(k => k.id), ["a"], "the single best question");
  const detail = selectForConcept(cands.slice(0, 3), reviews, "detail");
  assert.equal(detail.kept.length, 1);
});

test("a core concept's pair covers knowing and using the idea, even when a same-group question scores higher", () => {
  const cands = [
    q({ id: "rc", ability: "recall", prompt: "What term describes an unexplained numeric literal in source code?", answer: "Magic number", accept: ["magic number"] }),
    q({ id: "ex", ability: "explain", prompt: "Why do C programmers name numeric constants instead of writing them inline?" }),
    q({ id: "ap", ability: "apply", prompt: "Rewrite `for (i = 0; i < 12; i++)` so the loop bound says what 12 means.", points: ["Introduces a named constant for 12"] }),
  ];
  const reviews = { rc: review("keep", {}), ex: review("keep", {}), ap: review("keep", { clarity: 4 }) };
  const { kept } = selectForConcept(cands, reviews, "core");
  assert.deepEqual(kept.map(k => k.id), ["rc", "ap"]);
  // With no "use" question passing, the second slot goes to the other "know" type.
  const noUse = selectForConcept(cands.slice(0, 2), reviews, "core");
  assert.deepEqual(noUse.kept.map(k => k.id), ["rc", "ex"]);
});

test("without the critic, the rules alone still filter", () => {
  const { kept, dropped } = selectForConcept([
    q({ id: "a" }),
    q({ id: "b", prompt: "Does naming constants help readability?" }),
  ], {}, "core");
  assert.deepEqual(kept.map(k => k.id), ["a"]);
  assert.equal(dropped[0].id, "b");
});

// ── Flagging in use ────────────────────────────────────────────────────────
function oneItemState() {
  const s = emptyState();
  const course = makeCourse({ name: "C" });
  const sec = makeSection({ courseId: course.id, title: "S" });
  const c = makeConcept({ courseId: course.id, sectionId: sec.id, name: "Pointer" });
  const it = makeItem({ conceptId: c.id, ability: "explain", prompt: "p", answer: "a", points: ["a"] });
  c.srs = { ...newSrs(), state: "review", stability: 5, difficulty: 5, lastReview: Date.now() - 6 * 864e5, due: Date.now() - 1000, reps: 3, lapses: 0 };
  s.courses.push(course); s.sections.push(sec); s.concepts.push(c); s.items.push(it);
  return { s, it };
}

test("a reported question leaves sessions until restored", () => {
  const { s, it } = oneItemState();
  assert.equal(buildPlan(s).tasks.length, 1);
  const flagged = reducer(s, { type: "item/flag", id: it.id, reason: "unclear", now: Date.now() });
  assert.equal(flagged.items[0].flag.reason, "unclear");
  assert.equal(buildPlan(flagged).tasks.length, 0);
  const restored = reducer(flagged, { type: "item/unflag", id: it.id, now: Date.now() });
  assert.equal(buildPlan(restored).tasks.length, 1);
});

test("questions missed 5 times or overruled twice are flagged automatically", () => {
  let { s, it } = oneItemState();
  let now = Date.now();
  for (let i = 0; i < LEECH_LAPSES; i++) {
    s = reducer(s, { type: "attempt", itemId: it.id, verdict: "incorrect", rating: 1, now });
    now += 60e3;
    s = reducer(s, { type: "attempt", itemId: it.id, verdict: "correct", rating: 3, now });
    now += 11 * 60e3;
    s = reducer(s, { type: "attempt", itemId: it.id, verdict: "correct", rating: 3, now });
    now += 30 * 864e5;
  }
  assert.equal(s.items[0].flag?.reason, "leech");

  ({ s, it } = oneItemState());
  s = reducer(s, { type: "attempt", itemId: it.id, verdict: "correct", rating: 3, overridden: true, now: Date.now() });
  assert.equal(s.items[0].flag ?? null, null, "not flagged after one overrule");
  s = reducer(s, { type: "attempt", itemId: it.id, verdict: "correct", rating: 3, overridden: true, now: Date.now() + 1000 });
  assert.equal(s.items[0].flag?.reason, "disputed");
});

test("a rewritten question starts fresh", () => {
  let { s, it } = oneItemState();
  const t0 = Date.now();
  s = reducer(s, { type: "attempt", itemId: it.id, verdict: "incorrect", rating: 1, now: t0 });
  assert.equal(index(s).itemStats[it.id].seen, 1);
  const flagged = reducer(s, { type: "item/flag", id: it.id, reason: "wrong", now: t0 + 1 });
  const fixed = reducer(flagged, { type: "item/replace", id: it.id, fields: { prompt: "Better prompt here please", answer: "b", points: ["b"] }, now: t0 + 2 });
  assert.equal(fixed.items[0].flag, null);
  assert.deepEqual(index(fixed).itemStats[it.id], { seen: 0, lastSeen: 0, missDays: [] });
  assert.equal(fixed.concepts[0].srs.state, s.concepts[0].srs.state, "the concept's memory schedule is kept");
  assert.equal(fixed.items[0].prompt, "Better prompt here please");
  assert.equal(fixed.items[0].quality.rewritten, true);
});

test("topping up counts existing questions, skips their duplicates and fills missing types first", () => {
  const existing = [
    q({ ability: "explain", prompt: "Why do C programmers name numeric constants instead of writing them inline?" }),
  ];
  const cands = [
    q({ id: "dup", ability: "explain", prompt: "Why do C programmers name numeric constants instead of writing them inline?" }),
    q({ id: "x", ability: "explain", prompt: "How does a named constant make a later change to the value safer?" }),
    q({ id: "ap", ability: "apply", prompt: "Rewrite `for (i = 0; i < 12; i++)` so the loop bound says what 12 means.", points: ["Introduces a named constant for 12"] }),
    q({ id: "rc", ability: "recall", prompt: "What term describes an unexplained numeric literal in source code?", answer: "Magic number", accept: ["magic number"] }),
  ];
  const reviews = Object.fromEntries(cands.map(c => [c.id, review("keep", {})]));
  const { kept, dropped } = selectForConcept(cands, reviews, "core", { existing });
  assert.equal(kept.length, 1, "2 allowed, 1 already there");
  assert.deepEqual(kept.map(k => k.id), ["ap"], "the missing 'use' question goes first");
  assert.ok(dropped.find(d => d.id === "dup"));
  assert.equal(selectForConcept(cands, reviews, "supporting", { existing }).kept.length, 0);
  assert.equal(selectForConcept(cands, reviews, "core", { existing, extra: 1 }).kept.length, 2, "a note's extra slot");
});


// ── Ladders ────────────────────────────────────────────────────────────────
const MUX = { type: "circuit", inputs: ["a", "b", "sel"], gates: [{ id: "m", op: "MUX", in: ["a", "b", "sel"] }], outputs: { out: "m" }, values: { a: 1, b: 0, sel: 1 }, ask: "out" };

test("ladder questions ask for one thing: two-part prompts and multi-point steps are blocked", () => {
  const step = (fields) => q({ level: 2, shape: "one sentence", ...fields });
  assert.equal(lintQuestion(step({})).ok, true);
  assert.ok(codes(lintQuestion(step({ prompt: "What does `*ip++` increment, and why?" }))).includes("compound"));
  assert.ok(codes(lintQuestion(step({ prompt: "Describe the two steps needed to share a variable between files." }))).includes("compound"));
  assert.ok(codes(lintQuestion(step({ prompt: "What does it print? What would change with `%d`?" }))).includes("compound"));
  assert.ok(codes(lintQuestion(step({ points: ["one", "two"] }))).includes("one-point"));
  assert.equal(lintQuestion(step({ level: 4, points: ["one", "two"] })).ok, true, "a twist may need two things (a warning)");
  assert.ok(codes(lintQuestion(step({ shape: "" }))).includes("shape"), "a missing shape is a warning");
  assert.equal(lintQuestion(q({ prompt: "What does `*ip++` increment, and why?" })).ok, true, "questions written before ladders keep the old rules");
  assert.equal(lintQuestion(step({ prompt: "What does this print?\n```c\nprintf(\"%d?\", x ? 1 : 2);\n```" })).ok, true, "question marks in code don't count");
});

test("a diagram must be drawable and agree with the answer; a picture can only be referred to when it's there", () => {
  const circuit = (fields) => q({ ability: "apply", level: 3, shape: "0 or 1", prompt: "In the circuit shown, what is out?", answer: "0", accept: ["0"], points: ["out is 0"], diagram: MUX, ...fields });
  assert.equal(lintQuestion(circuit({})).ok, true, JSON.stringify(lintQuestion(circuit({})).issues));
  assert.ok(codes(lintQuestion(circuit({ accept: ["1"] }))).includes("diagram-answer"));
  assert.ok(codes(lintQuestion(circuit({ diagram: { type: "circuit", inputs: [] } }))).includes("diagram"));
  assert.ok(codes(lintQuestion(circuit({ diagram: null, diagramError: "bad JSON" }))).includes("diagram"));
  assert.ok(codes(lintQuestion(circuit({ diagram: null, prompt: "What is out for the circuit shown below?" }))).includes("context"));
});

test("the ladder keeps the best question at each step, lowest step first, up to the concept's number of steps", () => {
  const c = (id, level, ability, prompt, extra = {}) => q({ id, level, ability, shape: "one word", prompt, ...extra });
  const cands = [
    c("t1", 1, "recall", "Which keyword declares a variable that's defined in another file?", { accept: ["extern"], points: ["extern"] }),
    c("t2", 1, "define", "In one sentence, what does `extern` tell the compiler about a variable?"),
    c("f1", 2, "recall", "How many times may an external variable be defined in a whole program?", { accept: ["once"], points: ["once"] }),
    c("u1", 3, "apply", "a.c has `int n = 0;`. What line lets b.c use `n`?", { accept: ["extern int n;"], points: ["extern int n;"] }),
    c("w1", 4, "apply", "Two files both contain `int n = 0;` at file scope. What happens at link time?"),
    c("w2", 5, "connect", "A header declares `extern int n;` and two files include it. Which of them must define `n`?"),
  ];
  const reviews = { t1: review("keep", { importance: 4 }), t2: review("keep", {}), f1: review("keep", {}), u1: review("keep", {}), w1: review("keep", {}), w2: review("keep", {}) };
  const core = selectForConcept(cands, reviews, "core");
  assert.deepEqual(core.kept.map(k => k.id), ["t2", "f1", "u1", "w1", "w2"], "the better-scored term question wins step 1");
  assert.ok(core.dropped.find(d => d.id === "t1").reasons[0].includes("better for this step"));
  assert.deepEqual(selectForConcept(cands, reviews, "supporting").kept.map(k => k.id), ["t2", "f1", "u1"]);
  assert.deepEqual(selectForConcept(cands, reviews, "detail").kept.map(k => k.level), [1, 2]);
  const topUp = selectForConcept(cands, reviews, "core", { existing: [{ ability: "recall", level: 1, prompt: "Name the keyword" }] });
  assert.deepEqual(topUp.kept.map(k => k.level), [2, 3, 4, 5], "a step the concept has isn't written twice");
});

test("the focus score is optional, so older reviews still pass", () => {
  assert.equal(judge(q(), review("keep", {})).keep, true);
  assert.equal(judge(q(), review("keep", { focus: 3 })).keep, false, "a two-part question fails on focus");
  assert.equal(judge(q(), review("keep", { focus: 5 })).dims.focus, 5);
});

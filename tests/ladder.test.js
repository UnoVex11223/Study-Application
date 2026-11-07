import { test } from "node:test";
import assert from "node:assert/strict";

import { newSrs } from "../src/lib/fsrs.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, index, levelOf } from "../src/lib/model.js";
import { reducer } from "../src/state/reducer.js";
import { pickItem, buildPlan, answeredOn } from "../src/lib/planner.js";
import { ladderProgress, introNext, termTasks, glossary, hasLadder, makeLesson, INTRO_STEPS } from "../src/lib/ladder.js";
import { planRebuild } from "../src/lib/ai.js";
import { dayKey } from "../src/lib/time.js";

const DAY = 864e5;
const NOW = new Date(2026, 10, 6, 12, 0, 0).getTime();

const reviewSrs = (daysAgo = 10, stability = 10) => ({
  ...newSrs(), state: "review", stability, difficulty: 5, lastReview: NOW - daysAgo * DAY, due: NOW - daysAgo * DAY + stability * DAY, reps: 3,
});

const step = (conceptId, level, ability, prompt, extra = {}) =>
  makeItem({ conceptId, level, ability, prompt, answer: "x", points: ["x"], quality: { score: 5 }, ...extra });

/** One concept with a four-step ladder (made out of order, to check it's sorted). */
function world(srs = newSrs()) {
  const s = emptyState();
  const course = makeCourse({ name: "C" });
  const sec = makeSection({ courseId: course.id, title: "Ch 1" });
  const c = makeConcept({
    courseId: course.id, sectionId: sec.id, name: "External variables", srs,
    lesson: makeLesson({ terms: [{ term: "extern", definition: "Declares a variable defined elsewhere." }], example: "`extern int n;`" }),
  });
  const items = [
    step(c.id, 3, "apply", "a.c has `int count = 0;`. What line must b.c have before using `count`?"),
    step(c.id, 1, "recall", "Which keyword declares a variable that's defined in another file?", { accept: ["extern"] }),
    step(c.id, 4, "apply", "Two files both contain `int count = 0;` at file scope. What happens when they're linked?"),
    step(c.id, 2, "recall", "How many times may an external variable be defined in a whole program?", { accept: ["once", "1"], answer: "Once." }),
  ];
  s.courses.push(course); s.sections.push(sec); s.concepts.push(c); s.items.push(...items);
  const byLevel = Object.fromEntries(items.map(i => [i.level, i]));
  return { s, course, sec, c, items, byLevel };
}

const answer = (s, item, verdict, ts, extra = {}) =>
  reducer(s, { type: "attempt", itemId: item.id, verdict, rating: verdict === "correct" ? 3 : 1, now: ts, ...extra });

test("a concept's questions are kept in ladder order, and old questions get a step from their kind", () => {
  const { s, c } = world();
  assert.deepEqual(index(s).itemsByConcept[c.id].map(i => i.level), [1, 2, 3, 4]);
  assert.equal(levelOf({ ability: "explain" }), 2);
  assert.equal(levelOf({ ability: "connect" }), 5);
  assert.equal(levelOf({ ability: "explain", level: 4 }), 4);
  assert.equal(levelOf({ ability: "define", level: 9 }), 1, "an impossible level falls back to the kind's");
});

test("a new concept starts on its lowest step; reviews climb to the lowest step not yet answered right", () => {
  let { s, c, byLevel } = world(reviewSrs());
  assert.equal(pickItem(index(s), { ...c, srs: newSrs() }).id, byLevel[1].id, "new: the term first");
  assert.equal(pickItem(index(s), c).id, byLevel[1].id, "nothing climbed yet: the lowest step");

  s = answer(s, byLevel[1], "correct", NOW - 3 * DAY);
  s = answer(s, byLevel[2], "correct", NOW - 2 * DAY);
  s = { ...s, concepts: s.concepts.map(x => ({ ...x, srs: reviewSrs() })) };
  assert.equal(pickItem(index(s), s.concepts[0]).id, byLevel[3].id, "steps 1 and 2 climbed: step 3 next");

  s = answer(s, byLevel[3], "incorrect", NOW - DAY);
  s = { ...s, concepts: s.concepts.map(x => ({ ...x, srs: reviewSrs() })) };
  assert.equal(pickItem(index(s), s.concepts[0]).id, byLevel[3].id, "a missed step is asked again");
  const p = ladderProgress(s, c.id);
  assert.deepEqual([p.climbed, p.total, p.next.id], [2, 4, byLevel[3].id]);
});

test("once every step is climbed, they take turns, the one asked longest ago first (so the term comes back)", () => {
  let { s, items, byLevel } = world(reviewSrs());
  items.forEach((it, i) => { s = answer(s, it, "correct", NOW - (10 - i) * DAY); }); // made order: step 3 first … step 2 last
  s = { ...s, concepts: s.concepts.map(x => ({ ...x, srs: reviewSrs() })) };
  assert.equal(pickItem(index(s), s.concepts[0]).id, byLevel[3].id);
  s = answer(s, byLevel[3], "correct", NOW);
  s = { ...s, concepts: s.concepts.map(x => ({ ...x, srs: reviewSrs() })) };
  assert.equal(pickItem(index(s), s.concepts[0]).id, byLevel[1].id, "then the term");
});

test("introducing a concept goes up the ladder a step at a time, for a few steps at most", () => {
  const { s, c, byLevel } = world();
  const ix = index(s);
  assert.equal(introNext(ix, c.id, byLevel[1].id, 1).id, byLevel[2].id);
  assert.equal(introNext(ix, c.id, byLevel[2].id, 2).id, byLevel[3].id);
  assert.equal(introNext(ix, c.id, byLevel[3].id, INTRO_STEPS), null, "the introduction stops after its steps");
  assert.equal(introNext(ix, c.id, byLevel[4].id, 1), null, "nothing above the top step");
});

test("the next steps of an introduction don't count toward the day's questions", () => {
  let { s, byLevel } = world();
  s = answer(s, byLevel[1], "correct", NOW, { mode: "session" });
  s = answer(s, byLevel[2], "correct", NOW + 1000, { mode: "session", climb: true });
  const today = dayKey(NOW, s.settings.rolloverHour);
  assert.equal(answeredOn(s, today), 1);
  assert.equal(s.attempts[1].climb, true);
  assert.equal(s.attempts[1].level, 2, "attempts remember the step");
  assert.equal(buildPlan(s, { now: NOW + 2000 }).done, 1);
});

test("terms drill: the first step of every started concept, never one you haven't started", () => {
  let { s, c, sec, course, byLevel } = world();
  assert.deepEqual(termTasks(s, { courseId: course.id, now: NOW }), [], "not started: nothing to drill");
  s = answer(s, byLevel[1], "correct", NOW - DAY);
  const tasks = termTasks(s, { courseId: course.id, now: NOW });
  assert.deepEqual(tasks.map(t => [t.itemId, t.kind]), [[byLevel[1].id, "drill"]]);
  assert.equal(termTasks(s, { courseId: course.id, sectionId: sec.id, now: NOW }).length, 1);
  const g = glossary(s, course.id);
  assert.deepEqual(g.map(t => [t.term, t.conceptId, t.started]), [["extern", c.id, true]]);
});

test("a lesson needs something to teach; terms without a definition are dropped", () => {
  assert.equal(makeLesson({}), null);
  assert.deepEqual(makeLesson({ terms: [{ term: "x", definition: "" }, { term: "pointer", definition: "An address." }] }).terms, [{ term: "pointer", definition: "An address." }]);
});

test("rebuilding a concept keeps old questions the new ladder repeats (with their history), and your own", () => {
  const { c } = world();
  const old = [
    makeItem({ conceptId: c.id, ability: "explain", prompt: "Describe the two steps required to use an external variable in C, and why.", answer: "a", points: ["a", "b"], quality: { score: 4.2 } }),
    makeItem({ conceptId: c.id, ability: "recall", prompt: "Which keyword declares a variable that's defined in another file?", answer: "extern", accept: ["extern"], points: ["extern"], quality: { score: 5 } }),
    makeItem({ conceptId: c.id, ability: "apply", prompt: "My own question about extern", answer: "x", points: ["x"] }),
  ];
  const kept = [
    { id: "q1", level: 1, ability: "recall", shape: "one word", prompt: "Which keyword declares a variable that's defined in another file?", answer: "extern", accept: ["extern"], points: ["extern"], misconceptions: [], hint: "" },
    { id: "q2", level: 2, ability: "recall", shape: "a number", prompt: "How many times may an external variable be defined in a whole program?", answer: "Once", accept: ["once", "1"], points: ["once"], misconceptions: [], hint: "" },
  ];
  const plan = planRebuild(c, old, kept);
  assert.deepEqual(plan.keep.map(k => [k.id, k.patch.level, k.patch.shape]), [[old[1].id, 1, "one word"]]);
  assert.deepEqual(plan.add.map(i => [i.prompt, i.level, i.shape]), [[kept[1].prompt, 2, "a number"]]);
  assert.deepEqual(plan.remove, [old[0].id], "the broad question is replaced; your own stays");

  let s = world().s;
  s = { ...s, concepts: [c], items: old };
  const next = reducer(s, { type: "concept/ladder", conceptId: c.id, ...plan, lesson: makeLesson({ example: "e" }), now: NOW });
  const items = index(next).itemsByConcept[c.id];
  assert.deepEqual(items.map(i => i.prompt), [kept[0].prompt, kept[1].prompt, "My own question about extern"]);
  assert.equal(next.concepts[0].ladderAt, NOW);
  assert.equal(next.concepts[0].lesson.example, "e");
  assert.equal(next.concepts[0].srs, c.srs, "the memory schedule is untouched");
  assert.equal(hasLadder(index(next), next.concepts[0]), true);
  assert.equal(hasLadder(index(s), c), false);
});

test("a half-price rebuild sends each concept's current questions and the writing setting, and plans ladders when results arrive", async () => {
  const { rebuildViaBatch } = await import("../src/lib/batchWriter.js");
  let { s, c, course, byLevel } = world();
  s = { ...s, settings: { ...s.settings, questionWriting: "economy" } };
  const created = [];
  const step2 = { concept_key: c.id, level: 2, ability: "recall", shape: "one word", prompt: "How many times may an external variable be defined in a whole program?", model_answer: "Once.", accept: ["once", "1"], required_points: ["once"], misconceptions: [], hint: "", diagram: "" };
  const ai = {
    batchCreate: async ({ kind, requests }) => { created.push({ kind, requests }); return { ok: true, batchId: `b${created.length}` }; },
    batchStatus: async () => ({ ok: true, status: "ended" }),
    batchResults: async (id) => {
      const { kind, requests } = created[Number(id.slice(1)) - 1];
      const results = {};
      for (const r of requests) {
        results[r.id] = kind === "items"
          ? { ok: true, data: { lessons: [{ concept_key: c.id, terms: [{ term: "extern", definition: "Declares a variable defined elsewhere." }], worked_example: "e", diagram: "" }], tasks: [step2] } }
          : { ok: true, data: { reviews: r.payload.questions.map(q => ({ id: q.id, verdict: "keep", scores: { importance: 5, clarity: 5, focus: 5, retrieval: 5, gradability: 5, accuracy: 5 }, reason: "" })), revisions: [] } };
      }
      return { ok: true, results };
    },
  };
  globalThis.window = { tenax: { ai } };
  const ladders = [], saved = [];
  const res = await rebuildViaBatch({
    getState: () => s, courseId: course.id, conceptIds: [c.id], onLadder: (l) => ladders.push(l), onSaved: (x) => saved.push(x.stage),
    sleep: async () => {}, pollMs: 0,
  });
  delete globalThis.window;
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(created.map(b => b.kind), ["items", "critique"], "written and reviewed in two batches");
  const payload = created[0].requests[0].payload;
  assert.equal(payload.writer, "economy");
  assert.equal(payload.concepts[0].current.length, 4, "the writer sees the concept's current questions");
  assert.deepEqual(saved, ["write", "critique", "critique"], "progress is saved so a restart picks the batch back up");
  assert.equal(ladders.length, 1);
  assert.deepEqual(ladders[0].keep.map(k => k.id), [byLevel[2].id], "the same question is kept, with its history");
  assert.equal(ladders[0].lesson.terms[0].term, "extern");
});

test("a rebuild never mistakes a new question about different code for an old one (found in a real rebuild)", async () => {
  const { similarity } = await import("../src/lib/quality.js");
  const { c } = world();
  const oldPrompt = "What does this print?\n```c\nint i = 0;\nwhile (i < 5) {\n  switch (i) { case 2: i++; continue; }\n  printf(\"%d \", i);\n  i++;\n}\n```";
  const newPrompt = "What does this print?\n```c\nfor (int i = 0; i < 4; i++) {\n  if (i % 2 == 0) continue;\n  printf(\"%d \", i);\n}\n```";
  assert.ok(similarity(oldPrompt, newPrompt) < 0.85, "different code, different question (they share C keywords, so not near zero)");
  assert.ok(similarity(oldPrompt, oldPrompt.replace("What does this print?", "What does this code print?")) >= 0.85, "same code, same question");
  const old = makeItem({ conceptId: c.id, ability: "apply", prompt: oldPrompt, answer: "`0 1 3 4`: the `continue` applies to the `while`.", points: ["0 1 3 4"], quality: { score: 5 } });
  const q = { id: "q", level: 3, ability: "apply", shape: "what it prints", prompt: newPrompt, answer: "`1 3`", accept: ["1 3"], points: ["1 3"], misconceptions: [], hint: "" };
  const plan = planRebuild(c, [old], [q]);
  assert.deepEqual(plan.keep, [], "the old question doesn't take the new one's accepted answers");
  assert.deepEqual(plan.remove, [old.id]);
  assert.equal(plan.add[0].prompt, newPrompt);
  // Same question, but accepted answers that contradict the old model answer: not kept either.
  assert.deepEqual(planRebuild(c, [old], [{ ...q, prompt: oldPrompt, accept: ["many"] }]).keep, []);
  assert.equal(planRebuild(c, [old], [{ ...q, prompt: oldPrompt, accept: ["0 1 3 4"] }]).keep[0].id, old.id);
});

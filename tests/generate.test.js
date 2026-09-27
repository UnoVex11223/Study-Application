import { test } from "node:test";
import assert from "node:assert/strict";

import { generateTasks, splitBatches, inParallel } from "../src/lib/ai.js";
import { emptyState, makeCourse } from "../src/lib/model.js";

const concept = (key, importance = "core") => ({ key, name: `Concept ${key}`, summary: "s", kind: "definition", importance, excerpt: "", selected: true });
const section = (title, n) => ({ title, concepts: Array.from({ length: n }, (_, i) => concept(`${title}${i}`)) });

test("concepts are split into even groups of at most four, per section", () => {
  const sizes = splitBatches([section("A", 9), section("B", 3), { title: "C", concepts: [{ ...concept("x"), selected: false }] }])
    .map(b => `${b.section.title}:${b.concepts.length}`);
  assert.deepEqual(sizes, ["A:3", "A:3", "A:3", "B:3"]);
});

test("inParallel never runs more than the limit at once and covers every item", async () => {
  let live = 0, peak = 0;
  const seen = [];
  await inParallel([...Array(10).keys()], 3, async (x) => {
    live++; peak = Math.max(peak, live);
    await new Promise(r => setTimeout(r, 5));
    seen.push(x); live--;
  });
  assert.equal(peak, 3);
  assert.deepEqual(seen.sort((a, b) => a - b), [...Array(10).keys()]);
});

function fakeAi({ failOnce = new Set(), delay = 20 } = {}) {
  let live = 0;
  const stats = { peak: 0, items: 0, critiques: 0 };
  const failed = new Set();
  const slow = async () => { live++; stats.peak = Math.max(stats.peak, live); await new Promise(r => setTimeout(r, delay)); live--; };
  const ai = {
    items: async ({ concepts }) => {
      stats.items++;
      await slow();
      const first = concepts[0].key;
      if (failOnce.has(first) && !failed.has(first)) { failed.add(first); return { ok: false, error: "Overloaded" }; }
      return { ok: true, data: { tasks: concepts.map(c => ({
        concept_key: c.key, ability: "explain",
        prompt: `Why does ${c.name} matter when designing a program's memory layout?`,
        model_answer: "Because it determines where data lives.", accept: [],
        required_points: ["Determines where data lives"], misconceptions: [], hint: "",
      })) } };
    },
    critique: async ({ questions }) => {
      stats.critiques++;
      await slow();
      return { ok: true, data: { reviews: questions.map(q => ({
        id: q.id, verdict: "keep", scores: { importance: 5, clarity: 5, retrieval: 5, gradability: 5, accuracy: 5 }, reason: "Strong",
        revision: { prompt: "", model_answer: "", accept: [], required_points: [], misconceptions: [], hint: "" },
      })) } };
    },
  };
  return { ai, stats };
}

function stateWithCourse() {
  const s = emptyState();
  const course = makeCourse({ name: "C" });
  s.courses.push(course);
  return { s, courseId: course.id };
}

test("question groups are written in parallel and come back in section order", async () => {
  const { ai, stats } = fakeAi();
  globalThis.window = { engram: { ai } };
  const { s, courseId } = stateWithCourse();
  const progress = [];
  const res = await generateTasks({ state: s, courseId, sections: [section("A", 8), section("B", 8), section("C", 8)], onProgress: p => progress.push(p) });
  delete globalThis.window;

  assert.equal(res.ok, true);
  assert.equal(stats.items, 6);
  assert.equal(stats.critiques, 6);
  assert.ok(stats.peak >= 4, `expected parallel calls, peak was ${stats.peak}`);
  assert.deepEqual(res.groups.map(g => g.conceptKey), [...["A", "B", "C"].flatMap(t => Array.from({ length: 8 }, (_, i) => `${t}${i}`))]);
  assert.ok(res.groups.every(g => g.kept.length === 1));
  assert.equal(res.partial, null);
  assert.deepEqual(progress.at(-1), { step: "write", done: 6, total: 6, passed: 24 });
});

test("a group that fails is retried once, and the rest are kept if it fails again", async () => {
  const { ai } = fakeAi({ failOnce: new Set(["A0"]) });
  globalThis.window = { engram: { ai } };
  const { s, courseId } = stateWithCourse();
  const res = await generateTasks({ state: s, courseId, sections: [section("A", 4), section("B", 4)] });
  assert.equal(res.ok, true);
  assert.equal(res.partial, null, "the retry succeeded");
  assert.equal(res.groups.length, 8);

  const always = { ...ai, items: async (p) => (p.concepts[0].key === "A0" ? { ok: false, error: "Overloaded" } : ai.items(p)) };
  globalThis.window = { engram: { ai: always } };
  const res2 = await generateTasks({ state: s, courseId, sections: [section("A", 4), section("B", 4)] });
  delete globalThis.window;
  assert.equal(res2.ok, true);
  assert.equal(res2.partial, "Overloaded");
  assert.deepEqual(res2.groups.map(g => g.conceptKey), ["B0", "B1", "B2", "B3"]);
});

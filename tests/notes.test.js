import { test } from "node:test";
import assert from "node:assert/strict";

import { splitNotes, noteHash, newNotes, batchNotes, processNotes, buildNotesImport, notesCourse } from "../src/lib/notes.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, index } from "../src/lib/model.js";
import { reducer } from "../src/state/reducer.js";
import { courseMastery } from "../src/lib/mastery.js";
import { buildPlan } from "../src/lib/planner.js";

// ── Splitting ──────────────────────────────────────────────────────────────
test("a notes file splits into list items and paragraphs, with code kept and headings as context", () => {
  const raw = [
    "# SQLite",
    "- Foreign keys are off by default; run `PRAGMA foreign_keys = ON` on every connection.",
    "  - It's per connection, not per database file.",
    "- WAL mode lets readers keep reading while one writer writes.",
    "",
    "## Transactions",
    "BEGIN IMMEDIATE takes the write lock up front, so two writers can't deadlock on upgrade.",
    "```sql",
    "BEGIN IMMEDIATE;",
    "",
    "UPDATE t SET x = 1;",
    "```",
    "",
    "ok",
    "",
    "Second paragraph about savepoints: SAVEPOINT names a nested transaction you can roll back to.",
  ].join("\n");
  const notes = splitNotes(raw, { context: "Tenax project" });
  assert.equal(notes.length, 4);
  assert.match(notes[0].text, /per connection, not per database/, "sub-items stay with their item");
  assert.equal(notes[0].context, "Tenax project › SQLite");
  assert.match(notes[2].text, /UPDATE t SET x = 1;\n```$/, "a code block (even with a blank line inside) stays with its paragraph");
  assert.equal(notes[2].context, "Tenax project › Transactions");
  assert.ok(!notes.some(n => n.text === "ok"), "fragments too short to mean anything are dropped");
});

test("re-uploading a file only adds notes you haven't added before", () => {
  const s = emptyState();
  const first = newNotes(s, splitNotes("- Alpha is the first letter of the Greek alphabet.\n- Beta comes second in the Greek alphabet."), { source: "greek.md" });
  assert.equal(first.notes.length, 2);
  s.notes.push(...first.notes);
  const again = newNotes(s, splitNotes("- alpha is the first letter of the  Greek alphabet.\n- Beta comes second in the Greek alphabet.\n- Gamma is the third letter."), { source: "greek.md" });
  assert.equal(again.notes.length, 1);
  assert.equal(again.duplicates, 2);
  assert.equal(noteHash("A  b"), noteHash("a b"));
});

test("notes are processed in batches of limited size", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, text: "x".repeat(i === 3 ? 9000 : 100) }));
  const b = batchNotes(many);
  assert.ok(b.every(x => x.length <= 12));
  assert.ok(b.every(x => x.reduce((n, y) => n + y.text.length, 0) <= 10000 || x.length === 1));
  assert.equal(b.flat().length, 30);
});

// ── Processing and saving ──────────────────────────────────────────────────
function world() {
  const s = emptyState();
  s.settings.dailyMinutes = 60;
  const course = makeCourse({ name: "The C Programming Language" });
  const sec = makeSection({ courseId: course.id, title: "Chapter 5 - Pointers and Arrays" });
  const ptr = makeConcept({ courseId: course.id, sectionId: sec.id, name: "Pointer arithmetic", importance: "core" });
  s.courses.push(course); s.sections.push(sec); s.concepts.push(ptr);
  for (let i = 0; i < 4; i++) s.items.push(makeItem({ conceptId: ptr.id, ability: "explain", prompt: `Existing question ${i} about how pointer arithmetic scales by element size?`, answer: "a", points: ["a"] }));
  const notes = newNotes(s, [
    { text: "sqlite: foreign keys are OFF by default, PRAGMA foreign_keys = ON per connection", context: "Tenax" },
    { text: "p + 1 on an int* moves 4 bytes on my machine because it scales by sizeof(int)", context: "K&R exercises" },
    { text: "TODO fix the login bug before Friday", context: "work" },
  ]).notes;
  s.notes.push(...notes);
  return { s, course, ptr, notes };
}

function fakeAi(ptrId) {
  const calls = { notes: [], items: [] };
  const ai = {
    notes: async (p) => {
      calls.notes.push(p);
      return { ok: true, data: { notes: p.notes.map(n => {
        if (/TODO/.test(n.text) && !n.force) return { note_id: n.id, outcome: "skip", reason: "A to-do, not something to remember.", concepts: [] };
        if (/sizeof/.test(n.text)) return { note_id: n.id, outcome: "keep", reason: "", concepts: [{
          key: "c1", name: "Pointer arithmetic scaling", summary: "Adding n to a pointer advances n elements.", kind: "mechanism", importance: "core",
          topic: "C", filled_in: false, corrected: "", same_as: ptrId, related: [] }] };
        return { note_id: n.id, outcome: "keep", reason: "", concepts: [{
          key: "c1", name: "SQLite foreign key enforcement", summary: "SQLite ignores foreign keys unless PRAGMA foreign_keys = ON is run on each connection.",
          kind: "fact", importance: "supporting", topic: "SQLite", filled_in: true, corrected: "", same_as: "",
          related: [{ id: ptrId, type: "related", why: "Both are per-object settings you must remember to apply." }, { id: "nope", type: "related", why: "x" }] }] };
      }) } };
    },
    items: async ({ concepts }) => {
      calls.items.push(...concepts);
      return { ok: true, data: { tasks: concepts.flatMap(c => [
        { concept_key: c.key, ability: "explain", prompt: `Why does ${c.name} behave the way it does in practice?`, model_answer: "Because.", accept: [], required_points: ["Because"], misconceptions: [], hint: "" },
        { concept_key: c.key, ability: "apply", prompt: `Given \`int a[4]; int *p = a;\`, where does ${c.name} put \`p + 2\`?`, model_answer: "a[2]", accept: [], required_points: ["At a[2]"], misconceptions: [], hint: "" },
      ]) } };
    },
    critique: async ({ questions }) => ({ ok: true, data: { reviews: questions.map(q => ({
      id: q.id, verdict: "keep", scores: { importance: 5, clarity: 5, retrieval: 5, gradability: 5, accuracy: 5 }, reason: "",
      revision: { prompt: "", model_answer: "", accept: [], required_points: [], misconceptions: [], hint: "" },
    })) } }),
  };
  return { ai, calls };
}

test("notes become new concepts in Notes, extra questions on matching concepts, or skips", async () => {
  const { s, course, ptr, notes } = world();
  const { ai, calls } = fakeAi(ptr.id);
  globalThis.window = { tenax: { ai } };
  const res = await processNotes({ state: s, noteIds: notes.map(n => n.id) });
  delete globalThis.window;

  assert.equal(res.ok, true);
  const [sqlite, kr, todo] = res.entries;
  assert.equal(sqlite.outcome, "keep");
  assert.equal(sqlite.concepts[0].topic, "SQLite");
  assert.deepEqual(sqlite.concepts[0].related.map(l => l.id), [ptr.id], "links to unknown concepts are dropped");
  assert.equal(kr.concepts[0].sameAs, ptr.id);
  assert.equal(todo.outcome, "skip");
  assert.ok(calls.notes[0].known.some(k => k.id === ptr.id), "Claude sees what you already study");
  const merged = calls.items.find(c => c.key === kr.concepts[0].key);
  assert.equal(merged.existing.length, 4, "the writer sees the concept's current questions");
  assert.equal(kr.concepts[0].group.kept.length, 2, "a note may add questions beyond the usual target");

  const payload = buildNotesImport({ state: s, entries: res.entries });
  const next = reducer(s, { type: "notes/import", payload });
  const space = notesCourse(next);
  assert.equal(space.name, "Notes");
  const ix = index(next);
  assert.deepEqual((ix.sectionsByCourse[space.id] || []).map(x => x.title), ["SQLite"]);
  const newConcept = ix.conceptsByCourse[space.id][0];
  assert.equal(newConcept.filledIn, true);
  assert.match(newConcept.source.label, /^Your note \(Tenax\)/);
  assert.equal((ix.itemsByConcept[ptr.id] || []).length, 6, "the matching note became two more questions on Pointer arithmetic");
  assert.ok(next.edges.some(e => e.from === newConcept.id && e.to === ptr.id && e.type === "related"));
  assert.deepEqual(next.notes.map(n => n.status), ["done", "done", "skipped"]);
  assert.deepEqual(next.notes[1].result.merged, [ptr.id]);

  // The course's totals don't change: notes never add concepts to a course.
  assert.equal(courseMastery(next, course.id).total, courseMastery(s, course.id).total);
  // Notes are introduced like any other new material.
  assert.ok(buildPlan(next).tasks.some(t => t.conceptId === newConcept.id));
});

test("later notes reuse the Notes space and its topics; Keep anyway forces a skipped note through", async () => {
  const { s, ptr, notes } = world();
  const { ai } = fakeAi(ptr.id);
  globalThis.window = { tenax: { ai } };
  let state = s;
  const first = await processNotes({ state, noteIds: [notes[0].id, notes[2].id] });
  state = reducer(state, { type: "notes/import", payload: buildNotesImport({ state, entries: first.entries }) });

  state = reducer(state, { type: "notes/requeue", id: notes[2].id, force: true });
  const more = newNotes(state, [{ text: "SQLite has no DATETIME type; dates are stored as TEXT, REAL or INTEGER." }]).notes;
  state = reducer(state, { type: "notes/add", notes: more });
  const second = await processNotes({ state, noteIds: [more[0].id, notes[2].id] });
  delete globalThis.window;
  assert.equal(second.entries[1].outcome, "keep", "forced");
  state = reducer(state, { type: "notes/import", payload: buildNotesImport({ state, entries: second.entries }) });

  assert.equal(state.courses.filter(c => c.kind === "notes").length, 1);
  const ix = index(state);
  const space = notesCourse(state);
  assert.deepEqual(ix.sectionsByCourse[space.id].map(x => x.title), ["SQLite"], "same topic reused");
  assert.equal(ix.conceptsByCourse[space.id].length, 3);
});

test("unticking all of a note's questions skips it, and failed notes stay in the inbox", () => {
  const { s, notes } = world();
  const group = { kept: [{ selected: false }], dropped: [] };
  const entries = [
    { note: notes[0], outcome: "keep", concepts: [{ key: "k", name: "X", summary: "x", kind: "fact", importance: "supporting", topic: "T", related: [], group }] },
    { note: notes[1], outcome: "error", reason: "missing", concepts: [] },
  ];
  const payload = buildNotesImport({ state: s, entries });
  assert.equal(payload.course, null, "no Notes space created for nothing");
  const next = reducer(s, { type: "notes/import", payload });
  assert.equal(next.notes[0].status, "skipped");
  assert.equal(next.notes[1].status, "inbox");
});

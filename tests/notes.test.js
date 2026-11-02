import { test } from "node:test";
import assert from "node:assert/strict";

import { splitNotes, noteHash, newNotes, batchNotes, processNotes, buildNotesImport, noteAreas, hasNotesSpace, planRegroup } from "../src/lib/notes.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, index } from "../src/lib/model.js";
import { reducer } from "../src/state/reducer.js";
import { courseMastery, abilityBreakdown } from "../src/lib/mastery.js";
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
  s.settings.dailyQuestions = 40;
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

/** A stand-in for Claude: SQLite notes are new ideas, the sizeof note is one you already study, TODOs are skipped. */
function fakeAi(ptrId) {
  const calls = { notes: [], items: [] };
  const sqlite = (name, extra = {}) => ({
    key: "c1", name, summary: `${name}: what SQLite does and why.`, kind: "fact", importance: "supporting",
    area: "Databases", topic: "SQLite", filled_in: false, corrected: "", same_as: "", related: [], ...extra,
  });
  const ai = {
    notes: async (p) => {
      calls.notes.push(p);
      return { ok: true, data: { notes: p.notes.map(n => {
        if (/TODO/.test(n.text) && !n.force) return { note_id: n.id, outcome: "skip", reason: "A to-do, not something to remember.", concepts: [] };
        if (/sizeof/.test(n.text)) return { note_id: n.id, outcome: "keep", reason: "", concepts: [{
          key: "c1", name: "Pointer arithmetic scaling", summary: "Adding n to a pointer advances n elements.", kind: "mechanism", importance: "core",
          area: "C programming", topic: "Pointers", filled_in: false, corrected: "", same_as: n.force ? "" : ptrId, related: [] }] };
        if (/DATETIME/.test(n.text)) return { note_id: n.id, outcome: "keep", reason: "", concepts: [sqlite("SQLite date storage")] };
        if (/TODO/.test(n.text)) return { note_id: n.id, outcome: "keep", reason: "", concepts: [{ ...sqlite("Login bug triage"), area: "Debugging", topic: "Habits" }] };
        return { note_id: n.id, outcome: "keep", reason: "", concepts: [sqlite("SQLite foreign key enforcement", {
          filled_in: true,
          related: [{ id: ptrId, type: "related", why: "Both are per-object settings you must remember to apply." }, { id: "nope", type: "related", why: "x" }] })] };
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

async function processWith(ai, state, noteIds) {
  globalThis.window = { tenax: { ai } };
  try { return await processNotes({ state, noteIds }); } finally { delete globalThis.window; }
}

test("notes become concepts in an area of their own; ideas you already study are left out", async () => {
  const { s, course, ptr, notes } = world();
  const { ai, calls } = fakeAi(ptr.id);
  const res = await processWith(ai, s, notes.map(n => n.id));

  assert.equal(res.ok, true);
  const [sqlite, kr, todo] = res.entries;
  assert.equal(sqlite.outcome, "keep");
  assert.equal(sqlite.concepts[0].area, "Databases");
  assert.deepEqual(sqlite.concepts[0].related.map(l => l.id), [ptr.id], "links to unknown concepts are dropped");
  assert.equal(kr.outcome, "skip", "a note whose idea you already study is skipped");
  assert.match(kr.reason, /Already covered: Pointer arithmetic/);
  assert.deepEqual(kr.covered.map(c => c.id), [ptr.id]);
  assert.equal(todo.outcome, "skip");
  assert.ok(calls.notes[0].known.some(k => k.id === ptr.id), "Claude sees what you already study");
  assert.ok(!calls.items.some(c => /scaling/.test(c.name)), "no questions are written for what's covered");

  const payload = buildNotesImport({ state: s, entries: res.entries });
  const next = reducer(s, { type: "notes/import", payload, now: 1 });
  const [area] = noteAreas(next);
  assert.equal(area.name, "Databases");
  assert.notEqual(area.color, course.color, "an area gets a colour of its own");
  const ix = index(next);
  assert.deepEqual(ix.sectionsByCourse[area.id].map(x => x.title), ["SQLite"], "its topics are its sections");
  const newConcept = ix.conceptsByCourse[area.id][0];
  assert.equal(newConcept.filledIn, true);
  assert.match(newConcept.source.label, /^Your note \(Tenax\)/);
  assert.equal(ix.itemsByConcept[ptr.id].length, 4, "nothing is added to the concept you already study");
  assert.ok(next.edges.some(e => e.from === newConcept.id && e.to === ptr.id && e.type === "related"));
  assert.deepEqual(next.notes.map(n => n.status), ["done", "skipped", "skipped"]);
  assert.deepEqual(next.notes[1].result.covered, [ptr.id]);

  assert.equal(courseMastery(next, course.id).total, courseMastery(s, course.id).total, "a course you study isn't changed");
  assert.ok(buildPlan(next).tasks.some(t => t.conceptId === newConcept.id), "notes are introduced like any other new material");
});

test("later notes reuse an area and its topics; a new field gets a new area; Keep anyway brings a skipped note in", async () => {
  const { s, ptr, notes } = world();
  const { ai } = fakeAi(ptr.id);
  let state = s;
  const first = await processWith(ai, state, [notes[0].id, notes[1].id, notes[2].id]);
  state = reducer(state, { type: "notes/import", payload: buildNotesImport({ state, entries: first.entries }), now: 1 });

  state = reducer(state, { type: "notes/requeue", id: notes[1].id, force: true, now: 2 });
  state = reducer(state, { type: "notes/requeue", id: notes[2].id, force: true, now: 2 });
  const more = newNotes(state, [{ text: "SQLite has no DATETIME type; dates are stored as TEXT, REAL or INTEGER." }]).notes;
  state = reducer(state, { type: "notes/add", notes: more, now: 3 });
  const second = await processWith(ai, state, [more[0].id, notes[1].id, notes[2].id]);
  assert.deepEqual(second.entries.map(e => e.outcome), ["keep", "keep", "keep"], "forced through, even what was covered");
  state = reducer(state, { type: "notes/import", payload: buildNotesImport({ state, entries: second.entries }), now: 4 });

  const ix = index(state);
  const areas = noteAreas(state);
  assert.deepEqual(areas.map(c => c.name), ["Databases", "C programming", "Debugging"]);
  assert.deepEqual(ix.sectionsByCourse[areas[0].id].map(x => x.title), ["SQLite"], "same topic reused");
  assert.equal(ix.conceptsByCourse[areas[0].id].length, 2);
  assert.ok(!hasNotesSpace(state));
});

test("an idea two notes share, or one you have under the same name, is kept once", async () => {
  const s = emptyState();
  const course = makeCourse({ name: "Databases book" });
  const sec = makeSection({ courseId: course.id, title: "Ch 1" });
  const wal = makeConcept({ courseId: course.id, sectionId: sec.id, name: "Write-ahead logging" });
  s.courses.push(course); s.sections.push(sec); s.concepts.push(wal);
  const notes = newNotes(s, [
    { text: "Foreign keys in SQLite are off unless you turn them on per connection." },
    { text: "Remember: sqlite foreign keys need PRAGMA foreign_keys=ON each time you connect." },
    { text: "WAL = write-ahead log; readers don't block the writer." },
  ]).notes;
  s.notes.push(...notes);
  const concept = (name) => ({ key: "c1", name, summary: `${name}.`, kind: "fact", importance: "supporting", area: "Databases", topic: "SQLite", filled_in: false, corrected: "", same_as: "", related: [] });
  const { ai } = fakeAi("");
  ai.notes = async (p) => ({ ok: true, data: { notes: p.notes.map((n, i) => ({
    note_id: n.id, outcome: "keep", reason: "",
    concepts: [concept(i === 2 ? "Write-Ahead Logging" : i === 1 ? "SQLite foreign keys" : "SQLite Foreign Keys")],
  })) } });
  const res = await processWith(ai, s, notes.map(n => n.id));
  assert.deepEqual(res.entries.map(e => e.outcome), ["keep", "skip", "skip"]);
  assert.match(res.entries[1].reason, /Already covered: SQLite foreign keys/);
  assert.deepEqual(res.entries[2].covered.map(c => c.id), [wal.id], "matched by name when Claude missed it");
});

test("unticking all of a note's questions skips it, and failed notes stay in the inbox", () => {
  const { s, notes } = world();
  const group = { kept: [{ selected: false }], dropped: [] };
  const entries = [
    { note: notes[0], outcome: "keep", covered: [], concepts: [{ key: "k", name: "X", summary: "x", kind: "fact", importance: "supporting", area: "A", topic: "T", related: [], group }] },
    { note: notes[1], outcome: "error", reason: "missing", concepts: [], covered: [] },
  ];
  const payload = buildNotesImport({ state: s, entries });
  assert.deepEqual(payload.courses, [], "no area is made for nothing");
  const next = reducer(s, { type: "notes/import", payload });
  assert.equal(next.notes[0].status, "skipped");
  assert.equal(next.notes[1].status, "inbox");
});

// ── Areas from the old Notes course, and deleting ──────────────────────────
test("the old single Notes course becomes one area per topic, keeping concepts and history", () => {
  const s = emptyState();
  const space = makeCourse({ name: "Notes", kind: "notes" });
  const auth = makeSection({ courseId: space.id, title: "Authentication", order: 0 });
  const git = makeSection({ courseId: space.id, title: "Git", order: 1 });
  const oauth = makeConcept({ courseId: space.id, sectionId: auth.id, name: "OAuth refresh tokens" });
  const rebase = makeConcept({ courseId: space.id, sectionId: git.id, name: "Rebase vs merge" });
  s.courses.push(space); s.sections.push(auth, git); s.concepts.push(oauth, rebase);
  s.attempts.push({ ts: 1, itemId: "i1", conceptId: rebase.id, courseId: space.id, rating: 3 });
  assert.ok(hasNotesSpace(s));

  const next = reducer(s, { type: "notes/areas", now: 5 });
  assert.ok(!hasNotesSpace(next));
  assert.deepEqual(noteAreas(next).map(c => c.name), ["Authentication", "Git"]);
  const ix = index(next);
  assert.equal(ix.concept[oauth.id].courseId, space.id, "the first topic keeps the course");
  const gitArea = noteAreas(next)[1];
  assert.equal(gitArea.id, `c_${git.id}`, "the same id on every computer");
  assert.equal(ix.concept[rebase.id].courseId, gitArea.id);
  assert.equal(ix.section[git.id].courseId, gitArea.id);
  assert.equal(next.attempts.length, 1, "history stays");
  assert.equal(gitArea.updatedAt, 5, "stamped as an edit, so it syncs");
});

test("regrouping moves topics into broad areas, merging topics that are the same and removing emptied areas", async () => {
  const s = emptyState();
  const book = makeCourse({ name: "C book" });
  const ch = makeSection({ courseId: book.id, title: "Ch 1" });
  const area = (name, ...topics) => {
    const c = makeCourse({ name, kind: "notes" }, s.courses.length);
    s.courses.push(c);
    return [c, ...topics.map(([title, ...concepts], order) => {
      const sec = makeSection({ courseId: c.id, title, order });
      s.sections.push(sec);
      return [sec, ...concepts.map((name, i) => { const k = makeConcept({ courseId: c.id, sectionId: sec.id, name, order: i }); s.concepts.push(k); return k; })];
    })];
  };
  s.courses.push(book); s.sections.push(ch);
  const [auth, [authTopic, hashing, sessions], [oauthTopic]] = area("Authentication", ["Authentication", "Password hashing", "Session cookies"], ["OAuth"]);
  const [git, [branching, branch], [rebasing, rebase]] = area("Git", ["Branching", "Feature branches"], ["Rebasing", "Rebase vs merge"]);
  const [security, [xssTopic]] = area("Security", ["XSS", "Escaping output"]);
  s.attempts.push({ ts: 9e12, itemId: "i1", conceptId: hashing.id, courseId: auth.id, ability: "explain", verdict: "correct" });

  globalThis.window = { tenax: { ai: { areas: async ({ areas }) => {
    assert.deepEqual(areas.map(a => a.name), ["Authentication", "Git", "Security"]);
    assert.deepEqual(areas[0].topics[0].concepts, ["Password hashing", "Session cookies"], "Claude sees what each topic holds");
    return { ok: true, data: { topics: [
      { id: authTopic.id, area: "Security", topic: "Authentication" },
      { id: oauthTopic.id, area: "Security", topic: "OAuth" },
      { id: branching.id, area: "Software engineering", topic: "Git" },
      { id: rebasing.id, area: "Software engineering", topic: "Git" },
      { id: xssTopic.id, area: "Security", topic: "XSS" },
      { id: ch.id, area: "Programming languages", topic: "C" },
      { id: "gone", area: "Elsewhere", topic: "X" },
    ] } };
  } } } };
  let plan;
  try { plan = await planRegroup(s); } finally { delete globalThis.window; }
  assert.equal(plan.ok, true, plan.error);

  const next = reducer(s, { type: "notes/regroup", moves: plan.moves, now: 7 });
  const ix = index(next);
  assert.deepEqual(noteAreas(next).map(c => c.name), ["Software engineering", "Security"]);
  assert.ok(!next.courses.some(c => c.id === auth.id), "an area left empty goes");
  assert.ok(next.tombstones[auth.id], "and that carries over to your other computers");
  assert.deepEqual(ix.sectionsByCourse[security.id].map(x => x.title), ["XSS", "Authentication", "OAuth"], "the area already called that keeps its topics first");
  assert.equal(ix.concept[hashing.id].courseId, security.id);
  assert.equal(ix.concept[sessions.id].sectionId, authTopic.id);

  const eng = noteAreas(next)[0];
  assert.equal(eng.id, git.id, "a narrow area is renamed rather than replaced, keeping its colour");
  assert.equal(eng.updatedAt, 7);
  assert.deepEqual(ix.sectionsByCourse[git.id].map(x => x.title), ["Git"], "two topics renamed alike become one");
  assert.ok(!next.sections.some(x => x.id === rebasing.id));
  assert.deepEqual([ix.concept[branch.id], ix.concept[rebase.id]].map(k => [k.sectionId, k.order]), [[branching.id, 0], [branching.id, 1]]);

  assert.equal(ix.section[ch.id].courseId, book.id, "a book's chapters aren't notes and never move");
  assert.equal(abilityBreakdown(next, { courseId: security.id, now: 9e12 }).explain.attempts, 1, "history moves with the concept");
  assert.equal(reducer(next, { type: "notes/regroup", moves: [], now: 8 }), next, "nothing to move changes nothing");
});

test("an area split two ways keeps its course for the bigger part and makes one for the other", () => {
  const s = emptyState();
  const auth = makeCourse({ name: "Authentication", kind: "notes" });
  const login = makeSection({ courseId: auth.id, title: "Login", order: 0 });
  const rest = makeSection({ courseId: auth.id, title: "REST", order: 1 });
  s.courses.push(auth); s.sections.push(login, rest);
  s.concepts.push(
    makeConcept({ courseId: auth.id, sectionId: login.id, name: "Password hashing" }),
    makeConcept({ courseId: auth.id, sectionId: login.id, name: "Session cookies" }),
    makeConcept({ courseId: auth.id, sectionId: rest.id, name: "Idempotent methods" }));
  const moves = [{ sectionId: login.id, area: "Security", topic: "Authentication" }, { sectionId: rest.id, area: "Web development", topic: "REST APIs" }];
  const next = reducer(s, { type: "notes/regroup", moves, now: 3 });
  assert.deepEqual(noteAreas(next).map(c => [c.id, c.name]), [[auth.id, "Security"], [`c_${rest.id}`, "Web development"]]);
  assert.deepEqual(index(next).sectionsByCourse[`c_${rest.id}`].map(x => [x.id, x.title, x.order]), [[rest.id, "REST APIs", 0]]);
  assert.equal(next.concepts[2].courseId, `c_${rest.id}`);
});

test("deleting a note deletes what it made, and an area left empty goes too", async () => {
  const { s, ptr, notes } = world();
  const { ai } = fakeAi(ptr.id);
  const res = await processWith(ai, s, [notes[0].id]);
  let state = reducer(s, { type: "notes/import", payload: buildNotesImport({ state: s, entries: res.entries }), now: 1 });
  const [area] = noteAreas(state);
  const made = state.concepts.find(c => c.noteId === notes[0].id);
  assert.ok(made && area);

  state = reducer(state, { type: "notes/delete", ids: [notes[0].id, notes[2].id], now: 2 });
  assert.ok(!state.notes.some(n => n.id === notes[0].id || n.id === notes[2].id));
  assert.ok(!state.concepts.some(c => c.id === made.id));
  assert.ok(!state.items.some(i => i.conceptId === made.id));
  assert.ok(!state.edges.some(e => e.from === made.id));
  assert.equal(noteAreas(state).length, 0, "the empty area is gone");
  assert.ok(!state.sections.some(x => x.courseId === area.id));
  assert.ok(state.tombstones[area.id], "and the deletion carries over to your other computers");
  assert.ok(state.concepts.some(c => c.id === ptr.id), "nothing else is touched");
});

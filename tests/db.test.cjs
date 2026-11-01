// The library database (db.cjs): saving only what changed, keeping review
// history, sync's "what changed since", and recovering from a damaged file.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openLibrary, FILE } = require("../db.cjs");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tenax-db-"));
const attempt = (ts, conceptId, extra = {}) => ({ ts, day: "2026-10-31", itemId: `i_${conceptId}`, conceptId, verdict: "correct", rating: 3, mode: "session", ...extra });

test("a new library is empty until the first save; records keep their order", () => {
  const dir = tmpDir();
  const { library, recovered } = openLibrary({ dir });
  assert.equal(recovered, null);
  assert.equal(library.loadState(), null, "nothing saved yet");

  library.apply({
    upsert: { courses: [{ id: "c1", name: "C" }, { id: "c2", name: "Java" }], concepts: [{ id: "k1", courseId: "c1", updatedAt: 5 }] },
    attempts: [attempt(1, "k1")],
    tombstones: { set: { old: 3 } },
    meta: { settings: { dailyQuestions: 20 }, settingsUpdatedAt: 9, version: 8 },
  });
  library.apply({ upsert: { courses: [{ id: "c1", name: "C, 2nd edition" }] } });

  const s = library.loadState();
  assert.deepEqual(s.courses.map(c => c.name), ["C, 2nd edition", "Java"], "an edit keeps the record's place");
  assert.equal(s.concepts[0].updatedAt, 5);
  assert.equal(s.attempts.length, 1);
  assert.deepEqual(s.tombstones, { old: 3 });
  assert.deepEqual(s.settings, { dailyQuestions: 20 });
  assert.equal(s.version, 8);
  assert.ok(fs.existsSync(path.join(dir, FILE)));
});

test("deleting a concept takes its reviews; nothing else ever removes review history", () => {
  const { library } = openLibrary({ dir: tmpDir() });
  library.apply({
    upsert: { concepts: [{ id: "k1" }, { id: "k2" }] },
    attempts: [attempt(1, "k1"), attempt(2, "k1"), attempt(3, "k2")],
  });
  library.apply({ attempts: [attempt(2, "k1")] }); // the same review again (a sync echo) is stored once
  assert.equal(library.stats().attempts, 3);

  library.apply({ remove: { concepts: ["k1"] } });
  const s = library.loadState();
  assert.deepEqual(s.concepts.map(c => c.id), ["k2"]);
  assert.deepEqual(s.attempts.map(a => a.conceptId), ["k2"], "k1's reviews went with it");
});

test("only the newest reviews are loaded into memory, but every review stays on disk", () => {
  const { library } = openLibrary({ dir: tmpDir(), loadedAttempts: 3 });
  library.apply({ upsert: { concepts: [{ id: "k" }] }, attempts: [5, 1, 4, 2, 3].map(ts => attempt(ts, "k")) });
  assert.deepEqual(library.loadState().attempts.map(a => a.ts), [3, 4, 5], "the newest three, oldest first");
  assert.deepEqual(library.loadState({ allAttempts: true }).attempts.map(a => a.ts), [1, 2, 3, 4, 5]);
});

test("replacing the library swaps everything; review numbers keep counting up", () => {
  const { library } = openLibrary({ dir: tmpDir() });
  library.apply({ upsert: { courses: [{ id: "a" }] }, attempts: [attempt(1, "k")], tombstones: { set: { x: 1 } }, meta: { days: { d: { extra: 5 } } } });
  const before = library.lastAttemptSeq();
  library.replace({ version: 8, courses: [{ id: "b" }], notes: [], attempts: [attempt(9, "k2")], tombstones: { y: 2 }, settings: { theme: "light" } });
  const s = library.loadState();
  assert.deepEqual(s.courses.map(c => c.id), ["b"]);
  assert.deepEqual(s.attempts.map(a => a.ts), [9]);
  assert.deepEqual(s.tombstones, { y: 2 });
  assert.equal(s.days, undefined, "meta that isn't in the new library is gone");
  assert.equal(s.settings.theme, "light");
  assert.ok(library.lastAttemptSeq() > before, "sync can still tell new reviews from old ones");
});

test("changes since a revision: only what was written after it, settings with their time", () => {
  const { library } = openLibrary({ dir: tmpDir() });
  library.apply({ upsert: { courses: [{ id: "c1" }], concepts: [{ id: "k1" }] }, attempts: [attempt(1, "k1")], meta: { version: 8, settings: { a: 1 }, settingsUpdatedAt: 10 } });
  const mark = { rev: library.revision(), attemptSeq: library.lastAttemptSeq() };
  assert.equal(library.changesSince(mark).empty, true);

  library.apply({ upsert: { concepts: [{ id: "k1", name: "edited" }] }, attempts: [attempt(2, "k1")], tombstones: { set: { gone: 7 } } });
  const c = library.changesSince(mark);
  assert.equal(c.empty, false);
  assert.deepEqual(c.state.concepts, [{ id: "k1", name: "edited" }]);
  assert.equal(c.state.courses, undefined, "unchanged records aren't sent");
  assert.deepEqual(c.state.attempts.map(a => a.ts), [2]);
  assert.deepEqual(c.state.tombstones, { gone: 7 });
  assert.equal(c.state.settings, undefined);
  assert.equal(c.state.settingsUpdatedAt, 0, "a copy without settings can't win them");
  assert.equal(c.state.version, 8);

  library.apply({ meta: { settingsUpdatedAt: 20 } });
  const s = library.changesSince({ rev: c.rev, attemptSeq: c.attemptSeq }).state;
  assert.deepEqual(s.settings, { a: 1 }, "settings travel with the time they changed");
  assert.equal(s.settingsUpdatedAt, 20);
});

test("the library survives closing and reopening", () => {
  const dir = tmpDir();
  const first = openLibrary({ dir }).library;
  first.apply({ upsert: { courses: [{ id: "c1" }] } });
  first.close();
  const again = openLibrary({ dir });
  assert.equal(again.recovered, null);
  assert.deepEqual(again.library.loadState().courses, [{ id: "c1" }]);
});

test("a failed write leaves the library as it was", () => {
  const { library } = openLibrary({ dir: tmpDir() });
  library.apply({ upsert: { courses: [{ id: "c1" }] } });
  const loop = { id: "bad" };
  loop.self = loop; // can't be stored
  assert.throws(() => library.apply({ upsert: { courses: [{ id: "c2" }, loop] } }));
  assert.deepEqual(library.loadState().courses.map(c => c.id), ["c1"], "c2 wasn't half-saved either");
});

test("a damaged file is set aside, never deleted, and the newest readable backup restored", () => {
  const dir = tmpDir();
  const backups = path.join(dir, "backups");
  fs.mkdirSync(backups);
  fs.writeFileSync(path.join(backups, "tenax-2026-10-30.json"), JSON.stringify({ version: 8, courses: [{ id: "from-the-30th" }] }));
  fs.writeFileSync(path.join(backups, "tenax-2026-10-31.json"), "{ damaged"); // the newest can't be read: use the one before
  fs.writeFileSync(path.join(dir, FILE), "this is not a database at all, just text that's long enough to look like a file");

  const { library, recovered } = openLibrary({ dir });
  assert.equal(recovered.backup, "2026-10-30");
  assert.match(recovered.damagedFile, /^tenax-damaged-.*\.db$/);
  assert.ok(fs.existsSync(path.join(dir, recovered.damagedFile)), "the damaged file is kept");
  assert.deepEqual(library.loadState().courses, [{ id: "from-the-30th" }]);
});

test("with no backup to restore, a damaged file still leaves a working, empty library", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, FILE), "not a database");
  const { library, recovered } = openLibrary({ dir });
  assert.equal(recovered.backup, null);
  assert.equal(library.loadState(), null);
  library.apply({ upsert: { courses: [{ id: "c1" }] } });
  assert.equal(library.loadState().courses.length, 1);
});

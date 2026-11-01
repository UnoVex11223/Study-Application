// The sync folder (sync-folder.cjs): each computer writes its own files, reads
// the others' in order, and never trips over a half-written or damaged file.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const { createSync, PATTERN, CHANGES } = require("../sync-folder.cjs");

function fakeStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), delete: (k) => m.delete(k) };
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tenax-sync-"));
const computer = (id, name) => createSync({ store: fakeStore({ af_device: { id, name } }), version: "2.1.0" });
const pair = () => {
  const dir = tmpDir();
  const desk = computer("aaaaaaaa", "DESK"), lap = computer("bbbbbbbb", "LAP");
  desk.setFolder(dir); lap.setFolder(dir);
  return { dir, desk, lap };
};
const states = (copies) => copies.map(c => c.state);

test("each computer writes its own file and reads only the others'", () => {
  const dir = path.join(tmpDir(), "Tenax");
  const desk = computer("aaaaaaaa", "DESKTOP-1");
  const lap = computer("bbbbbbbb", "Ian's Laptop");
  assert.equal(desk.status().enabled, false);
  desk.setFolder(dir);
  lap.setFolder(dir);
  assert.ok(fs.existsSync(dir), "the folder is created");

  assert.equal(desk.pushSnapshot({ courses: [{ id: "c1" }] }).ok, true);
  assert.equal(lap.pushSnapshot({ courses: [{ id: "c2" }] }).ok, true);
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ["tenax-DESKTOP-1-aaaaaaaa.json.gz", "tenax-Ian-s-Laptop-bbbbbbbb.json.gz"]);
  assert.ok(files.every(f => PATTERN.test(f)));

  const got = desk.pull();
  assert.equal(got.ok, true);
  assert.equal(got.copies.length, 1);
  assert.equal(got.copies[0].deviceName, "Ian's Laptop");
  assert.deepEqual(got.copies[0].state, { courses: [{ id: "c2" }] });
  assert.deepEqual(desk.status().others.map(o => o.name), ["Ian-s-Laptop"]);
});

test("changes are small numbered files, read in order after the snapshot they follow", () => {
  const { dir, desk, lap } = pair();
  lap.pushSnapshot({ n: "snapshot" }, { throughSeq: 0 });
  lap.pushChanges({ n: 1 }, 1);
  lap.pushChanges({ n: 2 }, 2);
  assert.ok(fs.readdirSync(dir).some(f => CHANGES.test(f)));
  assert.deepEqual(states(desk.pull().copies), [{ n: "snapshot" }, { n: 1 }, { n: 2 }]);
  assert.deepEqual(desk.pull().copies, [], "nothing new");
  lap.pushChanges({ n: 3 }, 3);
  assert.deepEqual(states(desk.pull().copies), [{ n: 3 }], "only what's new");
  assert.deepEqual(states(desk.pull({ all: true }).copies), [{ n: "snapshot" }, { n: 1 }, { n: 2 }, { n: 3 }], "or everything, on start-up");
});

test("a change file that hasn't arrived yet is waited for, never skipped", () => {
  const { dir, desk, lap } = pair();
  lap.pushSnapshot({ n: "s" }, { throughSeq: 0 });
  lap.pushChanges({ n: 1 }, 1);
  lap.pushChanges({ n: 2 }, 2);
  lap.pushChanges({ n: 3 }, 3);
  const second = path.join(dir, lap.changeFile(2));
  const held = fs.readFileSync(second);
  fs.writeFileSync(second, held.subarray(0, 10)); // still downloading
  assert.deepEqual(states(desk.pull().copies), [{ n: "s" }, { n: 1 }], "stops before the incomplete file");
  fs.writeFileSync(second, held);
  assert.deepEqual(states(desk.pull().copies), [{ n: 2 }, { n: 3 }], "and carries on once it's whole");
  fs.rmSync(path.join(dir, lap.changeFile(4)), { force: true });
  lap.pushChanges({ n: 5 }, 5);
  assert.deepEqual(desk.pull().copies, [], "a missing number holds the rest back");
});

test("a fresh snapshot covers the change files before it, which are then removed", () => {
  const { dir, desk, lap } = pair();
  lap.pushSnapshot({ n: "old" }, { throughSeq: 0 });
  lap.pushChanges({ n: 1 }, 1);
  assert.equal(desk.pull().copies.length, 2);
  lap.pushChanges({ n: 2 }, 2);
  lap.pushSnapshot({ n: "new" }, { throughSeq: 2 });
  lap.prune(2);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, lap.ownFile()), later, later);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.includes("bbbbbbbb")), [lap.ownFile()]);
  assert.deepEqual(states(desk.pull().copies), [{ n: "new" }], "the new snapshot replaces change 2");
  lap.pushChanges({ n: 3 }, 3);
  assert.deepEqual(states(desk.pull().copies), [{ n: 3 }]);
});

test("when to write a fresh snapshot: none yet, or change files piling up", () => {
  const { lap } = pair();
  assert.equal(lap.needsCompaction(), true, "no snapshot yet");
  assert.equal(lap.hasSnapshot(), false);
  lap.pushSnapshot({}, { throughSeq: 0 });
  assert.equal(lap.hasSnapshot(), true);
  assert.equal(lap.needsCompaction(), false);
  for (let i = 1; i <= 40; i++) lap.pushChanges({ i }, i);
  assert.equal(lap.needsCompaction(), true, "40 change files");
  lap.pushSnapshot({}, { throughSeq: 40 });
  lap.prune(40);
  lap.pushChanges({ i: 41 }, 41);
  assert.equal(lap.needsCompaction(), false);
  assert.equal(lap.needsCompaction(Date.now() + 25 * 3600e3), true, "or a day old");
});

test("a snapshot from an earlier version (no change files, no throughSeq) still syncs", () => {
  const { dir, desk } = pair();
  fs.writeFileSync(path.join(dir, "tenax-OLD-cccccccc.json.gz"), zlib.gzipSync(JSON.stringify({ format: 1, deviceId: "cccccccc", deviceName: "OLD", state: { v: "old" } })));
  assert.deepEqual(states(desk.pull().copies), [{ v: "old" }]);
});

test("damaged, half-synced and unrelated files are skipped, then read once they're whole", () => {
  const dir = tmpDir();
  const desk = computer("aaaaaaaa", "DESK");
  desk.setFolder(dir);
  const bad = path.join(dir, "tenax-LAP-bbbbbbbb.json.gz");
  fs.writeFileSync(bad, "not gzip at all");
  fs.writeFileSync(path.join(dir, "notes.txt"), "hello");
  fs.writeFileSync(path.join(dir, "tenax-LAP-bbbbbbbb.json.gz.1234.tmp"), "partial");
  assert.deepEqual(desk.pull().copies, []);

  const lap = computer("bbbbbbbb", "LAP");
  lap.setFolder(dir);
  lap.pushSnapshot({ ok: 1 });
  assert.equal(desk.pull().copies.length, 1, "the same file is read once it's complete");
});

test("a copy in an unknown format is ignored; a missing folder is reported", () => {
  const dir = tmpDir();
  const desk = computer("aaaaaaaa", "DESK");
  desk.setFolder(dir);
  fs.writeFileSync(path.join(dir, "tenax-X-cccccccc.json.gz"), zlib.gzipSync(JSON.stringify({ format: 99, state: {} })));
  assert.deepEqual(desk.pull().copies, []);
  fs.rmSync(dir, { recursive: true, force: true });
  const r = desk.pull();
  assert.equal(r.ok, false);
  assert.match(r.error, /isn't available/);
  assert.equal(desk.pushSnapshot({}).ok, true, "writing recreates the folder");
});

test("stopping turns sync off without touching the folder; a new computer gets an id", () => {
  const dir = tmpDir();
  const s = createSync({ store: fakeStore() });
  const dev = s.device();
  assert.match(dev.id, /^[0-9a-f]{8}$/);
  assert.equal(s.device().id, dev.id, "stable");
  s.setFolder(dir);
  s.pushSnapshot({ a: 1 });
  s.stop();
  assert.equal(s.status().enabled, false);
  assert.equal(s.pushSnapshot({ a: 2 }).ok, false);
  assert.equal(fs.readdirSync(dir).length, 1, "your data in the folder stays");
});

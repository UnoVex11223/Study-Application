// The sync folder (sync-folder.cjs): each computer writes its own file, reads
// the others', and never trips over a half-written or damaged file.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const { createSync, PATTERN } = require("../sync-folder.cjs");

function fakeStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), delete: (k) => m.delete(k) };
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tenax-sync-"));
const computer = (id, name) => createSync({ store: fakeStore({ af_device: { id, name } }), version: "2.1.0" });

test("each computer writes its own file and reads only the others'", () => {
  const dir = path.join(tmpDir(), "Tenax");
  const desk = computer("aaaaaaaa", "DESKTOP-1");
  const lap = computer("bbbbbbbb", "Ian's Laptop");
  assert.equal(desk.status().enabled, false);
  desk.setFolder(dir);
  lap.setFolder(dir);
  assert.ok(fs.existsSync(dir), "the folder is created");

  assert.equal(desk.push({ courses: [{ id: "c1" }] }).ok, true);
  assert.equal(lap.push({ courses: [{ id: "c2" }] }).ok, true);
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

test("a pull only returns copies that changed since the last one", () => {
  const dir = tmpDir();
  const desk = computer("aaaaaaaa", "DESK");
  const lap = computer("bbbbbbbb", "LAP");
  desk.setFolder(dir); lap.setFolder(dir);
  lap.push({ n: 1 });
  assert.equal(desk.pull().copies.length, 1);
  assert.equal(desk.pull().copies.length, 0, "nothing new");
  assert.equal(desk.pull({ all: true }).copies.length, 1, "unless asked for everything");
  lap.push({ n: 2 });
  const f = path.join(dir, lap.ownFile());
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(f, later, later);
  const again = desk.pull();
  assert.equal(again.copies.length, 1);
  assert.deepEqual(again.copies[0].state, { n: 2 });
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
  lap.push({ ok: 1 });
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
  assert.equal(desk.push({}).ok, true, "pushing recreates the folder");
});

test("stopping turns sync off without touching the folder; a new computer gets an id", () => {
  const dir = tmpDir();
  const store = fakeStore();
  const s = createSync({ store });
  const dev = s.device();
  assert.match(dev.id, /^[0-9a-f]{8}$/);
  assert.equal(s.device().id, dev.id, "stable");
  s.setFolder(dir);
  s.push({ a: 1 });
  s.stop();
  assert.equal(s.status().enabled, false);
  assert.equal(s.push({ a: 2 }).ok, false);
  assert.equal(fs.readdirSync(dir).length, 1, "your data in the folder stays");
});

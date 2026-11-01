// Sync folder: every computer keeps its own library and also writes what it
// knows into a folder your cloud drive syncs (OneDrive, Dropbox, Google
// Drive…). Each computer only ever writes its own files, so the cloud drive
// never sees two computers editing the same file:
//
//   tenax-<computer>-<id>.json.gz                     a full copy (snapshot), now and then
//   tenax-<computer>-<id>.<00000001>.changes.json.gz  what changed since the last upload
//
// Uploads are small change files, numbered in order. About once a day (or
// when they pile up) a computer writes a fresh snapshot and removes the change
// files it covers. Reading another computer means its snapshot, then its
// change files after it in order, with no gaps: a file the cloud drive hasn't
// finished bringing down is waited for, never skipped. The app merges what it
// reads record by record (src/lib/sync.js), so reading something twice
// changes nothing. Snapshots keep the format earlier versions read, so a
// computer that hasn't updated yet still syncs, from the snapshots.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const os = require("os");
const crypto = require("crypto");

const CONFIG = "af_sync";   // { dir }
const DEVICE = "af_device"; // { id, name }: this computer, never synced
const FORMAT = 1;           // snapshots, as every version since sync began reads them
const CHANGES_FORMAT = 2;
const PATTERN = /^tenax-[\w-]+-([0-9a-f]{8})\.json\.gz$/;
const CHANGES = /^tenax-[\w-]+-([0-9a-f]{8})\.(\d{8,})\.changes\.json\.gz$/;
// A fresh snapshot is written when this computer's change files reach any of these.
const COMPACT = { files: 40, bytes: 2 * 1024 * 1024, age: 24 * 3600e3 };

const slug = (s) => String(s || "computer").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "computer";
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const readGz = (file) => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));

function createSync({ store, version = "0" }) {
  const seen = new Map();    // snapshot file → mtime already returned this session
  const applied = new Map(); // other computer's id → the last of its change files returned, in order

  function device() {
    let d = store.get(DEVICE);
    if (!d?.id) {
      d = { id: crypto.randomBytes(4).toString("hex"), name: os.hostname() };
      store.set(DEVICE, d);
    }
    return d;
  }
  const ownBase = () => { const d = device(); return `tenax-${slug(d.name)}-${d.id}`; };
  const ownFile = () => `${ownBase()}.json.gz`;
  const changeFile = (seq) => `${ownBase()}.${String(seq).padStart(8, "0")}.changes.json.gz`;
  const dir = () => store.get(CONFIG)?.dir || null;
  const enabled = () => Boolean(dir());

  /** Where to suggest: the OneDrive folder if there is one. */
  function suggested() {
    const root = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
    return root && fs.existsSync(root) ? path.join(root, "Tenax") : path.join(os.homedir(), "Documents", "Tenax");
  }

  /** Every computer's files in the folder: id → { name, snapshot, changes: [{ file, seq, size }] (in order), savedAt }. */
  function scan() {
    const d = dir();
    const byDevice = new Map();
    if (!d || !fs.existsSync(d)) return byDevice;
    const entry = (id, file) => {
      if (!byDevice.has(id)) byDevice.set(id, { id, name: file.replace(/^tenax-/, "").replace(/-[0-9a-f]{8}\..*$/, ""), snapshot: null, changes: [], savedAt: 0 });
      return byDevice.get(id);
    };
    for (const file of fs.readdirSync(d)) {
      const snap = file.match(PATTERN), change = file.match(CHANGES);
      if (!snap && !change) continue;
      let stat;
      try { stat = fs.statSync(path.join(d, file)); } catch { continue; } // removed while we looked
      const e = entry((snap || change)[1], file);
      e.savedAt = Math.max(e.savedAt, stat.mtimeMs);
      if (snap) e.snapshot = { file, mtime: stat.mtimeMs };
      else e.changes.push({ file, seq: Number(change[2]), size: stat.size });
    }
    for (const e of byDevice.values()) e.changes.sort((a, b) => a.seq - b.seq);
    return byDevice;
  }

  const others = () => [...scan().values()].filter(e => e.id !== device().id);
  const mine = () => scan().get(device().id) || { snapshot: null, changes: [] };

  function status() {
    const d = dir();
    return { enabled: Boolean(d), dir: d, device: device(), others: others().map(({ name, savedAt }) => ({ name, savedAt })), suggested: suggested() };
  }

  function setFolder(folder) {
    fs.mkdirSync(folder, { recursive: true });
    store.set(CONFIG, { dir: folder });
    seen.clear(); applied.clear();
    return status();
  }

  function stop() {
    store.delete(CONFIG);
    seen.clear(); applied.clear();
    return status();
  }

  /** Write a file whole or not at all (retried if the cloud drive is holding it). */
  function write(name, body) {
    const d = dir();
    if (!d) return { ok: false, error: "Sync is off." };
    const final = path.join(d, name);
    const tmp = `${final}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(body)));
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(tmp, final); break; } catch (err) {
          if (attempt >= 4) throw err;
          sleepSync(150 * (attempt + 1));
        }
      }
      return { ok: true, savedAt: Date.now() };
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      return { ok: false, error: `Couldn't write to the sync folder: ${err.code || err.message}` };
    }
  }
  const header = (format) => { const dev = device(); return { format, app: version, deviceId: dev.id, deviceName: dev.name, savedAt: Date.now() }; };

  /** This computer's full copy. `throughSeq`: the last change file it includes. */
  function pushSnapshot(state, { throughSeq = 0 } = {}) {
    if (!state) return { ok: false, error: "Nothing to write." };
    return write(ownFile(), { ...header(FORMAT), throughSeq, state });
  }

  /** What changed since the last upload (a partial library), as change file number `seq`. */
  function pushChanges(state, seq) {
    return write(changeFile(seq), { ...header(CHANGES_FORMAT), kind: "changes", seq, state });
  }

  /** Remove this computer's change files up to `throughSeq` (a snapshot now covers them). */
  function prune(throughSeq) {
    const d = dir();
    for (const c of mine().changes) {
      if (c.seq <= throughSeq) { try { fs.rmSync(path.join(d, c.file), { force: true }); } catch { /* next time */ } }
    }
  }

  const hasSnapshot = () => Boolean(mine().snapshot);

  /** Time for a fresh snapshot: none yet, or the change files have piled up or grown old. */
  function needsCompaction(now = Date.now()) {
    const m = mine();
    if (!m.snapshot) return true;
    const bytes = m.changes.reduce((n, c) => n + c.size, 0);
    return m.changes.length >= COMPACT.files || bytes >= COMPACT.bytes || (m.changes.length > 0 && now - m.snapshot.mtime >= COMPACT.age);
  }

  /**
   * The other computers' copies to merge: snapshots that changed since the
   * last pull, then their change files in order. all: everything again (on start-up).
   */
  function pull({ all = false } = {}) {
    const d = dir();
    if (!d) return { ok: false, error: "Sync is off." };
    if (!fs.existsSync(d)) return { ok: false, error: "The sync folder isn't available. Is the drive connected?" };
    const copies = [];
    const copy = (data, name) => ({ deviceId: data.deviceId, deviceName: data.deviceName || name, savedAt: data.savedAt, app: data.app, state: data.state });
    for (const other of others()) {
      if (all) applied.delete(other.id);
      let from = applied.get(other.id);

      if (other.snapshot) {
        const fresh = all || seen.get(other.snapshot.file) !== other.snapshot.mtime;
        if (fresh) {
          let data = null;
          try { data = readGz(path.join(d, other.snapshot.file)); } catch { /* mid-download: try again next time */ }
          // A snapshot that can't be read yet holds this computer back: its changes build on it.
          if (!data) continue;
          if (data.format === FORMAT && data.state) {
            copies.push(copy(data, other.name));
            seen.set(other.snapshot.file, other.snapshot.mtime);
            if (Number.isInteger(data.throughSeq)) from = Math.max(from ?? 0, data.throughSeq);
          }
        }
      }
      // Without a known starting point (no snapshot, or one from an earlier version), start at the oldest change file.
      if (from == null) from = other.changes.length ? other.changes[0].seq - 1 : 0;

      for (const c of other.changes) {
        if (c.seq <= from) continue;
        if (c.seq !== from + 1) break; // a gap: wait for the missing file
        let data = null;
        try { data = readGz(path.join(d, c.file)); } catch { /* mid-download */ }
        if (!data || data.format !== CHANGES_FORMAT || !data.state) break;
        copies.push(copy(data, other.name));
        from = c.seq;
      }
      applied.set(other.id, from);
    }
    return { ok: true, copies };
  }

  return { device, enabled, status, setFolder, stop, pushSnapshot, pushChanges, prune, hasSnapshot, needsCompaction, pull, ownFile, changeFile };
}

module.exports = { createSync, PATTERN, CHANGES };

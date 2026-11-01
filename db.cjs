// The library on disk: a SQLite database (tenax.db) in the app's data folder,
// through the SQLite built into Electron (node:sqlite), so there's nothing
// extra to install or build.
//
// The interface keeps the whole library in memory (it's what the planner and
// every page work from) and sends only what changed after each edit
// (src/lib/delta.js), so saving an answer writes a couple of rows instead of
// the whole library.
//
//   records     one row per course, section, concept, question, link, note,
//               book import and shelf item: the record itself as JSON
//   attempts    review history, append-only: only deleting a concept removes
//               its reviews, so the app's in-memory cap never loses history
//   tombstones  deletions, kept so they carry over to your other computers
//   meta        the rest of the library: settings, per-day extras, version
//   props       the database's own bookkeeping (schema, revision, sync progress)
//
// Every write is a transaction with its own revision number (rev), so "what
// changed since the last sync" is one query (changesSince). The database runs
// in WAL mode with full syncing: a crash or power cut leaves the last saved
// version, never half of one. If the file is ever damaged, openLibrary sets it
// aside (it's never deleted) and restores the newest daily backup.

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const FILE = "tenax.db";
const SCHEMA = 1;
const LOADED_ATTEMPTS = 30000; // reviews kept in memory: the reducer and lib/sync.js use the same cap
const NAME = /^[A-Za-z]\w{0,47}$/; // a collection or a meta key
const OWN_TABLES = new Set(["attempts", "tombstones"]); // stored in their own tables, never as records or meta
const isCollection = (key) => NAME.test(key) && !OWN_TABLES.has(key);
const BACKUP = /^tenax-(\d{4}-\d{2}-\d{2})\.json$/;

/** How reviews are told apart (the same key lib/sync.js uses). */
const attemptKey = (a) => `${a.ts}|${a.itemId}|${a.mode || ""}|${a.rating ?? ""}`;
const entries = (o) => (o && typeof o === "object" ? Object.entries(o) : []);

function connect(file) {
  const db = new DatabaseSync(file);
  try {
    prepare(db);
  } catch (err) {
    try { db.close(); } catch { /* it may never have opened */ } // Windows can't move a file that's still open
    throw err;
  }
  return db;
}

function prepare(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS props (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records (
      kind TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (kind, id));
    CREATE INDEX IF NOT EXISTS records_rev ON records (rev);
    CREATE TABLE IF NOT EXISTS attempts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, ts INTEGER NOT NULL, concept_id TEXT, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS attempts_ts ON attempts (ts);
    CREATE INDEX IF NOT EXISTS attempts_concept ON attempts (concept_id);
    CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, rev INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS tombstones_rev ON tombstones (rev);
  `);
  const check = Object.values(db.prepare("PRAGMA quick_check").get() || {})[0];
  if (check !== "ok") throw new Error(`The library file failed its integrity check (${check}).`);
}

/** Everything the app does with the database, on an open connection. */
function wrap(db, { loadedAttempts = LOADED_ATTEMPTS } = {}) {
  const q = {
    getProp: db.prepare("SELECT value FROM props WHERE key = ?"),
    setProp: db.prepare("INSERT INTO props (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
    upsert: db.prepare(`INSERT INTO records (kind, id, updated_at, rev, data) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (kind, id) DO UPDATE SET updated_at = excluded.updated_at, rev = excluded.rev, data = excluded.data`),
    remove: db.prepare("DELETE FROM records WHERE kind = ? AND id = ?"),
    removeAttemptsOf: db.prepare("DELETE FROM attempts WHERE concept_id = ?"),
    addAttempt: db.prepare("INSERT OR IGNORE INTO attempts (key, ts, concept_id, data) VALUES (?, ?, ?, ?)"),
    setTombstone: db.prepare("INSERT INTO tombstones (id, ts, rev) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET ts = excluded.ts, rev = excluded.rev"),
    removeTombstone: db.prepare("DELETE FROM tombstones WHERE id = ?"),
    setMeta: db.prepare("INSERT INTO meta (key, value, rev) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, rev = excluded.rev"),
    records: db.prepare("SELECT kind, data FROM records ORDER BY rowid"),
    recordsSince: db.prepare("SELECT kind, data FROM records WHERE rev > ? ORDER BY rowid"),
    recentAttempts: db.prepare("SELECT data FROM (SELECT data, ts, seq FROM attempts ORDER BY ts DESC, seq DESC LIMIT ?) ORDER BY ts, seq"),
    allAttempts: db.prepare("SELECT data FROM attempts ORDER BY ts, seq"),
    attemptsSince: db.prepare("SELECT seq, data FROM attempts WHERE seq > ? ORDER BY seq"),
    lastAttemptSeq: db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM attempts"),
    tombstones: db.prepare("SELECT id, ts FROM tombstones"),
    tombstonesSince: db.prepare("SELECT id, ts FROM tombstones WHERE rev > ?"),
    meta: db.prepare("SELECT key, value FROM meta"),
    metaSince: db.prepare("SELECT key FROM meta WHERE rev > ?"),
    counts: db.prepare(`SELECT
      (SELECT COUNT(*) FROM records) AS records, (SELECT COUNT(*) FROM attempts) AS attempts,
      (SELECT COUNT(*) FROM tombstones) AS tombstones`),
    kinds: db.prepare("SELECT kind, COUNT(*) AS n FROM records GROUP BY kind"),
  };

  const getProp = (key, fallback = null) => {
    const row = q.getProp.get(key);
    return row ? JSON.parse(row.value) : fallback;
  };
  const setProp = (key, value) => { q.setProp.run(key, JSON.stringify(value)); };

  // All or nothing: a failed write leaves the database as it was.
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw err;
    }
  };
  const nextRev = () => { const rev = getProp("rev", 0) + 1; setProp("rev", rev); return rev; };
  const opened = () => getProp("initialized") != null;
  const markOpened = () => { if (!opened()) setProp("initialized", Date.now()); };

  const putRecord = (kind, r, rev) => {
    if (r && r.id != null) q.upsert.run(kind, String(r.id), Number(r.updatedAt) || 0, rev, JSON.stringify(r));
  };
  const putAttempt = (a) => {
    if (a && typeof a === "object") q.addAttempt.run(attemptKey(a), Number(a.ts) || 0, a.conceptId == null ? null : String(a.conceptId), JSON.stringify(a));
  };
  const putMeta = (key, value, rev) => {
    if (isCollection(key) && !Array.isArray(value)) q.setMeta.run(key, JSON.stringify(value ?? null), rev);
  };
  const metaValues = () => Object.fromEntries(q.meta.all().map(r => [r.key, JSON.parse(r.value)]));

  return {
    file: db.location?.() ?? null,
    schema: () => getProp("schema", SCHEMA),
    getProp,
    setProp,
    /** Has a library ever been saved here? */
    initialized: opened,
    revision: () => getProp("rev", 0),
    lastAttemptSeq: () => q.lastAttemptSeq.get().seq,
    getMeta: (key) => metaValues()[key],

    /** The library as the app holds it in memory, or null before anything was saved. */
    loadState({ allAttempts = false } = {}) {
      if (!opened()) return null;
      const state = metaValues();
      for (const { kind, data } of q.records.all()) (state[kind] ||= []).push(JSON.parse(data));
      state.attempts = (allAttempts ? q.allAttempts.all() : q.recentAttempts.all(loadedAttempts)).map(r => JSON.parse(r.data));
      state.tombstones = Object.fromEntries(q.tombstones.all().map(r => [r.id, r.ts]));
      return state;
    },

    /**
     * Save what changed (src/lib/delta.js):
     * { upsert: { kind: [records] }, remove: { kind: [ids] }, attempts: [new reviews],
     *   tombstones: { set: { id: ts }, remove: [ids] }, meta: { key: value } }
     */
    apply(delta = {}) {
      return transaction(() => {
        const rev = nextRev();
        for (const [kind, list] of entries(delta.upsert)) if (isCollection(kind)) for (const r of list || []) putRecord(kind, r, rev);
        for (const [kind, ids] of entries(delta.remove)) {
          if (!isCollection(kind)) continue;
          for (const id of ids || []) {
            q.remove.run(kind, String(id));
            if (kind === "concepts") q.removeAttemptsOf.run(String(id)); // a concept's reviews go with it
          }
        }
        for (const a of delta.attempts || []) putAttempt(a);
        for (const [id, ts] of entries(delta.tombstones?.set)) q.setTombstone.run(String(id), Number(ts) || 0, rev);
        for (const id of delta.tombstones?.remove || []) q.removeTombstone.run(String(id));
        for (const [key, value] of entries(delta.meta)) putMeta(key, value, rev);
        markOpened();
        return { ok: true, rev };
      });
    },

    /** Replace the whole library (restoring a backup, resetting, the first import). */
    replace(state = {}) {
      return transaction(() => {
        db.exec("DELETE FROM records; DELETE FROM attempts; DELETE FROM tombstones; DELETE FROM meta;");
        const rev = nextRev();
        for (const [key, value] of entries(state)) {
          if (OWN_TABLES.has(key)) continue;
          if (Array.isArray(value)) { if (isCollection(key)) for (const r of value) putRecord(key, r, rev); }
          else putMeta(key, value, rev);
        }
        for (const a of state.attempts || []) putAttempt(a);
        for (const [id, ts] of entries(state.tombstones)) q.setTombstone.run(String(id), Number(ts) || 0, rev);
        markOpened();
        return { ok: true, rev };
      });
    },

    /**
     * What changed after revision `rev` (and reviews after `attemptSeq`), as a
     * partial library for the sync folder. Settings travel with the time they
     * changed, and a copy without them can never win them.
     */
    changesSince({ rev = 0, attemptSeq = 0 } = {}) {
      const meta = metaValues();
      const out = { version: meta.version ?? 0 };
      let count = 0;
      for (const { kind, data } of q.recordsSince.all(rev)) { (out[kind] ||= []).push(JSON.parse(data)); count++; }
      const attempts = q.attemptsSince.all(attemptSeq);
      out.attempts = attempts.map(r => JSON.parse(r.data));
      count += attempts.length;
      const tombstones = q.tombstonesSince.all(rev);
      out.tombstones = Object.fromEntries(tombstones.map(r => [r.id, r.ts]));
      count += tombstones.length;
      for (const { key } of q.metaSince.all(rev)) if (key !== "version") { out[key] = meta[key]; count++; }
      for (const [value, time] of [["settings", "settingsUpdatedAt"], ["days", "daysUpdatedAt"]]) {
        if (value in out || time in out) { out[value] = meta[value]; out[time] = meta[time] ?? 0; }
      }
      out.settingsUpdatedAt ??= 0;
      return {
        state: out,
        rev: getProp("rev", 0),
        attemptSeq: attempts.at(-1)?.seq ?? Math.max(attemptSeq, 0),
        empty: count === 0,
      };
    },

    /** How much is stored: { records, attempts, tombstones, kinds: { courses: n, … } }. */
    stats() {
      const c = q.counts.get();
      return { ...c, kinds: Object.fromEntries(q.kinds.all().map(r => [r.kind, r.n])) };
    },

    /** Fold the write-ahead log into the file and close (on quit). */
    close() {
      try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* closing anyway */ }
      db.close();
    },
  };
}

/** The newest daily backup that can be read, or null. */
function newestBackup(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => BACKUP.test(f)).sort().reverse();
  for (const f of files) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (state && typeof state === "object") return { date: f.match(BACKUP)[1], state };
    } catch { /* damaged too: try the one before */ }
  }
  return null;
}

/** Move a damaged database (and its write-ahead log) out of the way, keeping it. */
function setAside(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const aside = file.replace(/\.db$/, `-damaged-${stamp}.db`);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, aside + suffix);
  }
  return path.basename(aside);
}

/**
 * Open (or create) the library in `dir`. Returns { library, recovered }:
 * recovered is set when the file was damaged and the newest backup restored
 * ({ reason, damagedFile, backup: date | null }).
 */
function openLibrary({ dir, backupsDir = path.join(dir, "backups"), loadedAttempts } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, FILE);
  try {
    const library = wrap(connect(file), { loadedAttempts });
    if (!library.getProp("schema")) library.setProp("schema", SCHEMA);
    return { library, recovered: null };
  } catch (err) {
    const damagedFile = setAside(file);
    const library = wrap(connect(file), { loadedAttempts });
    library.setProp("schema", SCHEMA);
    const backup = newestBackup(backupsDir);
    if (backup) library.replace(backup.state);
    return { library, recovered: { reason: err.message, damagedFile, backup: backup?.date ?? null } };
  }
}

module.exports = { openLibrary, attemptKey, FILE, LOADED_ATTEMPTS };

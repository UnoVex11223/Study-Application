// Sync folder: every computer keeps working on its own local copy, and also
// writes that copy into a folder you choose (OneDrive, Dropbox, Google Drive…).
// Each computer has its own file there, so the sync service never sees two
// computers editing the same file. The app reads the other computers' files
// and merges them in (see src/lib/sync.js).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const os = require("os");
const crypto = require("crypto");

const CONFIG = "af_sync";   // { dir }
const DEVICE = "af_device"; // { id, name } — this computer, never synced
const FORMAT = 1;
const PATTERN = /^tenax-[\w-]+-([0-9a-f]{8})\.json\.gz$/;

const slug = (s) => String(s || "computer").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "computer";
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

function createSync({ store, version = "0" }) {
  const seen = new Map(); // file → mtimeMs already merged this session

  function device() {
    let d = store.get(DEVICE);
    if (!d?.id) {
      d = { id: crypto.randomBytes(4).toString("hex"), name: os.hostname() };
      store.set(DEVICE, d);
    }
    return d;
  }
  const ownFile = () => { const d = device(); return `tenax-${slug(d.name)}-${d.id}.json.gz`; };
  const dir = () => store.get(CONFIG)?.dir || null;

  /** Where to suggest: the OneDrive folder if there is one. */
  function suggested() {
    const root = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
    return root && fs.existsSync(root) ? path.join(root, "Tenax") : path.join(os.homedir(), "Documents", "Tenax");
  }

  function others() {
    const d = dir();
    if (!d || !fs.existsSync(d)) return [];
    const mine = ownFile();
    return fs.readdirSync(d).filter(f => PATTERN.test(f) && f !== mine).map(f => {
      const stat = fs.statSync(path.join(d, f));
      return { file: f, name: f.replace(/^tenax-/, "").replace(/-[0-9a-f]{8}\.json\.gz$/, ""), savedAt: stat.mtimeMs };
    });
  }

  function status() {
    const d = dir();
    return { enabled: Boolean(d), dir: d, device: device(), others: others().map(({ name, savedAt }) => ({ name, savedAt })), suggested: suggested() };
  }

  function setFolder(folder) {
    fs.mkdirSync(folder, { recursive: true });
    store.set(CONFIG, { dir: folder });
    seen.clear();
    return status();
  }

  function stop() {
    store.delete(CONFIG);
    seen.clear();
    return status();
  }

  /** Write this computer's copy (atomically; retried if the sync service holds the file). */
  function push(state) {
    const d = dir();
    if (!d || !state) return { ok: false, error: "Sync is off." };
    const dev = device();
    const body = zlib.gzipSync(JSON.stringify({ format: FORMAT, app: version, deviceId: dev.id, deviceName: dev.name, savedAt: Date.now(), state }));
    const final = path.join(d, ownFile());
    const tmp = `${final}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(tmp, body);
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

  /** The other computers' copies that changed since the last pull (all of them with all: true). */
  function pull({ all = false } = {}) {
    const d = dir();
    if (!d) return { ok: false, error: "Sync is off." };
    if (!fs.existsSync(d)) return { ok: false, error: "The sync folder isn't available. Is the drive connected?" };
    const copies = [];
    for (const o of others()) {
      if (!all && seen.get(o.file) === o.savedAt) continue;
      try {
        const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(d, o.file))).toString("utf8"));
        if (data?.format !== FORMAT || !data.state) continue;
        copies.push({ deviceId: data.deviceId, deviceName: data.deviceName || o.name, savedAt: data.savedAt, app: data.app, state: data.state });
        seen.set(o.file, o.savedAt);
      } catch { /* mid-download or damaged: try again next time */ }
    }
    return { ok: true, copies };
  }

  return { device, status, setFolder, stop, push, pull, ownFile };
}

module.exports = { createSync, PATTERN };

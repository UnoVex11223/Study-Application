const { app, BrowserWindow, ipcMain, shell, nativeTheme, safeStorage, dialog, powerMonitor } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");
const Anthropic = require("@anthropic-ai/sdk");
const pdf = require("./pdf-text.cjs");
const { createSync } = require("./sync-folder.cjs");
const { openLibrary } = require("./db.cjs");
const codeRunner = require("./code-runner.cjs");
const aiUsage = require("./ai-usage.cjs");

// Your data stays in the folder earlier versions used (%APPDATA%\aeroflash on
// Windows), so renaming the app never loses your library or API key.
const LEGACY_DATA = path.join(app.getPath("appData"), "aeroflash");
if (fs.existsSync(LEGACY_DATA)) app.setPath("userData", LEGACY_DATA);

// One copy at a time. Two copies (the installed app and a development build,
// say) would both write the same library, each undoing the other's changes;
// a second launch brings the open window forward and quits.
const FIRST_COPY = app.requestSingleInstanceLock?.() ?? true;
if (!FIRST_COPY) app.exit(0);
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

const store = new Store();
const API_KEY = "af_api_key";         // plain text (older versions, or no OS encryption available)
const API_KEY_ENC = "af_api_key_enc"; // encrypted with the OS (Windows: DPAPI, macOS: Keychain)

// ── API key ───────────────────────────────────────────────────────────────────
// The key is encrypted with the operating system's per-user encryption when
// it's available, so copying the data file elsewhere doesn't expose it.
const canEncrypt = () => { try { return Boolean(safeStorage?.isEncryptionAvailable()); } catch { return false; } };

function saveApiKey(key) {
  store.delete(API_KEY);
  store.delete(API_KEY_ENC);
  if (!key) return;
  if (canEncrypt()) store.set(API_KEY_ENC, safeStorage.encryptString(String(key)).toString("base64"));
  else store.set(API_KEY, String(key));
}

function readApiKey() {
  const enc = store.get(API_KEY_ENC);
  if (enc && canEncrypt()) {
    try { return safeStorage.decryptString(Buffer.from(enc, "base64")); } catch { /* unreadable on this account */ }
  }
  const plain = store.get(API_KEY);
  if (plain && canEncrypt()) saveApiKey(plain); // upgrade a key saved by an older version
  return plain || process.env.ANTHROPIC_API_KEY || null;
}

// ── One-time clean start ──────────────────────────────────────────────────────
// This version starts from an empty library. Anything stored by earlier
// versions (the old flashcards and anything converted from them) is written to
// a backup file in the app's data folder and then removed from the app.
// Settings and the API key are kept. If the backup can't be written, nothing
// is deleted.
const CLEAN_START = "af_clean_start_v1";
const OLD_KEYS = ["af_topics", "af_log", "af_stats", "af_xp", "af_schema_version", "af3_state"];
function cleanStart() {
  if (store.get(CLEAN_START)) return;
  const old = Object.fromEntries(OLD_KEYS.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
  if (Object.keys(old).length) {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(path.join(app.getPath("userData"), `backup-before-clean-start-${stamp}.json`), JSON.stringify(old));
    } catch {
      return;
    }
    const settings = old.af3_state?.settings;
    for (const k of OLD_KEYS) store.delete(k);
    if (settings) store.set("af3_state", { version: 3, settings });
  }
  store.set(CLEAN_START, true);
}
cleanStart();

// ── The library (see db.cjs) ──────────────────────────────────────────────────
// Your library is a SQLite database in the data folder; the interface sends
// only what changed after each edit. config.json (electron-store) keeps just
// the small things: the API key, this computer's sync settings.
// Versions before the database kept the whole library in config.json under
// LEGACY_KEY. The interface brings that in (merging it, if an older version
// wrote it since) and then asks for it to be archived (db:legacy-done).
const LEGACY_KEY = "af3_state";
let library = null, libraryRecovered = null, libraryError = "";
if (FIRST_COPY) {
  try {
    ({ library, recovered: libraryRecovered } = openLibrary({ dir: app.getPath("userData") }));
  } catch (err) {
    libraryError = `Tenax couldn't open its library file: ${err.message}`;
  }
}
app.on("will-quit", () => { try { library?.close(); } catch { /* quitting anyway */ } });

// ── Sync folder (see sync-folder.cjs) ────────────────────────────────────────
// This computer's changes go to the sync folder when you leave Tenax (switch
// windows, minimize, close it, lock or sleep the computer) and at most every
// few minutes while you keep studying, not after every answer: each write is
// an upload. What's written is a small file of what changed since the last
// upload, and about once a day a full copy that replaces those files. The UI
// pulls the other computers' files.
const sync = createSync({ store, version: app.getVersion?.() ?? "0" });
const PUSH_EVERY = 5 * 60e3;
const SYNC_SEQ = "sync_seq";        // library props: the number of this computer's last change file
const SYNC_PUSHED = "sync_pushed";  // and what it covered: { rev, attemptSeq }
let pushTimer = null;

/** A full copy of the library, covering every change file so far (which are then removed). */
function pushSnapshot() {
  const state = library?.loadState();
  if (!state) return;
  const seq = library.getProp(SYNC_SEQ, 0);
  const covered = { rev: library.revision(), attemptSeq: library.lastAttemptSeq() };
  if (sync.pushSnapshot(state, { throughSeq: seq }).ok) {
    library.setProp(SYNC_PUSHED, covered);
    sync.prune(seq);
  }
}

/** Hand this computer's changes over: what changed since the last upload, and a fresh full copy when it's due. */
function flushPush() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!library?.initialized() || !sync.enabled()) return;
  try {
    if (!sync.hasSnapshot()) { pushSnapshot(); return; }
    const changes = library.changesSince(library.getProp(SYNC_PUSHED, { rev: 0, attemptSeq: 0 }));
    if (!changes.empty) {
      const seq = library.getProp(SYNC_SEQ, 0) + 1;
      if (!sync.pushChanges(changes.state, seq).ok) return; // tried again next time
      library.setProp(SYNC_SEQ, seq);
      library.setProp(SYNC_PUSHED, { rev: changes.rev, attemptSeq: changes.attemptSeq });
    }
    if (sync.needsCompaction()) pushSnapshot();
  } catch (err) {
    console.error("Sync push failed:", err);
  }
}
const schedulePush = () => {
  if (sync.enabled() && !pushTimer) pushTimer = setTimeout(flushPush, PUSH_EVERY);
};
app.on("before-quit", flushPush);

ipcMain.handle("sync:status", () => sync.status());
ipcMain.handle("sync:choose", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const current = sync.status();
  const res = await dialog.showOpenDialog(win, {
    title: "Choose a folder to sync through",
    defaultPath: current.dir || path.dirname(current.suggested),
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths?.[0]) return current;
  const out = sync.setFolder(res.filePaths[0]);
  pushSnapshot();
  return out;
});
// One-click setup uses the suggested folder (OneDrive\Tenax); any other
// folder goes through the picker, so the page can't point sync anywhere.
ipcMain.handle("sync:use", () => {
  const out = sync.setFolder(sync.status().suggested);
  pushSnapshot();
  return out;
});
ipcMain.handle("sync:stop", () => { flushPush(); return sync.stop(); });
ipcMain.handle("sync:pull", (_e, opts) => sync.pull(opts || {}));
ipcMain.handle("sync:flush", () => { flushPush(); return { ok: true }; });
ipcMain.handle("app:version", () => app.getVersion?.() ?? "0");

// ── Covers ──────────────────────────────────────────────────────────────────
// Find a book's cover on Open Library and download the one you pick (covers.cjs).
const covers = require("./covers.cjs");
const netFetch = (...args) => (require("electron").net?.fetch ?? fetch)(...args);
ipcMain.handle("covers:search", (_e, q) => covers.search(netFetch, { title: String(q?.title || ""), author: String(q?.author || "") }));
ipcMain.handle("covers:fetch", (_e, id) => covers.download(netFetch, String(id || "")));

// ── Updates ─────────────────────────────────────────────────────────────────
// The installed app checks GitHub Releases for a newer version, downloads it
// in the background and installs it the next time Tenax closes, so every
// computer stays on the same version (sync skips copies from newer versions).
let update = { state: "idle", version: null };
let updater = null;
function startUpdates() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater: updater } = require("electron-updater")); } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("update-available", (i) => { update = { state: "downloading", version: i?.version ?? null }; });
  updater.on("update-downloaded", (i) => { update = { state: "ready", version: i?.version ?? null }; });
  updater.on("error", () => { if (update.state !== "ready") update = { state: "idle", version: null }; });
  const check = () => { if (update.state === "idle") updater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 10000).unref?.();
  setInterval(check, 4 * 3600e3).unref?.();
}
ipcMain.handle("app:update", () => update);
ipcMain.handle("app:update-install", () => {
  if (update.state !== "ready" || !updater) return false;
  flushPush();
  setImmediate(() => updater.quitAndInstall());
  return true;
});

// Small settings outside the library. The key can be set from the UI but never read back.
ipcMain.handle("store-get", (_event, key) => (key === API_KEY || key === API_KEY_ENC ? null : store.get(key, null)));
ipcMain.handle("store-set", (_event, key, val) => {
  if (key === API_KEY) return saveApiKey(val);
  if (key === API_KEY_ENC) return;
  if (val === null || val === undefined) store.delete(key);
  else store.set(key, val);
});

// The library: loaded once, then saved a change at a time (src/lib/persist.js).
ipcMain.handle("db:load", () => {
  if (!library) return { ok: false, error: libraryError || "The library isn't open." };
  const out = { ok: true, state: library.loadState(), legacy: store.get(LEGACY_KEY) ?? null, recovered: libraryRecovered };
  libraryRecovered = null; // said once
  return out;
});
const save = (write) => {
  try {
    write();
    schedulePush();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "The change couldn't be saved." };
  }
};
ipcMain.handle("db:apply", (_e, delta) => save(() => library.apply(delta)));
ipcMain.handle("db:replace", (_e, state) => save(() => library.replace(state)));
// When the window closes, what's left is sent synchronously so nothing is lost.
ipcMain.on("db:save-now", (e, { delta, state } = {}) => {
  e.returnValue = save(() => (state ? library.replace(state) : library.apply(delta)));
});
// The library from before the database is in now: archive it out of config.json.
ipcMain.handle("db:legacy-done", () => {
  const legacy = store.get(LEGACY_KEY);
  if (!legacy) return { ok: true };
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const file = path.join(app.getPath("userData"), `backup-before-database-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(legacy));
    store.delete(LEGACY_KEY);
    return { ok: true, file: path.basename(file) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Automatic backups ─────────────────────────────────────────────────────────
// A copy of your library is saved once a day (at start-up and every few hours
// while the app runs), and the last 14 are kept. The API key isn't included.
const BACKUP_KEEP = 14;
const backupsDir = () => path.join(app.getPath("userData"), "backups");
const BACKUP_NAME = /^tenax-\d{4}-\d{2}-\d{2}\.json$/;

function autoBackup(now = new Date()) {
  try {
    // Every review is in the backup, not just the ones the app keeps in memory.
    const state = library?.initialized() ? library.loadState({ allAttempts: true }) : store.get(LEGACY_KEY);
    if (!state) return;
    fs.mkdirSync(backupsDir(), { recursive: true });
    const file = path.join(backupsDir(), `tenax-${now.toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(state));
    const files = fs.readdirSync(backupsDir()).filter(f => BACKUP_NAME.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) fs.rmSync(path.join(backupsDir(), f), { force: true });
  } catch { /* best effort: a failed backup never blocks the app */ }
}

ipcMain.handle("backup:info", () => {
  autoBackup();
  const files = fs.existsSync(backupsDir()) ? fs.readdirSync(backupsDir()).filter(f => BACKUP_NAME.test(f)).sort() : [];
  return { count: files.length, latest: files.at(-1)?.slice(6, 16) ?? null, keep: BACKUP_KEEP };
});
ipcMain.handle("backup:open", () => { fs.mkdirSync(backupsDir(), { recursive: true }); return shell.openPath(backupsDir()); });

// ── AI (runs here so the API key never reaches the renderer) ─────────────────
// Heavier reasoning (building a curriculum) uses the strongest model; grading
// runs many times a day, so it uses a faster one. Each list falls back in
// order if a model isn't available on the account.
const MODELS = {
  deep: ["claude-opus-5-5", "claude-opus-5"],
  fast: ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5"],
};

function getClient() {
  const apiKey = readApiKey();
  if (!apiKey) return null;
  // Retries (with backoff) cover brief overloads when several groups run at once.
  return new Anthropic({ apiKey, maxRetries: 4 });
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the API. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `API error: ${err.message}`;
  return err?.message || "Something went wrong.";
}

/**
 * Request parameters for one structured-output call.
 * The system prompt is marked for prompt caching: it's identical across the
 * many calls of an import or a study session, and cached input costs a tenth.
 * `prompt` is a string, or content blocks when a large stable part (e.g. the
 * list of concepts you already know) should be cached too.
 */
function buildParams({ system, prompt, schema, maxTokens, effort }, model) {
  return {
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    // Writing and reviewing questions is where the thinking pays off, so those calls ask for more of it.
    output_config: { format: { type: "json_schema", schema }, ...(effort ? { effort } : {}) },
    messages: [{ role: "user", content: prompt }],
  };
}

/** Parse a finished message into { ok, data } or { ok:false, error }. */
function readMessage(message) {
  if (message.stop_reason === "refusal") return { ok: false, error: "The model declined this content." };
  if (message.stop_reason === "max_tokens") return { ok: false, error: "That was too much material for one pass. Try a smaller section." };
  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: false, error: "The response couldn't be read." }; }
}

/** One structured-output call with model fallback. Returns { ok, data } or { ok:false, error }. */
async function structured(spec) {
  const client = getClient();
  if (!client) return { ok: false, error: "no-key" };
  let lastErr = null;
  for (const model of MODELS[spec.tier]) {
    try {
      const params = buildParams(spec, model);
      const message = spec.maxTokens > 8000
        ? await client.messages.stream(params).finalMessage()
        : await client.messages.create(params);
      aiUsage.record(app.getPath("userData"), { kind: spec.kind, model: message.model || model, usage: message.usage });
      return { ...readMessage(message), model };
    } catch (err) {
      lastErr = err;
      if (err instanceof Anthropic.NotFoundError) continue; // try the next model
      break;
    }
  }
  return { ok: false, error: friendlyError(lastErr) };
}

// Request builders shared by live calls and the Batch API (see "Batches" below).
const SPEC = {};

const str = (description) => (description ? { type: "string", description } : { type: "string" });
const strList = (description) => ({ type: "array", items: { type: "string" }, ...(description ? { description } : {}) });
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const escapeTag = (s) => String(s ?? "").replace(/<\/(source|answer|known_concepts|note)>/gi, "</ $1>");

// ── 1. Curriculum extraction ─────────────────────────────────────────────────
const EXTRACT_SCHEMA = obj({
  title: str("Title for this material, e.g. 'Chapter 4: Pointers'"),
  sections: {
    type: "array",
    items: obj({
      title: str(),
      concepts: {
        type: "array",
        items: obj({
          key: str("Short unique id within this response, e.g. k1, k2"),
          name: str("Short noun phrase a practitioner would use"),
          summary: str("1–2 sentence precise explanation faithful to the source"),
          kind: { type: "string", enum: ["definition", "mechanism", "distinction", "procedure", "principle", "fact"] },
          importance: { type: "string", enum: ["core", "supporting", "detail"] },
          importance_reason: str("The specific signal that makes it important"),
          excerpt: str("Verbatim quote from the source (max ~40 words) supporting the summary"),
          location: str("Heading, page or timestamp from the text, or empty"),
          prerequisites: strList("Keys from this response, or exact names from <known_concepts>, that this concept directly depends on"),
        }),
      },
    }),
  },
  gaps: strList("Places where extracted text seems to have lost information (figures, garbled equations, cut-off code)"),
});

// Shared by every prompt that finds concepts or writes, reviews or rewrites questions.
const SUBJECT = `THE SUBJECT, NOT THE BOOK
The source (a book, a course, notes) is only where the ideas were found. The learner is learning the subject itself (the language, the field, the skill), and every question must read as if a good teacher of that subject wrote it with no particular book in mind.
- General: ask what is true of the subject everywhere, not what one book did. "In C, what does getchar return at end of input?" is right; "How does the book's word-counting program decide a word has started?" is not.
- Never build a question on the source's own sample programs, exercises, running examples, case studies or names the author made up (its function names, variable names, constants such as IN and OUT, file names, characters). If such an example shows a real technique, ask about the technique on a fresh, self-contained example of your own, with every bit of code or data the question needs shown in the prompt.
- Never mention or lean on the source: no "the book", "the text", "the author", "the chapter", "this section", "the program above", "the earlier example", no section or page numbers, and no title of the source.
- A standard idiom, library function, keyword, law, theorem or term that practitioners everywhere use by that name is the subject, not the book: ask about it freely.
- The test: someone who learned this subject well from a different book could answer the question, and would see why it is worth knowing.`;

const EXTRACT_SYSTEM = `You turn study material (a book chapter, a course lesson, lecture notes) into a curriculum of concepts worth committing to long-term memory. The learner wants to be able to define, explain and apply each idea from memory months from now, so you must separate what matters from what doesn't.

SECTIONS
Split the material into its natural sections. Use the source's own headings where they exist; otherwise group by topic. A typical chapter has 3–8 sections; short notes may have one.

CONCEPTS
Each concept is one learnable idea.
- name: short, as a practitioner would say it ("Magic number", "Pointer arithmetic", "Normal form").
- summary: 1–2 precise sentences in plain language, faithful to the source. Use markdown \`code\` for identifiers and $...$ for math.
- importance — judge by these signals, never by how often a word appears:
  • explicit learning objectives, chapter summaries, key-term lists, bolded definitions
  • ideas the source works through with examples or exercises
  • ideas later material depends on
  • mistakes or pitfalls the source warns about
  core = needed to understand the rest, or central to the material's purpose.
  supporting = worth knowing and testable, but not foundational.
  detail = incidental facts, specific numbers, historical asides.
  Be strict: usually only 30–50% of concepts are core.
- Leave out entirely anything not worth remembering: anecdotes, motivation, navigation, exercise instructions, publisher or setup boilerplate, restatements.

GRANULARITY
A concept is an idea someone would explain as one unit, not a single fact. Every concept costs the learner reviews for years, so use the fewest concepts that cover what's worth remembering.
- Fold closely related facts into the concept they belong to: its syntax and variants, the rules for using it, and the pitfalls the source warns about are one concept ("Pointer assignment"), not four.
- Split only when two ideas can be understood, used or forgotten independently.
- As a rough guide, a dense 20–30 page textbook chapter yields about 12–25 concepts and a short lesson 3–8. More than about 30 from one chapter almost always means the ideas are split too finely.
- excerpt: copy a short passage exactly as written in the source.
- location: text taken from a PDF contains [Page N] markers; give the page the concept comes from ("p. 243"). Otherwise use the nearest heading, or leave it empty.
- prerequisites: only direct, genuine dependencies (B can't be understood without A). Reference a concept by its key in your output, or by the exact name of a concept in <known_concepts>.
- Each concept is later broken into small question steps (its terms, one rule, a small problem, a twist), so a concept should be an idea with that much in it, not a single fact.

${SUBJECT}
The same goes for concepts: a concept is an idea of the subject that a practitioner uses, not a feature of the book. When the source walks through its own sample program, extract the technique or rule the program demonstrates, named as the field names it ("State machine for scanning input", not "The IN/OUT word counter"), and write its summary in general terms. Leave out a concept that only exists inside the book's example.

DUPLICATES
If the same idea appears in several places, make one concept. If a concept means the same thing as one in <known_concepts>, don't recreate it; reference it as a prerequisite where relevant. Match on meaning, not on shared words.

CODE, MATH AND FIGURES
In technical material the key idea often lives in a code example or equation: extract the rule or behavior it demonstrates. If the text looks like it has lost something needed to understand a passage (a figure, a garbled equation, truncated code), record it in gaps rather than guessing.

Never add facts that the source doesn't support.`;

ipcMain.handle("ai:extract", async (_e, { courseName, title, location, text, known = [] }) => {
  const knownList = known.slice(0, 400).map((k) => `- ${k.name}${k.section ? ` (${k.section})` : ""}`).join("\n");
  const prompt = `Course: ${courseName}
${title ? `Material: ${title}\n` : ""}${location ? `Location: ${location}\n` : ""}
<known_concepts>
${knownList || "(none yet)"}
</known_concepts>

<source>
${escapeTag(text)}
</source>`;
  return structured({ kind: "extract", tier: "deep", system: EXTRACT_SYSTEM, prompt, schema: EXTRACT_SCHEMA, maxTokens: 32000 });
});

// ── 1b. Sorting a paste into courses ─────────────────────────────────────────
// One paste (a guide, a set of notes) can span several subjects. Before any
// concepts are extracted, the paste is split into courses and chapters, so
// each chapter is then imported like a book chapter (lib/bookRunner.js).
const PLAN_SCHEMA = obj({
  title: str("A short name for the whole paste, e.g. 'Web application guide'"),
  courses: {
    type: "array",
    items: obj({
      name: str("The course's name: its subject"),
      existing: str("The exact name of one of the learner's existing courses this material goes into, or empty for a new course"),
      parts: {
        type: "array",
        items: obj({
          title: str("The chapter's name, without numbering"),
          start_line: { type: "integer", description: "The number of the line this chapter starts on" },
        }),
      },
    }),
  },
  skip: {
    type: "array",
    items: obj({
      start_line: { type: "integer", description: "The number of the line this skipped run starts on" },
      reason: str("Why it isn't worth studying, in a few words"),
    }),
  },
});

const PLAN_SYSTEM = `You sort a long paste of study material (a guide, course notes, a set of lessons) into courses and chapters for a spaced-repetition app. Each chapter is then read on its own to find the ideas worth remembering and write questions about them, so you only decide where things go; you never summarize.

The paste is shown as numbered lines. Long lines are cut short: you see enough of each to tell what it's about.

COURSES
- A course is one subject the learner studies and tracks as a whole, the size of a book or a university course: "Web development", "React", "Databases", "Security", "Data engineering". Never name a course after the document ("Guide notes") or use a catch-all ("General", "Misc").
- Each course is about one subject. Fields people study on their own get their own course when the paste gives one a chapter or more, even if it presents them as steps of one story: databases, security and identity, a framework or language (React, Python), data engineering, machine learning. A web guide with chapters on HTTP, React, databases and authentication is four courses.
- Foundations a paste covers on the way to its main subject (how processes, networks or HTTP work, in a web guide) stay in that subject's course. Never make a course of a single short section, and ten chapters about one subject are one course.
- Put material in one of the learner's existing courses (listed with their chapters) when it's the same subject: give that course's exact name in existing. Otherwise leave existing empty.
- List courses in the order their material first appears.

CHAPTERS
- Each part is one chapter of its course: a run of lines from start_line up to the line before the next part or skip (of any course) starts.
- Use the source's own headings as boundaries ("Part 3: HTTP" starts a chapter, titled "HTTP"). Keep the source's order within a course. A course's chapters needn't be next to each other in the paste.
- A chapter is usually 2,000–15,000 characters. Split a much longer section at its sub-headings; join tiny neighbouring sections of the same subject into one chapter.
- Self-check questions, exercises and summaries at the end of a section stay in that section's chapter: they show what matters.

SKIP
Add a skip for runs with nothing worth remembering: a table of contents, "how to use this guide", navigation, sign-offs, link lists, boilerplate.

Every line belongs to exactly one part or skip, so the first one starts at line 1, and no two start on the same line.`;

ipcMain.handle("ai:plan", async (_e, { lines, total, courses = [] }) => {
  const known = courses.slice(0, 60).map((c) => `- ${c.name}${c.chapters?.length ? `: ${c.chapters.slice(0, 30).join("; ")}` : ""}`).join("\n");
  const prompt = `<existing_courses>
${escapeTag(known) || "(none yet)"}
</existing_courses>

<source lines="${Number(total) || 0}">
${escapeTag(lines)}
</source>`;
  return structured({ kind: "plan", tier: "deep", system: PLAN_SYSTEM, prompt, schema: PLAN_SCHEMA, maxTokens: 8000 });
});

// ── 2. Question ladders with rubrics, and a lesson per concept ──────────────────
const ABILITY_ENUM = { type: "string", enum: ["recall", "define", "explain", "distinguish", "apply", "connect"] };
const DIAGRAM_FIELD = str("A diagram as JSON text (see DIAGRAMS), or empty when there's none");
const ITEMS_SCHEMA = obj({
  lessons: {
    type: "array",
    description: "One per concept, written before its questions",
    items: obj({
      concept_key: str("Key of the concept this lesson teaches"),
      terms: { type: "array", items: obj({ term: str(), definition: str("One plain sentence") }) },
      worked_example: str("A short worked example (markdown), or empty"),
      diagram: DIAGRAM_FIELD,
    }),
  },
  tasks: {
    type: "array",
    items: obj({
      concept_key: str("Key of the concept this task practices"),
      level: { type: "integer", description: "Step on the concept's ladder: 1 term, 2 fact, 3 use, 4 twist, 5 combine" },
      ability: ABILITY_ENUM,
      shape: str("What form the answer takes, in 1–4 words: 'one word', 'a number', 'what it prints', 'one line of code', 'one sentence'"),
      prompt: str("The question shown to the learner (markdown)"),
      model_answer: str("A concise expert answer, with the why (markdown)"),
      accept: strList("Every acceptable exact answer when the answer is a term, number, value, output or line of code. Otherwise empty."),
      required_points: strList("What a correct answer must contain: one point for steps 1-4"),
      misconceptions: strList("Specific wrong beliefs that make an answer wrong"),
      hint: str("A nudge that does not reveal the answer"),
      diagram: DIAGRAM_FIELD,
    }),
  },
});

// Shared quality bar: the writer aims for it and the critic enforces it.
const QUALITY_BAR = `QUALITY BAR — every question will be reviewed for years, so it must earn its place:
- Worth remembering: tests an idea a practitioner uses or that later material depends on. The vocabulary of such an idea (its name, what it means) counts. Never trivia: exact numbers or dates that don't matter, names of minor things, the author's particular wording, the internals of the source's own sample programs, or anything you'd just look up.
- One thing, clearly: asks exactly one thing, unambiguously, and makes sense on its own months from now without the book. Never refer to "the text", "this chapter", "the author", a figure from the source, or an example the learner won't have in front of them (a diagram you attach yourself is in front of them).
- Real recall: answering requires producing the idea from memory. The prompt must not contain or hint at the answer. No yes/no or either/or questions, and nothing answerable by common sense or guessing.
- Gradable: the key points let a grader mark a correct paraphrase right and a plausible wrong answer wrong. Points are specific, each necessary, and together sufficient. Exact answers (a term, a value, an output, a line of code) list every acceptable form in accept.
- Accurate: the model answer is correct and consistent with the source. Work out code and circuits yourself.
- Small: answerable in a word, a value, a line of code or one or two sentences, never an essay. Asking for a complete list of more than three items is almost never worth it.`;

// Diagrams are drawn by the app from a small JSON description (src/lib/diagram.js checks and draws them).
const DIAGRAMS = `DIAGRAMS
A question or lesson can carry one diagram when a picture is the clearest way to pose it: a logic circuit to trace, pointers to follow, a binary word to decode, a tree to walk. The app draws it from a JSON description you write as text in the diagram field; leave the field empty otherwise. Use one to remove words, never to decorate. The prompt can then say "In the circuit shown, …"; everything the question needs must be in the prompt and the diagram together. Kinds:
- circuit: {"type":"circuit","inputs":["a","b","sel"],"gates":[{"id":"n1","op":"NOT","in":["sel"]},{"id":"g1","op":"AND","in":["a","n1"]},{"id":"g2","op":"AND","in":["b","sel"]},{"id":"g3","op":"OR","in":["g1","g2"]}],"outputs":{"out":"g3"},"values":{"a":1,"b":0,"sel":1},"ask":"out"}
  ops: AND OR NOT NAND NOR XOR XNOR BUF MUX (MUX takes [a, b, sel]; sel=1 selects b). values (optional) are input values drawn on the inputs; ask (optional) is the output the question asks about, drawn as "?". The app simulates the circuit and rejects an answer that disagrees with it. Leave values out when the question asks what the circuit computes in general.
- memory: {"type":"memory","boxes":[{"id":"x","label":"x","cells":["5"]},{"id":"p","label":"p","cells":[""]},{"id":"a","label":"a","cells":["3","1","4"],"index":true}],"arrows":[{"from":"p","to":"a","toCell":1}]}
  boxes are variables, arrays, structs or list nodes, each cell up to 14 characters; an arrow goes from a cell holding a pointer (leave that cell empty and it's drawn as a dot) to a box or one of its cells. "direction":"row" puts boxes side by side (linked lists). "?" in a cell marks what the learner works out.
- bits: {"type":"bits","bits":"1110001100001000","fields":[{"from":15,"to":13,"label":"111"},{"from":12,"to":12,"label":"a"}]}  most significant bit first; "?" marks bits to work out; fields label bit ranges (from is the higher bit).
- tree: {"type":"tree","root":{"label":"now","children":[{"label":"is","children":[{"label":"for"},null]},{"label":"the"}]}}  in a binary tree, null keeps left and right apart.`;

// What every ladder question is: the writer, the reviewer and rewrites share it.
const ONE_TARGET = `ONE ANSWER TARGET
- Every question asks for exactly one thing. "…, and why?", "…and how does this…", "describe the two…" are two questions: make them two steps or drop one. The why belongs in model_answer, which the learner reads after answering.
- shape says what form the answer takes, in 1–4 words ("one word", "a number", "what it prints", "one line of code", "one sentence", "the value of out"). The learner doesn't see it, so when the form isn't obvious the prompt says it in its own words ("Which number…", "What does this print?", "Write the line that…").
- When the answer is a term, number, value, expression, printed output or one line of code, accept lists every acceptable way of writing it (synonyms, abbreviations, with or without units, equivalent spellings of the same code). An answer matching accept is marked right instantly, so include every correct form and nothing wrong. For code and output, exact characters matter.
- required_points: exactly one for steps 1–4 (what a right answer must say, short and checkable); step 5 may have two. Recall: one point naming the answer.
- The answer is determinable from the prompt alone: if two different answers could be right, tighten the prompt.`;

const ITEMS_SYSTEM = `You write a ladder of retrieval-practice questions for each concept, and a short lesson that teaches it. The learner types every answer from memory; there are never multiple-choice options. The goal is durable memory: being able to name, explain and use each idea months from now without help.

THE LADDER
Break each concept into its smallest pieces of knowledge and ask about them one at a time, simplest first, each step adding exactly one thing to the steps below it, the way a good tutor would. A learner who has climbed the whole ladder knows the idea. The steps (level):
1 term: the vocabulary. Either recall (from its meaning, produce the term; accept lists every acceptable form) or define (from the term, give its meaning in one sentence; one required point: its essential meaning in plain words, not the textbook sentence).
2 fact: one rule, property or behavior with a short, determinate answer (recall, or explain for a one-sentence why or how).
3 use: a small NEW concrete problem with exactly one right answer: what a snippet prints or evaluates to, a variable's value after a line, the one line of code that does something, a circuit's output for given inputs, the next step of a procedure (apply).
4 twist: an edge case, a pitfall the source warns about, or the defining difference from an idea it's easily confused with (apply or distinguish).
5 combine: this idea used together with one it builds on, in one small problem (apply or connect).
How many: a core concept gets steps 1–4, and 5 when a natural combination exists. Supporting: steps 1–3. Detail: step 1, plus 2 if it's worth it. Skip a step that would be forced, trivial or a repeat (never pad), and start at step 2 when the idea has no vocabulary of its own. Write one question per step: get it right rather than writing alternatives (a reviewer checks every one and repairs what it can).
If a concept lists already_asked questions (with their steps), it already has those: write only its missing steps, as many as its "write" line asks for, each clearly different from what it has.
If a concept lists current_questions, you are rebuilding it: write its whole ladder. Copy a current question exactly where it is already one clear step; replace the rest. Current questions are often too broad: split them into steps rather than keeping them whole.

${ONE_TARGET}

SIMPLE AND PRECISE
- Short prompts: one or two sentences, plus a code block or diagram when the step needs one. Plain words, no preamble. No bold or italics in the prompt (the wording carries any stress); inline code only for identifiers, values and snippets.
- Work out every answer before writing it: trace code line by line, evaluate circuits. Prefer a simpler example you are certain of over a clever one you aren't.
- misconceptions: only for a question graded by meaning (accept is empty): 0–2 realistic wrong beliefs that make an answer wrong even when it uses the right words. Leave it empty when accept is filled: an exact answer is checked against accept.
- model_answer: the answer, then the why, in 1–3 sentences or a short code block. This is where the explanation lives.
- hint: a few words pointing toward the right area without revealing the answer.
- Keep every field as short as it can be while still doing its job: everything you write is reviewed and stored for years.

${SUBJECT}
If a concept's name or summary is itself tied to the book's example, write its questions about the general technique behind it.

PRACTICE THAT BUILDS SKILL
- Most of the learning happens in steps 3 to 5: doing something with the idea on a problem the learner has not seen. Make these real, small problems with one right answer, never "describe how you would".
- Each step should be answerable by someone who can do the steps below it and has read the lesson, and by no one who is guessing.
- Step 5 mixes in an earlier idea on purpose, so that practising this concept also exercises what it is built on.

LESSON
For each concept also write a lesson, shown just before the learner's first question on it (teach, then test):
- terms: the 1–3 terms the concept introduces, each defined in one plain sentence (empty if it introduces none). These are what step 1 drills.
- worked_example: one short worked example showing the idea in action, step by step: a snippet with what it does and why, a value worked out, a circuit traced. 2–6 lines plus any code. Make it the same kind of problem as step 3 with different values, so it shows the method the learner is about to use; it must not be the problem asked in steps 3–5, and it must be your own example, not the source's.
- diagram: when a picture makes the idea clearer.

${DIAGRAMS}

${QUALITY_BAR}

WRITING
- Vary phrasing; don't start every prompt the same way.
- Markdown: fenced code blocks with a language tag, \`inline code\`, $...$ for math, and small tables (| a | b |) for truth tables.`;

const oneLine = (p) => p.replace(/\s+/g, " ").slice(0, 300);

// How question writing trades cost for care (Settings → Question writing).
// The reviewer is the same at every level, so every question still passes the same gate.
const WRITERS = {
  thorough: { tier: "deep", effort: "high" }, // Opus, thinking more
  standard: { tier: "deep" },                 // Opus at its default effort
  economy: { tier: "fast" },                  // Sonnet: each token half Opus's price
};

SPEC.items = ({ courseName, sectionTitle, concepts, writer = "thorough" }) => {
  const list = concepts.map((c) => {
    const has = c.existing?.length
      ? `\nalready_asked:\n${c.existing.map((p, i) => `- ${c.steps?.[i] ? `(step ${c.steps[i]}) ` : ""}${oneLine(p)}`).join("\n")}\nwrite: up to ${c.want ?? 2} new candidates for the missing steps`
      : "";
    const current = c.current?.length ? `\ncurrent_questions:\n${c.current.map(p => `- ${oneLine(p)}`).join("\n")}` : "";
    return `<concept key="${c.key}" importance="${c.importance}" kind="${c.kind}">
name: ${c.name}
summary: ${c.summary}
${c.excerpt ? `source: ${c.excerpt}` : ""}${has}${current}
</concept>`;
  }).join("\n");
  const prompt = `Course: ${courseName}
Section: ${sectionTitle}

${list}`;
  return { kind: "items", ...(WRITERS[writer] ?? WRITERS.thorough), system: ITEMS_SYSTEM, prompt, schema: ITEMS_SCHEMA, maxTokens: 48000 };
};
ipcMain.handle("ai:items", (_e, payload) => structured(SPEC.items(payload)));

// ── 2b. Quality review (an independent critic) ──────────────────────────────
const REVISION = obj({
  shape: str(), prompt: str(), model_answer: str(), accept: strList(), required_points: strList(), misconceptions: strList(), hint: str(), diagram: DIAGRAM_FIELD,
});
const SCORE = { type: "integer", description: "1 to 5" };
// Revisions are listed separately so keep/drop verdicts don't pay for empty
// revision fields (output tokens are the expensive part).
const CRITIQUE_SCHEMA = obj({
  reviews: {
    type: "array",
    items: obj({
      id: str("The question id"),
      verdict: { type: "string", enum: ["keep", "revise", "drop"] },
      scores: obj({ importance: SCORE, clarity: SCORE, focus: SCORE, retrieval: SCORE, gradability: SCORE, accuracy: SCORE }),
      reason: str("For drop or revise: one short sentence on the main problem. For keep: empty"),
    }),
  },
  revisions: {
    type: "array",
    description: "One entry per question with verdict revise, and only those",
    items: { ...REVISION, properties: { id: str("The question id"), ...REVISION.properties }, required: ["id", ...REVISION.required] },
  },
});

const CRITIQUE_SYSTEM = `You are the quality gate for a learner's long-term memory. Every question you let through will be reviewed for months or years: a weak question wastes real time and a wrong one teaches errors. Be strict — dropping a mediocre question is better than keeping it.

The questions come as ladders: each concept's questions are steps (1 term, 2 fact, 3 use, 4 twist, 5 combine), each meant to test one piece of knowledge and add one thing to the step below.

Score each question from 1 to 5 on:
- importance: 5 = a core idea a practitioner uses or later material depends on. 4 = a useful idea worth having at your fingertips. 3 = nice to know. 2 = trivia (exact numbers or dates that don't matter, names of minor things, the author's wording, the internals of the source's own sample programs). 1 = not worth remembering. The vocabulary of an important idea (its name, its meaning) is as important as the idea: a learner who can't name or define it can't think with it.
- clarity: unambiguous, and makes sense on its own months from now without the book. Only one answer could be right, and the prompt (with its diagram, if any) holds everything needed.
- focus: asks for exactly one thing. 5 = one target, and the shape of the answer (a word, a number, what it prints) is clear. 3 = two things joined ("…, and why?"). 1 = an essay prompt or several questions.
- retrieval: answering requires producing the idea from memory. Low if the prompt contains or hints at the answer, is yes/no or either/or, or can be answered by guessing or common sense.
- gradability: a grader could mark a correct paraphrase right and a plausible wrong answer wrong. Steps 1–4 need one specific key point; accept must list every correct exact form (and no wrong one) when the answer is a term, value, output or line of code.
- accuracy: the model answer is correct and consistent with the source excerpt. Work out code and circuits yourself; don't trust the stated answer.

${SUBJECT}
A question that breaks this rule is never a keep. If the idea behind it is a real part of the subject, revise it into a general, self-contained question on a fresh example (same step, same kind of answer); if it only makes sense inside the book's example, drop it.

Then check each concept's ladder as a whole: the steps go from simplest to hardest, each adds one thing, step 1 can be answered by someone who just read the concept's summary, and no two steps test the same thing. If two questions test the same thing, keep the better one and drop the other as redundant.

Verdicts:
- keep: every score is 4 or 5 as written.
- revise: it tests something important (importance 4+) but has a fixable flaw. The most common one is asking two things: keep one target and move the rest into the model answer. Put the complete improved question in revisions (with the same id) and give the scores the REVISED question earns.
- drop: importance 3 or lower, redundant, or not fixable.
Leave reason empty for keep. Only revised questions go in revisions.

${ONE_TARGET}

${DIAGRAMS}

${QUALITY_BAR}`;

SPEC.critique = ({ courseName, sectionTitle, concepts, questions }) => {
  const ctx = concepts.map((c) => `<concept key="${c.key}" importance="${c.importance}">
${c.name}: ${c.summary}${c.excerpt ? `\nsource: ${c.excerpt}` : ""}
</concept>`).join("\n");
  const qs = questions.map((q) => `<question id="${q.id}" concept="${q.concept_key}"${q.level ? ` step="${q.level}"` : ""} type="${q.ability}">
${q.shape ? `shape: ${q.shape}\n` : ""}prompt: ${q.prompt}
${q.diagram ? `diagram: ${q.diagram}\n` : ""}model_answer: ${q.model_answer}
${q.accept?.length ? `accept: ${q.accept.join(" | ")}\n` : ""}key_points: ${(q.required_points || []).join(" | ")}
${q.misconceptions?.length ? `misconceptions: ${q.misconceptions.join(" | ")}\n` : ""}</question>`).join("\n");
  const inUse = concepts.filter((c) => c.existing?.length).map((c) => `<in_use concept="${c.key}">
${c.existing.map(p => `- ${p.replace(/\s+/g, " ").slice(0, 300)}`).join("\n")}
</in_use>`).join("\n");
  const prompt = `Course: ${courseName}
Section: ${sectionTitle}

${ctx}
${inUse ? `\nQuestions already in use (not for review; drop new questions that repeat them):\n${inUse}\n` : ""}
${qs}

Review every question above.`;
  return { kind: "critique", tier: "deep", effort: "high", system: CRITIQUE_SYSTEM, prompt, schema: CRITIQUE_SCHEMA, maxTokens: 32000 };
};
ipcMain.handle("ai:critique", (_e, payload) => structured(SPEC.critique(payload)));

// ── 2c. Rewrite a question you reported ──────────────────────────────────────
const REWRITE_SCHEMA = obj({
  worth_keeping: { type: "boolean", description: "False if the concept this question tests isn't worth long-term review at all" },
  reason: str("One sentence explaining the change, or why it should be deleted"),
  question: obj({
    ability: ABILITY_ENUM,
    shape: str(), prompt: str(), model_answer: str(), accept: strList(), required_points: strList(), misconceptions: strList(), hint: str(), diagram: DIAGRAM_FIELD,
  }),
});

const REWRITE_SYSTEM = `A learner flagged one of their review questions as a problem. Write a better question that tests the same idea, fixing the problem they reported (or the one you see). You may change the question type if another type tests the idea better. If the idea itself isn't worth long-term review, set worth_keeping to false and explain why.

The question is one step of the concept's ladder (1 term, 2 fact, 3 use, 4 twist, 5 combine): keep it on the same step, testing one piece of knowledge. A question that asks two things should become one clear question; the rest goes in the model answer.

${SUBJECT}
If the flagged question is about the book's own example, that is the problem to fix, whatever else was reported.

${ONE_TARGET}

${DIAGRAMS}

${QUALITY_BAR}`;

ipcMain.handle("ai:rewrite", async (_e, { concept, question, problem, note }) => {
  const prompt = `Concept: ${concept.name}
${concept.summary ? `Summary: ${concept.summary}\n` : ""}${concept.excerpt ? `Source: ${concept.excerpt}\n` : ""}
Current question (${question.ability}${question.level ? `, step ${question.level}` : ""}${question.shape ? `, answer: ${question.shape}` : ""}):
${question.prompt}
${question.diagram ? `Diagram: ${question.diagram}\n` : ""}
Model answer: ${question.answer}
Key points: ${(question.points || []).join(" | ")}

Reported problem: ${problem}${note ? `\nLearner's note: ${escapeTag(note)}` : ""}`;
  return structured({ kind: "rewrite", tier: "deep", effort: "high", system: REWRITE_SYSTEM, prompt, schema: REWRITE_SCHEMA, maxTokens: 8000 });
});

// ── 3. Rubric grading ────────────────────────────────────────────────────────
const GRADE_SCHEMA = obj({
  points: {
    type: "array",
    items: obj({ met: { type: "boolean" }, evidence: str("The learner's own words that state this point, copied exactly from inside <answer>; empty if met is false") }),
    description: "One entry per required point, in the same order",
  },
  misconceptions_found: strList("Misconceptions or clear factual errors the answer asserts"),
  uncertain: { type: "boolean" },
  follow_up: str("If uncertain, one short question that would resolve it; otherwise empty"),
  feedback: str("1–2 specific sentences"),
});

const GRADE_SYSTEM = `You grade a learner's typed answer to a retrieval-practice question against a fixed rubric.

- Grade meaning, not wording. Paraphrases, synonyms, informal language, a different order and small typos are fine.
- For each required point, decide whether the answer states it, explicitly or with clearly equivalent meaning. A vague gesture ("it's bad", "it matters") does not satisfy a point that requires a reason or mechanism.
- Evidence must be copied exactly from the learner's answer inside <answer>. Never quote the model answer or the key point itself. If you can't point to the learner's own words that state a point, that point is not met.
- Specific values must match. A different number, range, name, term or result is wrong even if its form looks right (e.g. "[-112, 111]" does not satisfy "-32,768 through 32,767"). A guess followed by a question mark still has to be right.
- Don't penalize the absence of anything the rubric doesn't require, and don't reward length or keyword stuffing.
- For each listed misconception, decide whether the answer asserts it. Also report any other clear factual error that bears on the question.
- If the answer is ambiguous in a way that decides a required point, set uncertain to true and ask one short follow-up question that would settle it. Otherwise uncertain is false and follow_up is empty.
- feedback: say specifically what was missing or wrong and state the correct idea. No praise or filler.`;

ipcMain.handle("ai:grade", async (_e, { prompt, modelAnswer, points, misconceptions, excerpt, answer, followUp }) => {
  const body = `<question>
${prompt}
</question>

<model_answer>
${modelAnswer}
</model_answer>

<required_points>
${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}
</required_points>

<misconceptions>
${misconceptions.length ? misconceptions.map((m) => `- ${m}`).join("\n") : "(none listed)"}
</misconceptions>
${excerpt ? `\n<source_excerpt>\n${excerpt}\n</source_excerpt>\n` : ""}
<answer>
${escapeTag(answer)}
</answer>${followUp ? `

The learner was asked a follow-up to clarify: "${followUp.question}"
<follow_up_answer>
${escapeTag(followUp.answer)}
</follow_up_answer>
Grade the original answer together with this clarification. Don't ask another follow-up.` : ""}`;
  return structured({ kind: "grade", tier: "fast", system: GRADE_SYSTEM, prompt: body, schema: GRADE_SCHEMA, maxTokens: 2000 });
});

// ── 4. Cross-course linking ──────────────────────────────────────────────────
const LINK_SCHEMA = obj({
  links: {
    type: "array",
    items: obj({
      from: str("Concept id"),
      to: str("Concept id"),
      type: { type: "string", enum: ["prereq", "related", "contrast", "application"] },
      why: str("One illuminating sentence"),
      confidence: { type: "number" },
    }),
  },
});

const LINK_SYSTEM = `You connect a learner's concepts into a knowledge map spanning all of their courses. You get NEW concepts and EXISTING ones. Propose relationships that involve at least one NEW concept.

Types:
- prereq: "from" must be understood before "to" (a genuine dependency).
- related: the same underlying idea in different contexts, or one is an instance of the other.
- contrast: easily confused; worth telling apart.
- application: one is used to accomplish or implement the other.

Match on meaning, never on shared words alone (a C "pointer" and a UI mouse "pointer" are unrelated).
why: one sentence that would genuinely help the learner see the connection.
confidence: 0–1, how sure you are the relation is real and useful. Omit anything below 0.4.
Prefer a few high-value links to many weak ones: at most 2 per new concept, and none if nothing meaningful exists.`;

ipcMain.handle("ai:link", async (_e, { fresh, existing }) => {
  const fmt = (c) => `${c.id} | ${c.course} | ${c.name}: ${c.summary}`;
  // The existing list comes first and is cached: it's the same for every
  // chapter of a book being imported.
  const prompt = [
    { type: "text", text: `EXISTING concepts:\n${existing.map(fmt).join("\n") || "(none)"}`, cache_control: { type: "ephemeral" } },
    { type: "text", text: `NEW concepts:\n${fresh.map(fmt).join("\n")}` },
  ];
  return structured({ kind: "link", tier: "deep", system: LINK_SYSTEM, prompt, schema: LINK_SCHEMA, maxTokens: 8000 });
});

// ── 4b. Notes ────────────────────────────────────────────────────────────────
const NOTES_SCHEMA = obj({
  notes: {
    type: "array",
    items: obj({
      note_id: str(),
      outcome: { type: "string", enum: ["keep", "skip"] },
      reason: str("For skip: one short sentence on why. For keep: empty"),
      concepts: {
        type: "array",
        items: obj({
          key: str("Short id within this note, e.g. c1"),
          name: str("Short noun phrase a practitioner would use"),
          summary: str("1–3 sentences stating the idea precisely and correctly"),
          kind: { type: "string", enum: ["definition", "mechanism", "distinction", "procedure", "principle", "fact"] },
          importance: { type: "string", enum: ["core", "supporting", "detail"] },
          area: str("The broad field, like a university course: 'Web development', 'Security', 'Databases'"),
          topic: str("The subject within the area, the size of a chapter: 'Authentication', 'REST APIs', 'Indexes'"),
          filled_in: { type: "boolean", description: "True if the summary adds facts the note didn't state" },
          corrected: str("If the note is wrong or misleading, what was wrong; otherwise empty"),
          same_as: str("Id of a known concept that already covers this SAME idea, or empty"),
          related: {
            type: "array",
            items: obj({
              id: str("Known concept id"),
              type: { type: "string", enum: ["related", "contrast", "application"] },
              why: str("One sentence that helps the learner see the connection"),
            }),
          },
        }),
      },
    }),
  },
});

// What an area is, for filing notes and for regrouping them.
const BROAD_AREAS = `An area is a broad field, the size of a whole subject or a university course: "Web development", "Security", "Databases", "Networking", "Operating systems", "Programming languages", "Software engineering", "Machine learning". A handful of areas should hold everything the learner writes down, so think wide: authentication and OAuth belong in "Security", REST APIs and HTTP caching in "Web development", Git and testing in "Software engineering". Never name an area after one tool, library or technique (that's a topic), and never use a catch-all ("Notes", "General", "Misc").`;

const NOTES_SYSTEM = `You turn a learner's own notes (jotted while building projects, reading documentation or working) into ideas worth keeping in long-term memory, and you match them against what the learner already studies.

For each note, decide:
- keep: it states, or clearly points to, knowledge a practitioner benefits from knowing without looking it up: how something works, why it works that way, a gotcha, a rule, a technique, a distinction.
- skip: to-dos and reminders, project-specific facts that won't matter elsewhere (file paths, variable or server names, dates), personal or administrative text, anything containing credentials, keys, tokens or passwords (never copy a secret into your output), and notes too vague to recover any definite idea. Give a short reason.
If a note has force="true", keep it and extract the best idea you can.

For a kept note, extract its concepts: usually one; split only when the note holds genuinely separate ideas (at most 3).
- summary: state the idea precisely and correctly, faithful to the note. If the note is terse, complete it with well-established facts so it stands on its own, and set filled_in to true. If the note is wrong or misleading, write the correct idea and say what was wrong in corrected.
- importance: core = broadly useful fundamentals; supporting = useful specifics; detail = narrow facts.
- area: ${BROAD_AREAS} Reuse an existing area whenever the idea fits it, even loosely, unless that area is itself a single tool or technique; start a new one only for a genuinely different field. The note's context is a hint; a project name is rarely a good area.
- topic: the subject within the area, the size of a chapter ("Authentication", "REST APIs", "Indexes", "Git"). Reuse one of that area's topics when it fits, so each topic collects several ideas.
- same_as: if a known concept already covers the SAME idea (not merely a related one), give its id. The learner already studies it, so the note adds nothing new and is left out. Unless the note has force="true": then leave same_as empty.
- related: up to 2 known concepts that are genuinely connected (not the same_as one), each with a sentence on why.
If a note repeats an idea from an earlier note in this batch, skip it with the reason "Same idea as another note".
Match on meaning, never on shared words alone.`;

ipcMain.handle("ai:notes", async (_e, { notes, areas = [], known = [] }) => {
  const knownList = known.map((k) => `${k.id} | ${k.name} | ${k.course}${k.summary ? ` | ${k.summary}` : ""}`).join("\n");
  const noteList = notes.map((n) => `<note id="${n.id}" force="${n.force ? "true" : "false"}"${n.context ? ` context="${String(n.context).replace(/"/g, "'")}"` : ""}>
${escapeTag(n.text)}
</note>`).join("\n");
  const areaList = areas.map((a) => `${a.name}${a.topics?.length ? `: ${a.topics.join(", ")}` : ""}`).join("\n");
  // Areas and known concepts are the same for every batch of a run: cached.
  const prompt = [
    { type: "text", cache_control: { type: "ephemeral" }, text: `<existing_areas>
area: its topics
${areaList || "(none yet)"}
</existing_areas>

<known_concepts>
id | name | course | summary (summaries only for the likeliest matches)
${knownList || "(none yet)"}
</known_concepts>` },
    { type: "text", text: noteList },
  ];
  return structured({ kind: "notes", tier: "deep", system: NOTES_SYSTEM, prompt, schema: NOTES_SCHEMA, maxTokens: 16000 });
});

// ── 4c. Regrouping note areas ────────────────────────────────────────────────
const AREAS_SCHEMA = obj({
  topics: {
    type: "array",
    items: obj({
      id: str("The topic's id"),
      area: str("The broad area it belongs in"),
      topic: str("Its name in that area"),
    }),
  },
});

const AREAS_SYSTEM = `You organize the areas a learner's notes are filed under. Each area is a course of its own, and its topics are the chapters. Narrow areas (one per tool or technique) scatter the notes, so put every topic in a broad area.

${BROAD_AREAS}

For each topic, by id:
- area: the broad area it belongs in. Keep an existing area's name when it is already broad; otherwise name the broad field it's part of. Group as much as you can: a few areas holding several topics each, not one each.
- topic: its name in that area, the size of a chapter. When its old area was narrow (one tool or technique) and is joining a broader one, the old area's name is usually the right topic, so "Git › Branching" and "Git › Rebasing" become one topic, "Git". Otherwise keep the topic's name, unless another topic in the same new area is the same subject: then use that one's name, and the two merge.
Return every topic exactly once.`;

ipcMain.handle("ai:areas", async (_e, { areas }) => {
  const list = areas.map((a) => `${a.name}\n${a.topics.map((t) => `  ${t.id} | ${t.name} | ${t.concepts.join("; ")}`).join("\n")}`).join("\n");
  const prompt = `<areas>
area
  topic id | topic | some of its concepts
${escapeTag(list)}
</areas>`;
  return structured({ kind: "areas", tier: "deep", system: AREAS_SYSTEM, prompt, schema: AREAS_SCHEMA, maxTokens: 4000 });
});

// ── 5. Teach-back ────────────────────────────────────────────────────────────
const TEACH_SCHEMA = obj({
  concepts: {
    type: "array",
    items: obj({
      id: str(),
      status: { type: "string", enum: ["covered", "partial", "missing", "wrong"] },
      note: str("What's missing or wrong, briefly; empty if covered"),
    }),
  },
  errors: strList("Clear factual errors in the explanation"),
  summary: str("2–3 sentences: the strongest part and the most important gap"),
});

const TEACH_SYSTEM = `The learner is explaining a topic from memory, as if teaching it to someone. Evaluate their explanation against the concepts listed.

For every concept give a status:
- covered: its essential points are stated correctly
- partial: touched on, but an essential point is missing or vague
- missing: not addressed
- wrong: states something incorrect about it
Grade meaning, not wording. Don't penalize informal style, order, or brevity when the ideas are right. Only list errors that are clearly wrong, not simplifications.`;

ipcMain.handle("ai:teachback", async (_e, { title, concepts, text }) => {
  const list = concepts.map((c) => `<concept id="${c.id}">
${c.name}
${c.points.map((p) => `- ${p}`).join("\n")}
</concept>`).join("\n");
  const prompt = `Topic: ${title}

${list}

<answer>
${escapeTag(text)}
</answer>`;
  return structured({ kind: "teachback", tier: "deep", system: TEACH_SYSTEM, prompt, schema: TEACH_SCHEMA, maxTokens: 4000 });
});

// ── 6. Go deeper: an interviewer's follow-ups ────────────────────────────────
// After you answer, Claude asks "why?" and "what if?" one level deeper each
// time until an answer breaks; the gap it finds can become a note.
const PROBE_SCHEMA = obj({
  last_verdict: { type: "string", enum: ["none", "correct", "partial", "incorrect"], description: "Grade of the learner's latest follow-up answer; none if there isn't one yet" },
  last_feedback: str("1–2 sentences on the latest follow-up answer: what was missing or wrong and the correct idea. Empty if none or fully correct"),
  next_question: str("The next follow-up question, or empty when stopping"),
  gap: str("When the latest answer missed or got something wrong: the idea they were missing, written as a standalone fact worth remembering (1–3 sentences, no reference to this conversation). Otherwise empty"),
});

const PROBE_SYSTEM = `You are a sharp technical interviewer testing how deep a learner's understanding of one concept goes. They have just answered a review question about it. Ask follow-up questions, one at a time, each one level deeper than the last: why it works, what happens if something changes, an edge case, what it's built on underneath, how it fails, how it relates to its foundations, a common mistake.

Each follow-up:
- asks exactly one thing, answerable from understanding in 1–3 sentences or a few lines of code;
- stays on this concept and the ideas directly underneath it;
- never asks for trivia, exact numbers, names, history or anything you'd look up;
- doesn't repeat or rephrase an earlier question, and doesn't contain its answer.

Grading the latest follow-up answer: grade meaning, not wording; informal language is fine. "I don't know" is incorrect.
- correct: ask the next, deeper question (unless told this is the last).
- partial or incorrect: stop. next_question is empty; last_feedback says what was missing and gives the correct idea; gap states that idea as a fact to remember.
No praise or filler.`;

ipcMain.handle("ai:probe", async (_e, { concept, question, modelAnswer, answer, turns = [], last = false }) => {
  const history = turns.map((t, i) => `<follow_up n="${i + 1}">
question: ${t.question}
<answer>
${escapeTag(t.answer)}
</answer>
</follow_up>`).join("\n");
  const prompt = `Concept: ${concept.name}
${concept.summary ? `Summary: ${concept.summary}\n` : ""}${concept.excerpt ? `Source: ${concept.excerpt}\n` : ""}
Review question: ${question}
Model answer: ${modelAnswer}
<answer>
${escapeTag(answer)}
</answer>
${history ? `\n${history}\n` : ""}
${turns.length ? `Grade follow-up ${turns.length}.${last ? " This was the last one: grade it, and leave next_question empty." : ""}` : "Ask the first follow-up (last_verdict is none)."}`;
  return structured({ kind: "probe", tier: "fast", system: PROBE_SYSTEM, prompt, schema: PROBE_SCHEMA, maxTokens: 1500 });
});

// ── 7. Fresh versions of a question ──────────────────────────────────────────
// An apply or distinguish question you've answered before comes back with a
// new example, so you can't answer from memory of the old one.
const VARIANT_SCHEMA = obj({
  shape: str(), prompt: str(), model_answer: str(), accept: strList(), required_points: strList(), misconceptions: strList(), hint: str(), diagram: DIAGRAM_FIELD,
});

const VARIANT_SYSTEM = `You write a fresh version of a review question the learner has answered before, so they practise the idea rather than recall the old example.

Keep: the concept tested, the question type, the skill it takes, the difficulty, and the form of the answer (its shape).
Change: the surface — a new scenario, new values, a new code snippet, a different pair of things to tell apart. It must not be answerable by remembering the old answer. If the original has a diagram, draw a new one of the same kind with new values (a new circuit or new inputs, new memory contents): never reuse the old picture.
The answer must be determinable and correct: work it out carefully before writing the model answer. For code, trace it exactly; for a circuit, evaluate it. Prefer a simpler example you are certain about to a clever one you aren't.
Write the same number of key points as the original, in its style; accept lists every acceptable exact form when the answer is a term, value, output or line of code (as the original's does); and the misconceptions that fit the new version.

${SUBJECT}
If the original is about the book's own example, the fresh version is the general question on a new example.

${ONE_TARGET}

${DIAGRAMS}

${QUALITY_BAR}`;

ipcMain.handle("ai:variant", async (_e, { concept, question }) => {
  const prompt = `Concept: ${concept.name}
${concept.summary ? `Summary: ${concept.summary}\n` : ""}${concept.excerpt ? `Source: ${concept.excerpt}\n` : ""}
Question type: ${question.ability}${question.level ? ` (step ${question.level} of its ladder)` : ""}
${question.shape ? `Answer shape: ${question.shape}\n` : ""}Question: ${question.prompt}
${question.diagram ? `Diagram: ${question.diagram}\n` : ""}Model answer: ${question.answer}
${question.accept?.length ? `Accepted answers: ${question.accept.join(" | ")}\n` : ""}Key points: ${(question.points || []).join(" | ")}
${question.misconceptions?.length ? `Misconceptions: ${question.misconceptions.join(" | ")}\n` : ""}
Write the fresh version.`;
  return structured({ kind: "variant", tier: "fast", system: VARIANT_SYSTEM, prompt, schema: VARIANT_SCHEMA, maxTokens: 6000 });
});

// ── 8. Tests for a code question ─────────────────────────────────────────────
const TESTS_SCHEMA = obj({
  tests: str("Test code appended after the learner's answer in the same file"),
  notes: str("One sentence on what the tests check and what the answer must define (names, signatures)"),
});

const TESTS_SYSTEM = `You write automated tests for a "write this code from memory" question. The learner's answer and your tests are put in one file, in that order, and run; the tests pass when the program exits with status 0.

- Python: plain assert statements at top level. No test frameworks, no input().
- C: #include what you need (e.g. <assert.h>, <string.h>) and write int main(void) that uses assert and returns 0. The answer must not contain main.
- JavaScript (CommonJS): const assert = require("node:assert"); then assert calls at top level.

Test the behaviour the question asks for, through the names and signatures the question (or its model answer) defines: normal cases, edge cases (empty input, zero, one element, boundaries) and the mistakes people make. Never test incidental details the question doesn't require (exact printed output, helper names). Keep it under about 40 lines, and make sure the model answer passes.`;

ipcMain.handle("ai:tests", async (_e, { lang, prompt, answer }) => {
  const body = `Language: ${lang}
Question:
${prompt}

Model answer:
${answer}`;
  return structured({ kind: "tests", tier: "deep", system: TESTS_SYSTEM, prompt: body, schema: TESTS_SCHEMA, maxTokens: 3000 });
});

ipcMain.handle("code:run", (_e, payload) => codeRunner.runTests({
  lang: String(payload?.lang || ""), solution: String(payload?.solution || ""), tests: String(payload?.tests || ""),
}));

// ── Batches ─────────────────────────────────────────────────────────────────
// Whole-book imports can send question writing and review through the
// Message Batches API: same models and prompts at half the price, results
// usually within the hour. Any request a batch can't handle is redone live by
// the caller, so quality never depends on the batch.
const BATCHABLE = { items: SPEC.items, critique: SPEC.critique };

ipcMain.handle("ai:batch-create", async (_e, { kind, requests }) => {
  const client = getClient();
  if (!client) return { ok: false, error: "no-key" };
  const spec = BATCHABLE[kind];
  if (!spec || !requests?.length) return { ok: false, error: "Nothing to send." };
  try {
    const batch = await client.messages.batches.create({
      requests: requests.map((r) => { const s = spec(r.payload); return { custom_id: r.id, params: buildParams(s, MODELS[s.tier][0]) }; }),
    });
    return { ok: true, batchId: batch.id };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
});

ipcMain.handle("ai:batch-status", async (_e, batchId) => {
  const client = getClient();
  if (!client) return { ok: false, error: "no-key" };
  try {
    const b = await client.messages.batches.retrieve(batchId);
    return { ok: true, status: b.processing_status, counts: b.request_counts };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
});

ipcMain.handle("ai:batch-results", async (_e, batchId) => {
  const client = getClient();
  if (!client) return { ok: false, error: "no-key" };
  try {
    const results = {};
    // A batch's results can be read again after a restart; its usage is only counted once.
    const dir = app.getPath("userData");
    const counted = aiUsage.readAll(dir).some(e => e.batchId === batchId);
    for await (const r of await client.messages.batches.results(batchId)) {
      const ok = r.result.type === "succeeded";
      if (ok && !counted) {
        const kind = r.custom_id.startsWith("w") ? "items" : r.custom_id.startsWith("c") ? "critique" : "other";
        aiUsage.record(dir, { kind, model: r.result.message.model, usage: r.result.message.usage, batch: true, batchId });
      }
      results[r.custom_id] = ok
        ? readMessage(r.result.message)
        : { ok: false, error: r.result.type === "errored" ? (r.result.error?.error?.message || "Request failed.") : `Request ${r.result.type}.` };
    }
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
});

ipcMain.handle("ai:status", () => ({ hasKey: Boolean(readApiKey()) }));

// What the AI has cost lately, by activity (see ai-usage.cjs). Old entries are dropped as it's read.
ipcMain.handle("ai:usage", (_e, { days = 30 } = {}) => {
  const dir = app.getPath("userData");
  aiUsage.prune(dir);
  return { ok: true, ...aiUsage.summarize(aiUsage.readAll(dir), { days }) };
});

// ── PDF import ───────────────────────────────────────────────────────────────
const pdfError = (err) => ({ ok: false, error: /password/i.test(err?.message) ? "That PDF is password-protected." : "Couldn't read that PDF." });
ipcMain.handle("pdf:outline", async (_e, data) => {
  try { return { ok: true, ...(await pdf.outline(data)) }; } catch (err) { return pdfError(err); }
});
ipcMain.handle("pdf:text", async (_e, { data, from, to }) => {
  try { return { ok: true, ...(await pdf.pageText(data, from, to)) }; } catch (err) { return pdfError(err); }
});

// ── Whole books ───────────────────────────────────────────────────────────────
// A book being imported is copied into the app's data folder so the import can
// carry on after a restart. It's deleted when you dismiss the finished import.
// A pasted text being imported (a guide sorted into courses) is kept the same
// way, as a .txt file; its chapters are character ranges instead of pages.
const booksDir = () => path.join(app.getPath("userData"), "books");
const bookFile = (id) => path.join(booksDir(), `${String(id).replace(/[^\w-]/g, "")}.pdf`);
const textFile = (id) => path.join(booksDir(), `${String(id).replace(/[^\w-]/g, "")}.txt`);

ipcMain.handle("book:save-text", (_e, text) => {
  try {
    const bookId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    fs.mkdirSync(booksDir(), { recursive: true });
    fs.writeFileSync(textFile(bookId), String(text ?? ""), "utf8");
    return { ok: true, bookId };
  } catch (err) { return { ok: false, error: err?.message || "Couldn't save the text." }; }
});

ipcMain.handle("book:save", async (_e, data) => {
  try {
    const info = await pdf.outline(data);
    const bookId = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    fs.mkdirSync(booksDir(), { recursive: true });
    fs.writeFileSync(bookFile(bookId), Buffer.from(data));
    return { ok: true, bookId, ...info };
  } catch (err) { return pdfError(err); }
});
ipcMain.handle("book:text", async (_e, { bookId, from, to }) => {
  try {
    if (fs.existsSync(textFile(bookId))) {
      const text = fs.readFileSync(textFile(bookId), "utf8");
      return { ok: true, text: text.slice(Math.max(0, Number(from) || 0), Number(to) || text.length), from, to };
    }
    const file = bookFile(bookId);
    if (!fs.existsSync(file)) return { ok: false, error: "The book's PDF is no longer available. Import the book again." };
    return { ok: true, ...(await pdf.pageText(fs.readFileSync(file), from, to)) };
  } catch (err) { return pdfError(err); }
});
ipcMain.handle("book:has", (_e, bookId) => fs.existsSync(bookFile(bookId)) || fs.existsSync(textFile(bookId)));
ipcMain.handle("book:delete", (_e, bookId) => {
  try { fs.rmSync(bookFile(bookId), { force: true }); fs.rmSync(textFile(bookId), { force: true }); } catch { /* already gone */ }
  return { ok: true };
});

// ── Window ────────────────────────────────────────────────────────────────────
// No frame: the app draws its own title bar (the Tenax mark and the search
// box) and the system's window buttons are drawn over its right end
// (titleBarOverlay), so snapping and the rest still behave natively. On a
// Mac the traffic lights sit inside the bar at the left. The buttons' colours
// follow the app's theme (window:chrome).
const TITLEBAR_H = 48;
const IS_MAC = process.platform === "darwin";
const THEMES = { dark: { color: "#141416", symbolColor: "#A1A1AA" }, light: { color: "#FFFFFF", symbolColor: "#52525B" } }; // the title bar (--bg)

// Match the app's theme so the window doesn't flash the wrong color on launch.
function themeColors() {
  let theme = "dark";
  try { theme = library?.getMeta("settings")?.theme ?? store.get(LEGACY_KEY)?.settings?.theme ?? "dark"; } catch { /* the default */ }
  const dark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
  return THEMES[dark ? "dark" : "light"];
}
const windowBackground = () => themeColors().color;

const HEX = /^#[0-9a-f]{6}$/i;
ipcMain.handle("window:chrome", (e, colors) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const color = String(colors?.color || ""), symbolColor = String(colors?.symbolColor || "");
  if (!win || !HEX.test(color) || !HEX.test(symbolColor)) return false;
  win.setBackgroundColor(color);
  if (!IS_MAC && typeof win.setTitleBarOverlay === "function") win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_H });
  return true;
});

function createWindow() {
  const iconPath = path.join(__dirname, "build", process.platform === "win32" ? "icon.ico" : "icon.png");
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: "Tenax",
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    ...(IS_MAC
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { ...themeColors(), height: TITLEBAR_H } }),
    ...(fs.existsSync(iconPath) && { icon: iconPath }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  // The window only ever shows the app: a file dropped outside a drop zone, or
  // a stray link, must not navigate it away.
  // Leaving the window is the moment to hand this computer's changes over.
  for (const ev of ["blur", "minimize", "hide"]) win.on(ev, flushPush);
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  // Open external links in the browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  } else {
    win.loadURL("http://localhost:5173");
  }
}

// Lets Windows group the taskbar button under Tenax with its own icon.
if (process.platform === "win32") app.setAppUserModelId("app.tenax.desktop");
app.whenReady().then(() => {
  if (!FIRST_COPY) return;
  createWindow();
  autoBackup();
  setInterval(() => autoBackup(), 6 * 3600e3).unref?.();
  startUpdates();
  powerMonitor?.on?.("suspend", flushPush);
  powerMonitor?.on?.("lock-screen", flushPush);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

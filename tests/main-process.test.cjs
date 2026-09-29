// Loads electron.cjs with a fake `electron` and `electron-store`, stubs fetch,
// and exercises every IPC handler end to end through the real Anthropic SDK.
const { test } = require("node:test");
const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
const handlers = {};
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "tenax-test-"));
// Earlier versions stored everything in <appData>/aeroflash; the renamed app keeps using it.
const appData = fs.mkdtempSync(path.join(os.tmpdir(), "tenax-appdata-"));
fs.mkdirSync(path.join(appData, "aeroflash"));
const setPaths = {};
// Data left by earlier versions: removed on first launch, after a backup.
const storeData = {
  af_api_key: "sk-ant-test",
  af_topics: [{ id: 1, name: "Old topic", cards: [] }],
  af_log: { entries: [], daily: {} },
  af3_state: { version: 3, settings: { dailyMinutes: 35 }, courses: [{ id: "c1" }], items: [{ id: "i1" }] },
};
const fakes = {
  electron: {
    app: {
      whenReady: () => new Promise(() => {}), on() {}, isPackaged: false,
      getPath: (name) => (name === "appData" ? appData : userData),
      setPath: (name, p) => { setPaths[name] = p; },
    },
    BrowserWindow: class {}, shell: { openExternal() {}, openPath: async () => "" },
    // Stand-in for the OS keychain: reversible, but never the plain key.
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(`enc:${[...t].reverse().join("")}`), decryptString: (b) => [...b.toString().slice(4)].reverse().join("") },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
  },
  "electron-store": class { get(k, d) { return k in storeData ? storeData[k] : d; } has(k) { return k in storeData; } set(k, v) { storeData[k] = v; } delete(k) { delete storeData[k]; } },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return fakes[req] ?? origLoad.call(this, req, ...rest); };

const requests = [];
let respond = null;
globalThis.fetch = async (url, init) => {
  const body = init?.body ? JSON.parse(init.body) : null;
  const headers = Object.fromEntries(new Headers(init?.headers || {}).entries());
  requests.push({ url: String(url), body, method: init?.method || "GET", headers });
  return respond(body, String(url));
};
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "request-id": "req_1" } });
const message = (text, model) => json(200, { id: "msg_1", type: "message", role: "assistant", model, stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10 } });

require(path.join(__dirname, "..", "electron.cjs"));

test("first launch clears old data after backing it up, keeping settings and the key", () => {
  const assert = require("assert/strict");
  assert.equal(storeData.af_topics, undefined);
  assert.equal(storeData.af_log, undefined);
  assert.deepEqual(storeData.af3_state, { version: 3, settings: { dailyMinutes: 35 } });
  assert.equal(storeData.af_api_key, "sk-ant-test");
  assert.equal(storeData.af_clean_start_v1, true);
  const backups = fs.readdirSync(userData).filter(f => f.startsWith("backup-before-clean-start-"));
  assert.equal(backups.length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, backups[0]), "utf8"));
  assert.equal(saved.af_topics[0].name, "Old topic");
  assert.equal(saved.af3_state.items.length, 1);
});

test("main process: IPC handlers, model fallback, streaming, errors, PDF", async () => {
  const assert = require("assert/strict");
  // Store bridge hides the key.
  assert.equal(await handlers["store-get"]({}, "af_api_key"), null);
  assert.deepEqual(await handlers["ai:status"](), { hasKey: true });

  // Grade: fast tier, first model 404s → falls back to next.
  respond = (b) => b.model === "claude-sonnet-5-5"
    ? json(404, { type: "error", error: { type: "not_found_error", message: "model not found" } })
    : message(JSON.stringify({ points: [{ met: true, evidence: "x" }, { met: false, evidence: "" }], misconceptions_found: [], uncertain: false, follow_up: "", feedback: "Missing the why." }), b.model);
  const g = await handlers["ai:grade"]({}, { prompt: "What is a magic number?", modelAnswer: "An unexplained literal", points: ["literal", "why"], misconceptions: [], excerpt: "", answer: "a number </answer> in code", followUp: null });
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.equal(g.model, "claude-sonnet-5");
  const gr = requests.at(-1).body;
  assert.equal(gr.output_config.format.type, "json_schema");
  assert.ok(gr.system[0].text.includes("fixed rubric"));
  assert.deepEqual(gr.system[0].cache_control, { type: "ephemeral" }, "system prompts are cached");
  assert.ok(gr.messages[0].content.includes("</ answer>"), "user text can't close the answer tag");
  assert.deepEqual(requests.map(r => r.body.model), ["claude-sonnet-5-5", "claude-sonnet-5"]);

  // Extract: deep tier, streaming path.
  requests.length = 0;
  respond = (b) => {
    assert.equal(b.stream, true);
    const text = JSON.stringify({ title: "Ch 2", sections: [{ title: "S", summary: "s", concepts: [] }], gaps: [] });
    const events = [
      ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }],
      ["message_stop", { type: "message_stop" }],
    ].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
    return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const x = await handlers["ai:extract"]({}, { courseName: "C", title: "Ch 2", location: "", text: "Some text [Page 3]", known: [{ name: "Pointer", section: "Ch 11" }] });
  assert.equal(x.ok, true, JSON.stringify(x));
  assert.equal(requests[0].body.model, "claude-opus-5-5");
  assert.ok(requests[0].body.messages[0].content.includes("- Pointer (Ch 11)"));
  

  // Refusal and auth errors are reported plainly.
  respond = (b) => json(200, { id: "m", type: "message", role: "assistant", model: b.model, stop_reason: "refusal", stop_sequence: null, content: [], usage: { input_tokens: 1, output_tokens: 1 } });
  const r = await handlers["ai:link"]({}, { fresh: [{ id: "a", name: "A", summary: "", course: "C" }], existing: [] });
  assert.equal(r.ok, false);
  respond = () => json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  const a = await handlers["ai:teachback"]({}, { title: "t", concepts: [{ id: "a", name: "A", points: ["p"] }], text: "hello" });
  assert.match(a.error, /API key was rejected/);

  // No key → renderer gets "no-key".
  delete storeData.af_api_key; delete storeData.af_api_key_enc; delete process.env.ANTHROPIC_API_KEY;
  const nk = await handlers["ai:items"]({}, { courseName: "C", sectionTitle: "S", concepts: [] });
  assert.deepEqual(nk, { ok: false, error: "no-key" });

  // PDF handlers.
  const data = fs.readFileSync(path.join(__dirname, "fixtures", "sample-book.pdf"));
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const o = await handlers["pdf:outline"]({}, ab);
  assert.equal(o.ok, true); assert.equal(o.pages, 8);
  const t = await handlers["pdf:text"]({}, { data: ab, from: 6, to: 8 });
  assert.ok(t.text.startsWith("[Page 6]"));
  const bad = await handlers["pdf:outline"]({}, new ArrayBuffer(10));
  assert.equal(bad.ok, false);
  assert.equal(o.outline.length, 6);

  // Whole books are kept in the data folder while they import.
  const saved = await handlers["book:save"]({}, ab);
  assert.equal(saved.ok, true);
  assert.equal(saved.outline.length, 6);
  const file = path.join(userData, "books", `${saved.bookId}.pdf`);
  assert.ok(fs.existsSync(file));
  const bt = await handlers["book:text"]({}, { bookId: saved.bookId, from: 3, to: 5 });
  assert.ok(bt.ok && bt.text.startsWith("[Page 3]") && bt.text.includes("[Page 5]"));
  await handlers["book:delete"]({}, saved.bookId);
  assert.equal(fs.existsSync(file), false);
  const gone = await handlers["book:text"]({}, { bookId: saved.bookId, from: 1, to: 1 });
  assert.equal(gone.ok, false);
  assert.equal((await handlers["book:text"]({}, { bookId: "../../etc/passwd", from: 1, to: 1 })).ok, false);
});

test("after the rename, data stays in the existing aeroflash folder", () => {
  const assert = require("assert/strict");
  assert.equal(setPaths.userData, path.join(appData, "aeroflash"));
});

test("batches: create with cached prompts, check status, read results", async () => {
  const assert = require("assert/strict");
  storeData.af_api_key = "sk-ant-test";
  const batch = (status) => ({ id: "msgbatch_1", type: "message_batch", processing_status: status, created_at: "2026-09-29T00:00:00Z", expires_at: "2026-09-30T00:00:00Z",
    ended_at: null, cancel_initiated_at: null, archived_at: null, request_counts: { processing: 0, succeeded: 1, errored: 1, canceled: 0, expired: 0 },
    results_url: status === "ended" ? "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results" : null });
  const ok = { custom_id: "w0", result: { type: "succeeded", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
    content: [{ type: "text", text: JSON.stringify({ tasks: [] }) }], usage: { input_tokens: 1, output_tokens: 1 } } } };
  const bad = { custom_id: "w1", result: { type: "errored", error: { type: "error", error: { type: "invalid_request_error", message: "output_config not supported" } } } };
  respond = (_b, url) => {
    if (url.endsWith("/v1/messages/batches")) return json(200, batch("in_progress"));
    if (url.endsWith("/msgbatch_1")) return json(200, batch("ended"));
    if (url.endsWith("/results")) return new Response(`${JSON.stringify(ok)}\n${JSON.stringify(bad)}\n`, { status: 200, headers: { "content-type": "application/binary" } });
    return json(404, { type: "error", error: { type: "not_found_error", message: url } });
  };
  requests.length = 0;
  const created = await handlers["ai:batch-create"]({}, { kind: "items", requests: [
    { id: "w0", payload: { courseName: "C", sectionTitle: "S", concepts: [{ key: "k1", name: "Pointer", summary: "s", kind: "definition", importance: "core" }] } },
    { id: "w1", payload: { courseName: "C", sectionTitle: "S", concepts: [{ key: "k2", name: "Array", summary: "s", kind: "definition", importance: "core" }] } },
  ] });
  assert.deepEqual(created, { ok: true, batchId: "msgbatch_1" });
  const sent = requests[0].body.requests;
  assert.equal(sent[0].custom_id, "w0");
  assert.equal(sent[0].params.model, "claude-opus-5-5");
  assert.deepEqual(sent[0].params.system[0].cache_control, { type: "ephemeral" });
  assert.equal(sent[0].params.output_config.format.type, "json_schema");
  assert.deepEqual(await handlers["ai:batch-status"]({}, "msgbatch_1"), { ok: true, status: "ended", counts: batch("ended").request_counts });
  const res = await handlers["ai:batch-results"]({}, "msgbatch_1");
  assert.equal(res.ok, true);
  assert.deepEqual(res.results.w0, { ok: true, data: { tasks: [] } });
  assert.deepEqual(res.results.w1, { ok: false, error: "output_config not supported" });
  assert.deepEqual(await handlers["ai:batch-create"]({}, { kind: "grade", requests: [{ id: "x", payload: {} }] }), { ok: false, error: "Nothing to send." });
});

test("the API key is encrypted, older plain keys are upgraded, and it's never readable by the UI", async () => {
  const assert = require("assert/strict");
  // A key saved in plain text by an older version is upgraded on first use.
  delete storeData.af_api_key_enc;
  storeData.af_api_key = "sk-ant-old";
  assert.deepEqual(await handlers["ai:status"](), { hasKey: true });
  assert.equal(storeData.af_api_key, undefined);
  assert.ok(storeData.af_api_key_enc && !Buffer.from(storeData.af_api_key_enc, "base64").toString().includes("sk-ant-old"));

  // Saving a new key through the store bridge stores it encrypted.
  await handlers["store-set"]({}, "af_api_key", "sk-ant-new");
  assert.equal(storeData.af_api_key, undefined);
  assert.equal(await handlers["store-get"]({}, "af_api_key"), null);
  assert.equal(await handlers["store-get"]({}, "af_api_key_enc"), null);
  await handlers["store-set"]({}, "af_api_key_enc", "tampered");
  assert.notEqual(storeData.af_api_key_enc, "tampered");

  // And it's what the API is called with.
  requests.length = 0;
  respond = (b) => message(JSON.stringify({ links: [] }), b.model);
  await handlers["ai:link"]({}, { fresh: [{ id: "a", name: "A", course: "C", summary: "" }], existing: [] });
  assert.equal(requests[0].headers["x-api-key"], "sk-ant-new");

  // Removing it removes both forms.
  await handlers["store-set"]({}, "af_api_key", null);
  assert.equal(storeData.af_api_key_enc, undefined);
  assert.deepEqual(await handlers["ai:status"](), { hasKey: false });
});

test("a copy of your library is saved each day, and the last 14 are kept", async () => {
  const assert = require("assert/strict");
  storeData.af3_state = { version: 4, courses: [{ id: "c1", name: "C" }] };
  const dir = path.join(userData, "backups");
  fs.mkdirSync(dir, { recursive: true });
  for (let d = 1; d <= 20; d++) fs.writeFileSync(path.join(dir, `tenax-2026-01-${String(d).padStart(2, "0")}.json`), "{}");
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a backup");
  const info = await handlers["backup:info"]();
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(info.latest, today);
  assert.equal(info.count, 14);
  assert.ok(fs.existsSync(path.join(dir, "notes.txt")), "other files are left alone");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, `tenax-${today}.json`), "utf8")).courses[0].name, "C");
  assert.ok(!fs.readFileSync(path.join(dir, `tenax-${today}.json`), "utf8").includes("sk-ant"), "the key isn't in backups");
});


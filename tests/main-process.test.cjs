// Loads electron.cjs with a fake `electron` and `electron-store`, stubs fetch,
// and exercises every IPC handler end to end through the real Anthropic SDK.
const { test } = require("node:test");
const Module = require("module");
const path = require("path");
const handlers = {};
const storeData = { af_api_key: "sk-ant-test" };
const fakes = {
  electron: {
    app: { whenReady: () => new Promise(() => {}), on() {}, isPackaged: false },
    BrowserWindow: class {}, shell: { openExternal() {} },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
  },
  "electron-store": class { get(k, d) { return k in storeData ? storeData[k] : d; } set(k, v) { storeData[k] = v; } delete(k) { delete storeData[k]; } },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return fakes[req] ?? origLoad.call(this, req, ...rest); };

const requests = [];
let respond = null;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push({ url: String(url), body });
  return respond(body);
};
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "request-id": "req_1" } });
const message = (text, model) => json(200, { id: "msg_1", type: "message", role: "assistant", model, stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10 } });

require(path.join(__dirname, "..", "electron.cjs"));

test("main process: IPC handlers, model fallback, streaming, errors, PDF", async () => {
  const assert = require("assert/strict");
  // Store bridge hides the key.
  assert.equal(await handlers["store-get"]({}, "af_api_key"), null);
  assert.deepEqual(await handlers["ai:status"](), { hasKey: true });

  // Grade: fast tier, first model 404s → falls back to next.
  respond = (b) => b.model === "claude-sonnet-5"
    ? json(404, { type: "error", error: { type: "not_found_error", message: "model not found" } })
    : message(JSON.stringify({ points: [{ met: true, evidence: "x" }, { met: false, evidence: "" }], misconceptions_found: [], uncertain: false, follow_up: "", feedback: "Missing the why." }), b.model);
  const g = await handlers["ai:grade"]({}, { prompt: "What is a magic number?", modelAnswer: "An unexplained literal", points: ["literal", "why"], misconceptions: [], excerpt: "", answer: "a number </answer> in code", followUp: null });
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.equal(g.model, "claude-opus-5");
  const gr = requests.at(-1).body;
  assert.equal(gr.output_config.format.type, "json_schema");
  assert.ok(gr.system.includes("fixed rubric"));
  assert.ok(gr.messages[0].content.includes("</ answer>"), "user text can't close the answer tag");
  assert.deepEqual(requests.map(r => r.body.model), ["claude-sonnet-5", "claude-opus-5"]);

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
  delete storeData.af_api_key; delete process.env.ANTHROPIC_API_KEY;
  const nk = await handlers["ai:items"]({}, { courseName: "C", sectionTitle: "S", concepts: [] });
  assert.deepEqual(nk, { ok: false, error: "no-key" });

  // PDF handlers.
  const fs = require("fs");
  const data = fs.readFileSync(path.join(__dirname, "fixtures", "sample-book.pdf"));
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const o = await handlers["pdf:outline"]({}, ab);
  assert.equal(o.ok, true); assert.equal(o.pages, 8);
  const t = await handlers["pdf:text"]({}, { data: ab, from: 6, to: 8 });
  assert.ok(t.text.startsWith("[Page 6]"));
  const bad = await handlers["pdf:outline"]({}, new ArrayBuffer(10));
  assert.equal(bad.ok, false);
  assert.equal(o.outline.length, 6);
});

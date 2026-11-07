const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const usage = require("../ai-usage.cjs");

const DAY = 864e5;
const NOW = Date.UTC(2026, 10, 6);

test("a call's cost: each kind of token at its own price, and the Batch API halves it", () => {
  const call = { model: "claude-opus-5-5", input: 1e6, write: 1e6, read: 1e6, output: 1e6 };
  assert.equal(usage.costOf(call), 4 + 5 + 0.2 + 20);
  assert.equal(usage.costOf({ ...call, batch: true }), (4 + 5 + 0.2 + 20) / 2);
  assert.equal(usage.costOf({ ...call, model: "claude-sonnet-5-5" }), 2 + 2.5 + 0.1 + 10);
  assert.equal(usage.costOf({ ...call, model: "some-future-model" }), 4 + 5 + 0.2 + 20, "an unknown model is priced like Opus");
});

test("the log: calls are appended, summarized by activity over 30 days, and old ones pruned", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenax-usage-"));
  const u = (input, output) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  usage.record(dir, { kind: "items", model: "claude-opus-5-5", usage: u(1000, 10000), ts: NOW - DAY });
  usage.record(dir, { kind: "items", model: "claude-opus-5-5", usage: u(1000, 10000), batch: true, batchId: "b1", ts: NOW - DAY });
  usage.record(dir, { kind: "grade", model: "claude-sonnet-5-5", usage: u(1500, 300), ts: NOW - 2 * DAY });
  usage.record(dir, { kind: "items", model: "claude-opus-5-5", usage: u(1, 1), ts: NOW - 100 * DAY });
  const s = usage.summarize(usage.readAll(dir), { now: NOW });
  assert.equal(s.calls, 3, "only the last 30 days");
  assert.deepEqual(s.byActivity.map(a => [a.kind, a.calls]), [["items", 2], ["grade", 1]], "most expensive first");
  assert.ok(Math.abs(s.byActivity[0].cost - (0.204 + 0.102)) < 1e-9);
  assert.equal(usage.readAll(dir).find(e => e.batchId === "b1").batch, true);
  usage.prune(dir, NOW);
  assert.equal(usage.readAll(dir).length, 3, "entries over 90 days old are dropped");
  fs.rmSync(dir, { recursive: true, force: true });
});

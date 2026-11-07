// What the AI calls cost: every call's token counts are appended to a small
// log in the data folder (ai-usage.jsonl), and Settings shows the last 30
// days by activity. Costs are worked out from list prices (checked against
// platform.claude.com/docs/en/about-claude/pricing in November 2026); the
// Console's bill is the real figure, this is for seeing where it goes.

const fs = require("fs");
const path = require("path");

// Dollars per million tokens: base input, 5-minute cache write, cache read, output.
const PRICES = {
  "claude-opus-5-5":   { input: 4, write: 5, read: 0.2, output: 20 },
  "claude-opus-5":     { input: 5, write: 6.25, read: 0.5, output: 25 },
  "claude-sonnet-5-5": { input: 2, write: 2.5, read: 0.1, output: 10 },
  "claude-sonnet-5":   { input: 2, write: 2.5, read: 0.2, output: 10 },
};
const BATCH_DISCOUNT = 0.5; // the Batch API halves every token, cached ones included
const KEEP_DAYS = 90;
const FILE = "ai-usage.jsonl";

// What each call was for, as Settings names it.
const ACTIVITY = {
  extract: "Finding concepts",
  items: "Writing questions",
  critique: "Reviewing questions",
  rewrite: "Rewriting reported questions",
  grade: "Grading answers",
  variant: "Fresh versions",
  probe: "Go deeper",
  link: "Linking concepts",
  notes: "Processing notes",
  areas: "Organizing areas",
  teachback: "Teach back",
  tests: "Writing code tests",
};

/** One call's cost in dollars, from its usage counts. */
function costOf({ model, input = 0, write = 0, read = 0, output = 0, batch = false }) {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const dollars = (input * p.input + write * p.write + read * p.read + output * p.output) / 1e6;
  return batch ? dollars * BATCH_DISCOUNT : dollars;
}

/** A log entry from an API response's usage object. */
function entryFrom({ kind, model, usage, batch = false, batchId = null, ts = Date.now() }) {
  return {
    ts, kind: kind || "other", model: model || "", batch: Boolean(batch), ...(batchId ? { batchId } : {}),
    input: usage?.input_tokens || 0,
    write: usage?.cache_creation_input_tokens || 0,
    read: usage?.cache_read_input_tokens || 0,
    output: usage?.output_tokens || 0,
  };
}

/** Append one call to the log (never throws: a failed write only loses a line of bookkeeping). */
function record(dir, call) {
  try { fs.appendFileSync(path.join(dir, FILE), `${JSON.stringify(entryFrom(call))}\n`); } catch { /* best effort */ }
}

function readAll(dir) {
  try {
    return fs.readFileSync(path.join(dir, FILE), "utf8").split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** Drop entries older than KEEP_DAYS, so the log stays small. */
function prune(dir, now = Date.now()) {
  const keep = readAll(dir).filter(e => e.ts >= now - KEEP_DAYS * 864e5);
  try { fs.writeFileSync(path.join(dir, FILE), keep.map(e => `${JSON.stringify(e)}\n`).join("")); } catch { /* best effort */ }
}

/**
 * The last `days` days: { total, calls, byActivity: [{ kind, label, calls, cost, output }] }
 * (most expensive first), with what share of input came from the cache.
 */
function summarize(entries, { now = Date.now(), days = 30 } = {}) {
  const since = now - days * 864e5;
  const by = {};
  let total = 0, calls = 0, cached = 0, input = 0;
  for (const e of entries) {
    if (e.ts < since) continue;
    const cost = costOf(e);
    total += cost; calls++;
    cached += e.read; input += e.input + e.write + e.read;
    const b = (by[e.kind] ||= { kind: e.kind, label: ACTIVITY[e.kind] ?? "Other", calls: 0, cost: 0, output: 0 });
    b.calls++; b.cost += cost; b.output += e.output;
  }
  return {
    days, total, calls, cacheShare: input ? cached / input : 0,
    byActivity: Object.values(by).sort((a, b) => b.cost - a.cost),
  };
}

module.exports = { PRICES, ACTIVITY, costOf, entryFrom, record, readAll, prune, summarize };

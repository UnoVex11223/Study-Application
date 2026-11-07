// Diagrams for questions and lessons. Claude never draws: it describes a
// diagram as a small JSON spec, and Tenax checks it and draws it the same way
// every time (ui/Diagram.jsx turns the scene from drawDiagram into SVG), so
// pictures are legible, themed and never half-rendered. A logic circuit is
// also simulated, so a question's answer can be verified by code instead of
// trusted (checkDiagramAnswer).
//
// Kinds (written as JSON in a question's or lesson's "diagram" field):
//   circuit  { type, inputs: ["a","b"], gates: [{ id, op, in: [...] }], outputs: { out: "g1" },
//              values?: { a: 1, b: 0 }, ask?: "out" }
//            ops: AND OR NOT NAND NOR XOR XNOR BUF, and MUX (in: [a, b, sel]; sel=1 picks b).
//            values are input values to show; ask is the output the question asks about (shown "?").
//   memory   { type, direction?: "column" | "row", boxes: [{ id, label?, cells: ["5"], addr?, index? }],
//              arrows: [{ from, fromCell?, to, toCell? }] }
//            variables, arrays, structs and list nodes as boxes of cells; an arrow from a cell
//            (a pointer) to a box or to one of its cells.
//   bits     { type, bits: "1110001100001000", fields?: [{ from: 15, to: 13, label: "op" }] }
//            a binary word, most significant bit first, with labelled fields. "?" marks a bit to work out.
//   tree     { type, root: { label, children?: [node | null] } }
//            a binary tree keeps left and right apart: [null, node] is a right child only.
//
// Pure and unit-tested (tests/diagram.test.js).

export const DIAGRAM_KINDS = { circuit: "Logic circuit", memory: "Memory", bits: "Bits", tree: "Tree" };

const LIMIT = { inputs: 10, gates: 24, fanIn: 4, boxes: 12, cells: 48, cellsPerBox: 16, cellText: 14, bits: 32, nodes: 40, depth: 7, children: 4, label: 24 };
const GATE_OPS = ["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR", "BUF", "MUX"];
const NAME = /^[A-Za-z_][\w[\].']{0,15}$/;

const fail = (error) => ({ ok: false, error });
const text = (v, max = LIMIT.label) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const bit = (v) => {
  if (v === 1 || v === true || v === "1" || v === "true") return 1;
  if (v === 0 || v === false || v === "0" || v === "false") return 0;
  return null;
};

/**
 * A diagram from a JSON string or an object. Empty means no diagram.
 * Returns { ok: true, diagram } (diagram null when there's none) or { ok: false, error }.
 */
export function parseDiagram(raw) {
  if (raw == null || raw === "") return { ok: true, diagram: null };
  let spec = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "null" || s === "{}") return { ok: true, diagram: null };
    try { spec = JSON.parse(s); } catch { return fail("The diagram isn't valid JSON."); }
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return fail("The diagram isn't an object.");
  const type = String(spec.type || "").toLowerCase();
  if (type === "circuit") return parseCircuit(spec);
  if (type === "memory") return parseMemory(spec);
  if (type === "bits") return parseBits(spec);
  if (type === "tree") return parseTree(spec);
  return fail(`Unknown kind of diagram "${spec.type ?? ""}".`);
}

// ── Circuits ─────────────────────────────────────────────────────────────────

function parseCircuit(spec) {
  const inputs = (Array.isArray(spec.inputs) ? spec.inputs : []).map(n => text(n, 16));
  if (!inputs.length || inputs.length > LIMIT.inputs) return fail("A circuit needs 1 to 10 inputs.");
  if (inputs.some(n => !NAME.test(n)) || new Set(inputs).size !== inputs.length) return fail("Circuit inputs need short, distinct names.");
  const rawGates = Array.isArray(spec.gates) ? spec.gates : [];
  if (!rawGates.length || rawGates.length > LIMIT.gates) return fail("A circuit needs 1 to 24 gates.");
  const names = new Set(inputs);
  const gates = [];
  for (const g of rawGates) {
    const id = text(g?.id, 16);
    const op = String(g?.op || "").toUpperCase();
    const ins = (Array.isArray(g?.in) ? g.in : []).map(n => text(n, 16));
    if (!NAME.test(id) || names.has(id)) return fail("Every gate needs its own short id.");
    if (!GATE_OPS.includes(op)) return fail(`Unknown gate "${g?.op ?? ""}".`);
    if ((op === "NOT" || op === "BUF") && ins.length !== 1) return fail(`${op} takes one input.`);
    if (op === "MUX" && ins.length !== 3) return fail("MUX takes three inputs: a, b and sel.");
    if (!["NOT", "BUF", "MUX"].includes(op) && (ins.length < 2 || ins.length > LIMIT.fanIn)) return fail(`${op} takes 2 to 4 inputs.`);
    names.add(id);
    gates.push({ id, op, in: ins });
  }
  for (const g of gates) for (const n of g.in) if (!names.has(n)) return fail(`Gate ${g.id} reads "${n}", which isn't an input or a gate.`);
  const rawOut = spec.outputs;
  const outputs = Array.isArray(rawOut)
    ? rawOut.map(o => ({ name: text(o?.name, 16), from: text(o?.from, 16) }))
    : Object.entries(rawOut && typeof rawOut === "object" ? rawOut : {}).map(([name, from]) => ({ name: text(name, 16), from: text(from, 16) }));
  if (!outputs.length) return fail("A circuit needs at least one output.");
  for (const o of outputs) {
    if (!NAME.test(o.name)) return fail("Circuit outputs need short names.");
    if (!names.has(o.from)) return fail(`Output ${o.name} reads "${o.from}", which isn't an input or a gate.`);
  }
  const order = topoOrder(inputs, gates);
  if (!order) return fail("The circuit has a loop.");
  const values = {};
  if (spec.values && typeof spec.values === "object") {
    for (const [k, v] of Object.entries(spec.values)) {
      if (!inputs.includes(k)) return fail(`A value is given for "${k}", which isn't an input.`);
      const b = bit(v);
      if (b == null) return fail("Input values must be 0 or 1.");
      values[k] = b;
    }
  }
  const ask = spec.ask ? text(spec.ask, 16) : null;
  if (ask && !outputs.some(o => o.name === ask)) return fail(`The circuit asks about "${ask}", which isn't an output.`);
  return { ok: true, diagram: { type: "circuit", inputs, gates: order, outputs, values, ...(ask ? { ask } : {}) } };
}

/** Gates in an order where each one's inputs come first, or null if they form a loop. */
function topoOrder(inputs, gates) {
  const done = new Set(inputs), out = [];
  let left = gates;
  while (left.length) {
    const ready = left.filter(g => g.in.every(n => done.has(n)));
    if (!ready.length) return null;
    for (const g of ready) { out.push(g); done.add(g.id); }
    left = left.filter(g => !done.has(g.id));
  }
  return out;
}

const OPS = {
  AND: (v) => (v.every(Boolean) ? 1 : 0),
  OR: (v) => (v.some(Boolean) ? 1 : 0),
  NAND: (v) => (v.every(Boolean) ? 0 : 1),
  NOR: (v) => (v.some(Boolean) ? 0 : 1),
  XOR: (v) => v.reduce((a, b) => a ^ b, 0),
  XNOR: (v) => 1 - v.reduce((a, b) => a ^ b, 0),
  NOT: (v) => 1 - v[0],
  BUF: (v) => v[0],
  MUX: ([a, b, sel]) => (sel ? b : a),
};

/** Every wire's value for the given inputs: { wires: { name: 0|1 }, outputs: { name: 0|1 } }, or null if an input is missing. */
export function simulate(circuit, values = circuit.values) {
  const wires = {};
  for (const n of circuit.inputs) {
    const b = bit(values?.[n]);
    if (b == null) return null;
    wires[n] = b;
  }
  for (const g of circuit.gates) wires[g.id] = OPS[g.op](g.in.map(n => wires[n]));
  return { wires, outputs: Object.fromEntries(circuit.outputs.map(o => [o.name, wires[o.from]])) };
}

/** The full truth table of a circuit: { columns: [...inputs, ...outputs], rows: [[0,1,…]] } (up to 6 inputs). */
export function truthTable(circuit) {
  const n = circuit.inputs.length;
  if (n > 6) return null;
  const rows = [];
  for (let k = 0; k < 2 ** n; k++) {
    const values = Object.fromEntries(circuit.inputs.map((name, i) => [name, (k >> (n - 1 - i)) & 1]));
    const r = simulate(circuit, values);
    rows.push([...circuit.inputs.map(i => values[i]), ...circuit.outputs.map(o => r.outputs[o.name])]);
  }
  return { columns: [...circuit.inputs, ...circuit.outputs.map(o => o.name)], rows };
}

const BINARY_WORDS = { 0: ["0", "false", "low", "off"], 1: ["1", "true", "high", "on"] };
const asBit = (s) => {
  const t = String(s ?? "").toLowerCase().replace(/[`'"*_.\s]/g, "").replace(/^(out|output|it|=)+[:=]?/, "");
  if (BINARY_WORDS[0].includes(t)) return 0;
  if (BINARY_WORDS[1].includes(t)) return 1;
  return null;
};

/**
 * Does a question's answer agree with its diagram? For a circuit with every
 * input given and one output asked about (or only one output), the accepted
 * answers must include the simulated value. Returns null when it agrees or
 * there's nothing to check, otherwise the problem.
 */
export function checkDiagramAnswer(q) {
  const d = q?.diagram;
  if (!d || d.type !== "circuit") return null;
  const target = d.ask ?? (d.outputs.length === 1 ? d.outputs[0].name : null);
  if (!target) return null;
  const r = simulate(d);
  if (!r) return null;
  const said = (q.accept || []).map(asBit).filter(b => b != null);
  if (!said.length) return null;
  if (said.includes(r.outputs[target])) return null;
  return `The circuit gives ${target} = ${r.outputs[target]}, but the answer says otherwise.`;
}

// ── Memory ───────────────────────────────────────────────────────────────────

function parseMemory(spec) {
  const raw = Array.isArray(spec.boxes) ? spec.boxes : [];
  if (!raw.length || raw.length > LIMIT.boxes) return fail("A memory diagram needs 1 to 12 boxes.");
  const boxes = [];
  const ids = new Set();
  let total = 0;
  for (const b of raw) {
    const id = text(b?.id, 16);
    if (!id || ids.has(id)) return fail("Every box needs its own id.");
    ids.add(id);
    const cells = (Array.isArray(b?.cells) ? b.cells : [b?.value ?? ""]).map(c => (c == null ? "" : String(c)));
    if (!cells.length || cells.length > LIMIT.cellsPerBox) return fail("A box holds 1 to 16 cells.");
    if (cells.some(c => c.length > LIMIT.cellText)) return fail("Cell contents must be short (14 characters at most).");
    total += cells.length;
    boxes.push({ id, label: text(b?.label ?? id), cells, ...(b?.addr ? { addr: text(b.addr, 14) } : {}), ...(b?.index ? { index: true } : {}) });
  }
  if (total > LIMIT.cells) return fail("Too many cells to draw clearly.");
  const byId = Object.fromEntries(boxes.map(b => [b.id, b]));
  const arrows = [];
  for (const a of Array.isArray(spec.arrows) ? spec.arrows : []) {
    const from = text(a?.from, 16), to = text(a?.to, 16);
    if (!byId[from] || !byId[to]) return fail("An arrow points from or to a box that doesn't exist.");
    const fromCell = a.fromCell == null ? 0 : Number(a.fromCell);
    const toCell = a.toCell == null ? null : Number(a.toCell);
    if (!Number.isInteger(fromCell) || fromCell < 0 || fromCell >= byId[from].cells.length) return fail("An arrow starts at a cell that doesn't exist.");
    if (toCell != null && (!Number.isInteger(toCell) || toCell < 0 || toCell >= byId[to].cells.length)) return fail("An arrow ends at a cell that doesn't exist.");
    arrows.push({ from, fromCell, to, toCell });
  }
  if (arrows.length > LIMIT.cells) return fail("Too many arrows to draw clearly.");
  return { ok: true, diagram: { type: "memory", direction: spec.direction === "row" ? "row" : "column", boxes, arrows } };
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function parseBits(spec) {
  const bits = String(spec.bits ?? "").replace(/[\s_]/g, "");
  if (!bits || bits.length > LIMIT.bits || !/^[01?xX]+$/.test(bits)) return fail("Bits must be 1 to 32 characters of 0, 1 or ?.");
  const top = bits.length - 1;
  const fields = [];
  for (const f of Array.isArray(spec.fields) ? spec.fields : []) {
    const from = Number(f?.from), to = Number(f?.to ?? f?.from);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < to || from > top || to < 0) return fail("A field's bits are out of range (from is the higher bit).");
    if (fields.some(g => !(from < g.to || to > g.from))) return fail("Two fields overlap.");
    fields.push({ from, to, label: text(f?.label, 16) });
  }
  return { ok: true, diagram: { type: "bits", bits: bits.toLowerCase().replace(/x/g, "?"), fields: fields.sort((a, b) => b.from - a.from) } };
}

// ── Trees ────────────────────────────────────────────────────────────────────

function parseTree(spec) {
  let count = 0, binary = true, gaps = false, error = null;
  const walk = (node, depth) => {
    if (error) return null;
    if (node == null) return null;
    if (typeof node !== "object") node = { label: node };
    if (++count > LIMIT.nodes) { error = "Too many nodes to draw clearly."; return null; }
    if (depth > LIMIT.depth) { error = "The tree is too deep to draw clearly."; return null; }
    const raw = Array.isArray(node.children) ? node.children : [];
    if (raw.length > LIMIT.children) { error = "A node has too many children."; return null; }
    if (raw.length > 2) binary = false;
    if (raw.some(c => c == null)) gaps = true;
    const children = raw.map(c => walk(c, depth + 1));
    return { label: text(node.label, 12), children };
  };
  const root = walk(spec.root, 0);
  if (error) return fail(error);
  if (!root) return fail("A tree needs a root.");
  // A tree with a missing child somewhere is a binary tree, whose left and right matter.
  return { ok: true, diagram: { type: "tree", root, binary: binary && (gaps || Boolean(spec.binary)) } };
}

// ── Drawing ──────────────────────────────────────────────────────────────────
// drawDiagram(spec) → { width, height, shapes } where each shape is one of
//   { kind: "path", d, cls, marker? }   { kind: "rect", x, y, w, h, cls, rx? }
//   { kind: "circle", cx, cy, r, cls }  { kind: "text", x, y, text, cls, anchor? }
// cls names are styled in styles/diagram.css (line, fill, text, muted, accent, ask).

const PAD = 16;
const charW = (s, size = 13) => String(s).length * size * 0.6;

export function drawDiagram(d) {
  if (!d) return null;
  if (d.type === "circuit") return drawCircuit(d);
  if (d.type === "memory") return drawMemory(d);
  if (d.type === "bits") return drawBits(d);
  if (d.type === "tree") return drawTree(d);
  return null;
}

const GATE_W = 44, GATE_H = 36, COL_W = 96, ROW_H = 56;

/** The x offset of a gate's back edge at height y (OR-family gates have a curved back). */
function backEdge(op, y) {
  if (!["OR", "NOR", "XOR", "XNOR"].includes(op)) return 0;
  const t = y / GATE_H;
  return 24 * t * (1 - t);
}

function gateShapes(op, x, y) {
  const s = [];
  const T = (dx, dy) => `${x + dx},${y + dy}`;
  const bubble = (cx) => s.push({ kind: "circle", cx: x + cx, cy: y + GATE_H / 2, r: 4, cls: "line fill" });
  if (op === "AND" || op === "NAND") {
    s.push({ kind: "path", d: `M${T(0, 0)} H${x + 22} A18,18 0 0 1 ${T(22, 36)} H${x} Z`, cls: "line fill" });
    if (op === "NAND") bubble(44);
  } else if (op === "OR" || op === "NOR" || op === "XOR" || op === "XNOR") {
    s.push({ kind: "path", d: `M${T(0, 0)} Q${T(12, 18)} ${T(0, 36)} Q${T(30, 36)} ${T(44, 18)} Q${T(30, 0)} ${T(0, 0)} Z`, cls: "line fill" });
    if (op === "XOR" || op === "XNOR") s.push({ kind: "path", d: `M${T(-6, 0)} Q${T(6, 18)} ${T(-6, 36)}`, cls: "line" });
    if (op === "NOR" || op === "XNOR") bubble(48);
  } else if (op === "NOT" || op === "BUF") {
    s.push({ kind: "path", d: `M${T(0, 2)} L${T(34, 18)} L${T(0, 34)} Z`, cls: "line fill" });
    if (op === "NOT") bubble(38);
  } else if (op === "MUX") {
    s.push({ kind: "path", d: `M${T(0, -6)} L${T(44, 6)} L${T(44, 30)} L${T(0, 42)} Z`, cls: "line fill" });
    s.push({ kind: "text", x: x + 22, y: y + 22, text: "MUX", cls: "text small", anchor: "middle" });
  }
  return s;
}

/** Where a gate's output leaves it. */
function gateOut(op, x, y) {
  const end = { AND: 40, NAND: 48, OR: 44, NOR: 52, XOR: 44, XNOR: 52, NOT: 42, BUF: 34, MUX: 44 }[op] ?? 44;
  return [x + end, y + GATE_H / 2];
}

/** Where a gate's k-th of n inputs arrives. */
function gateIn(op, x, y, k, n) {
  const py = op === "MUX" ? [6, 18, 30][k] : (GATE_H * (k + 1)) / (n + 1);
  return [x + backEdge(op, py), y + py];
}

const curve = ([sx, sy], [tx, ty]) => {
  const mx = (sx + tx) / 2;
  return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
};

const LANE_H = 22; // a wire passing through a column takes a lane this tall

function drawCircuit(d) {
  // Columns by depth: inputs at 0, each gate one past its deepest input, outputs last.
  const depth = Object.fromEntries(d.inputs.map(n => [n, 0]));
  for (const g of d.gates) depth[g.id] = 1 + Math.max(...g.in.map(n => depth[n]));
  const last = Math.max(...d.gates.map(g => depth[g.id])) + 1;
  const opOf = Object.fromEntries(d.gates.map(g => [g.id, g.op]));

  // A wire that skips columns runs through a lane in each column it crosses
  // (one lane per signal per column, shared by all its far readers), so it
  // never passes behind a gate it doesn't feed.
  const lane = (src, c) => `lane:${src}:${c}`;
  const readers = []; // { to, k, n, src }
  for (const g of d.gates) g.in.forEach((src, k) => readers.push({ to: g.id, col: depth[g.id], k, n: g.in.length, src }));
  d.outputs.forEach(o => readers.push({ to: `out:${o.name}`, col: last, k: 0, n: 1, src: o.from }));
  const feeds = {}; // node → the nodes in the column before that feed it
  const columns = Array.from({ length: last + 1 }, () => []);
  const add = (c, id) => { if (!columns[c].includes(id)) columns[c].push(id); };
  d.inputs.forEach(n => add(0, n));
  for (const g of d.gates) add(depth[g.id], g.id);
  d.outputs.forEach(o => add(last, `out:${o.name}`));
  for (const r of readers) {
    let prev = r.src;
    for (let c = depth[r.src] + 1; c < r.col; c++) {
      add(c, lane(r.src, c));
      (feeds[lane(r.src, c)] ||= new Set()).add(prev);
      prev = lane(r.src, c);
    }
    (feeds[r.to] ||= new Set()).add(prev);
  }
  const heightOf = (id) => (id.startsWith("lane:") ? LANE_H : ROW_H);
  const colHeight = (c) => columns[c].reduce((s, id) => s + heightOf(id), 0);

  // Order each column by where its feeds sit in the column before (the
  // barycentre), which keeps wires short and crossings few. Inputs keep the
  // order they were given in.
  const yMid = {};
  const tallest = Math.max(...columns.map((_, c) => colHeight(c)));
  const place = (c) => {
    let y = PAD + (tallest - colHeight(c)) / 2;
    for (const id of columns[c]) { yMid[id] = y + heightOf(id) / 2; y += heightOf(id); }
  };
  place(0);
  for (let c = 1; c <= last; c++) {
    const key = (id) => { const f = [...(feeds[id] || [])]; return f.length ? f.reduce((s, x) => s + yMid[x], 0) / f.length : 0; };
    columns[c].sort((a, b) => key(a) - key(b));
    place(c);
  }

  const labelW = Math.max(...d.inputs.map(n => charW(d.values[n] != null ? `${n} = ${d.values[n]}` : n))) + 12;
  const outW = Math.max(...d.outputs.map(o => charW(d.ask === o.name ? `${o.name} = ?` : o.name))) + 12;
  const xOf = (c) => PAD + labelW + 16 + (c - 1) * COL_W + 24;
  const outX = xOf(last) - 8;
  const gateTop = (id) => yMid[id] - GATE_H / 2;
  // Where a signal leaves its column: an input's dot, a gate's output, or the far end of a lane.
  const exit = (id) => {
    if (id.startsWith("lane:")) return [xOf(Number(id.split(":").at(-1))) + GATE_W, yMid[id]];
    if (opOf[id]) return gateOut(opOf[id], xOf(depth[id]), gateTop(id));
    return [PAD + labelW, yMid[id]];
  };

  // A gate whose inputs can be swapped (all but MUX) takes them in the order its wires arrive, top to bottom.
  const port = {};
  for (const g of d.gates) {
    const arrive = g.in.map((src, k) => ({ k, y: depth[g.id] - depth[src] > 1 ? yMid[lane(src, depth[g.id] - 1)] : exit(src)[1] }));
    if (g.op !== "MUX") arrive.sort((a, b) => a.y - b.y);
    arrive.forEach((a, i) => { port[`${g.id}:${a.k}`] = i; });
  }

  const shapes = [];
  // Wires first, so gates sit on top of their ends.
  for (const r of readers) {
    let from = exit(r.src);
    let d2 = "";
    for (let c = depth[r.src] + 1; c < r.col; c++) {
      const y = yMid[lane(r.src, c)];
      d2 += `${d2 ? " " : ""}${curve(from, [xOf(c), y])} L${xOf(c) + GATE_W},${y}`;
      from = [xOf(c) + GATE_W, y];
    }
    const end = r.to.startsWith("out:") ? [outX, yMid[r.to]] : gateIn(opOf[r.to], xOf(r.col), gateTop(r.to), port[`${r.to}:${r.k}`], r.n);
    shapes.push({ kind: "path", d: `${d2}${d2 ? " " : ""}${curve(from, end)}`, cls: "line wire" });
  }
  for (const g of d.gates) shapes.push(...gateShapes(g.op, xOf(depth[g.id]), gateTop(g.id)));
  d.inputs.forEach((n) => {
    const [x, y] = exit(n);
    shapes.push({ kind: "circle", cx: x, cy: y, r: 3, cls: "dot" });
    const v = d.values[n];
    shapes.push({ kind: "text", x: x - 8, y: y + 4, text: v != null ? `${n} = ${v}` : n, cls: v != null ? "text accent" : "text", anchor: "end" });
  });
  d.outputs.forEach((o) => {
    const y = yMid[`out:${o.name}`];
    shapes.push({ kind: "circle", cx: outX, cy: y, r: 3, cls: "dot" });
    const asked = d.ask === o.name;
    shapes.push({ kind: "text", x: outX + 8, y: y + 4, text: asked ? `${o.name} = ?` : o.name, cls: asked ? "text ask" : "text" });
  });
  return { width: Math.ceil(outX + 8 + outW + PAD), height: Math.ceil(PAD * 2 + tallest), shapes };
}

const CELL_H = 32, BOX_GAP = 28;

function drawMemory(d) {
  const shapes = [];
  const cellW = (b) => Math.max(40, ...b.cells.map(c => charW(c) + 16));
  const rects = {};
  const labelW = d.direction === "column" ? Math.max(...d.boxes.map(b => charW(b.label))) + 14 : 0;
  const hasIndex = d.boxes.some(b => b.index);
  const row = d.direction === "row";
  // Side by side, arrows that aren't to the next box arc over the top, so leave room for them.
  const arcs = row ? d.arrows.filter((a, i) => !adjacentRight(d, a, i)).length : 0;
  let x = PAD, y = PAD + (hasIndex ? 14 : 0) + (arcs ? 34 : 0);
  let maxX = 0, maxY = 0;
  for (const b of d.boxes) {
    const w = cellW(b);
    const bx = d.direction === "column" ? PAD + labelW : x;
    const by = y;
    rects[b.id] = { x: bx, y: by, w, n: b.cells.length };
    b.cells.forEach((c, i) => {
      const cx = bx + i * w;
      shapes.push({ kind: "rect", x: cx, y: by, w, h: CELL_H, cls: "line fill" });
      const pointer = d.arrows.some(a => a.from === b.id && a.fromCell === i);
      if (pointer && (c === "" || c === "•" || c === "*")) shapes.push({ kind: "circle", cx: cx + w / 2, cy: by + CELL_H / 2, r: 3.5, cls: "dot" });
      else shapes.push({ kind: "text", x: cx + w / 2, y: by + CELL_H / 2 + 5, text: c, cls: c === "?" ? "text ask mono" : "text mono", anchor: "middle" });
      if (b.index) shapes.push({ kind: "text", x: cx + w / 2, y: by - 5, text: String(i), cls: "text muted small", anchor: "middle" });
    });
    if (!row) {
      shapes.push({ kind: "text", x: bx - 10, y: by + CELL_H / 2 + 5, text: b.label, cls: "text mono", anchor: "end" });
      if (b.addr) shapes.push({ kind: "text", x: bx + w * b.cells.length + 8, y: by + CELL_H / 2 + 4, text: b.addr, cls: "text muted small mono" });
    } else {
      // Side by side, names go under the boxes, out of the way of the arrows.
      shapes.push({ kind: "text", x: bx, y: by + CELL_H + 16, text: b.label, cls: "text mono" });
      if (b.addr) shapes.push({ kind: "text", x: bx, y: by + CELL_H + 30, text: b.addr, cls: "text muted small mono" });
    }
    const right = bx + Math.max(w * b.cells.length, row ? charW(b.label) : 0) + (b.addr && !row ? charW(b.addr, 11) + 12 : 0);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, by + CELL_H + (row ? (b.addr ? 34 : 20) : 0));
    if (!row) y += CELL_H + BOX_GAP + (hasIndex ? 14 : 0);
    else x = bx + w * b.cells.length + 48;
  }
  // Arrows: from the middle of the pointer's cell to the edge of what it points at.
  let bend = 0;
  d.arrows.forEach((a, i) => {
    const s = rects[a.from], t = rects[a.to];
    const sx = s.x + (a.fromCell + 0.5) * s.w, sy = s.y + CELL_H / 2;
    const tw = a.toCell == null ? t.w * t.n : t.w;
    const tx0 = a.toCell == null ? t.x : t.x + a.toCell * t.w;
    let path;
    if (row && adjacentRight(d, a, i)) {
      // To the next box along: straight across into its left side.
      path = `M${sx},${sy} L${t.x - 2},${t.y + CELL_H / 2}`;
    } else if (row) {
      // Anywhere else along the row: up out of the cell, over, and down into the target's top.
      const tx = tx0 + tw / 2, lift = 22 + 8 * (bend++ % 2);
      path = `M${sx},${sy} C${sx},${s.y - lift} ${tx},${t.y - lift} ${tx},${t.y - 1}`;
    } else if (t.y > s.y + 1) {
      const tx = tx0 + tw / 2;
      path = `M${sx},${sy} C${sx + 40},${sy + 10} ${tx},${t.y - 30} ${tx},${t.y - 1}`;
    } else if (t.y < s.y - 1) {
      const tx = tx0 + tw / 2;
      path = `M${sx},${sy} C${sx + 40},${sy - 10} ${tx},${t.y + CELL_H + 30} ${tx},${t.y + CELL_H + 1}`;
    } else {
      // Same row, pointing back (or at itself): loop under the boxes.
      const tx = tx0 + tw / 2, drop = 30 + 10 * (bend++ % 3);
      path = `M${sx},${sy} C${sx},${s.y + CELL_H + drop} ${tx},${t.y + CELL_H + drop} ${tx},${t.y + CELL_H + 1}`;
      maxY = Math.max(maxY, s.y + CELL_H + drop);
    }
    shapes.push({ kind: "path", d: path, cls: "line arrow", marker: true });
  });
  return { width: Math.ceil(maxX + PAD + 24), height: Math.ceil(maxY + PAD + 6), shapes };
}

/** In a row of boxes, does this arrow go from a box's last cell to the start of the very next box? */
function adjacentRight(d, a) {
  const from = d.boxes.findIndex(b => b.id === a.from);
  const to = d.boxes.findIndex(b => b.id === a.to);
  return to === from + 1 && (a.toCell == null || a.toCell === 0) && a.fromCell === d.boxes[from].cells.length - 1;
}

const BIT_W = 24, BIT_H = 30;

function drawBits(d) {
  const shapes = [];
  const n = d.bits.length;
  // A small gap every four bits makes long words easier to read, unless fields say how to group them.
  const gap = (i) => (d.fields.length ? 0 : Math.floor(i / 4) * 6);
  const x0 = PAD, y0 = PAD + 14;
  const xOf = (i) => x0 + i * BIT_W + gap(i);
  for (let i = 0; i < n; i++) {
    const pos = n - 1 - i; // bit number, most significant first
    const b = d.bits[i];
    shapes.push({ kind: "rect", x: xOf(i), y: y0, w: BIT_W, h: BIT_H, cls: b === "1" ? "line fill on" : "line fill" });
    shapes.push({ kind: "text", x: xOf(i) + BIT_W / 2, y: y0 + BIT_H / 2 + 5, text: b, cls: b === "?" ? "text ask mono" : "text mono", anchor: "middle" });
    shapes.push({ kind: "text", x: xOf(i) + BIT_W / 2, y: y0 - 5, text: String(pos), cls: "text muted small", anchor: "middle" });
  }
  let bottom = y0 + BIT_H;
  for (const f of d.fields) {
    const a = xOf(n - 1 - f.from) + 2, b = xOf(n - 1 - f.to) + BIT_W - 2, y = y0 + BIT_H + 8;
    shapes.push({ kind: "path", d: `M${a},${y - 4} V${y} H${b} V${y - 4}`, cls: "line" });
    if (f.label) shapes.push({ kind: "text", x: (a + b) / 2, y: y + 15, text: f.label, cls: "text small", anchor: "middle" });
    bottom = y + 20;
  }
  return { width: Math.ceil(xOf(n - 1) + BIT_W + PAD), height: Math.ceil(bottom + PAD), shapes };
}

const NODE_H = 28, LEVEL_H = 60, SLOT_W = 52;

function drawTree(d) {
  const shapes = [];
  const nodes = [];
  let slot = 0;
  // Binary trees in order (left subtree, node, right subtree), so left and right read as they should;
  // other trees with each parent centred over its children.
  const place = (node, depth) => {
    if (!node) return null;
    const me = { node, depth, x: 0, kids: [] };
    if (d.binary) {
      const [l, r] = [node.children[0] ?? null, node.children[1] ?? null];
      const left = place(l, depth + 1);
      me.x = slot++;
      const right = place(r, depth + 1);
      me.kids = [left, right].filter(Boolean);
    } else {
      me.kids = node.children.map(c => place(c, depth + 1)).filter(Boolean);
      me.x = me.kids.length ? (me.kids[0].x + me.kids.at(-1).x) / 2 : slot++;
    }
    nodes.push(me);
    return me;
  };
  place(d.root, 0);
  const wOf = (n) => Math.max(36, charW(n.node.label) + 18);
  const cx = (n) => PAD + 24 + n.x * SLOT_W;
  const cy = (n) => PAD + n.depth * LEVEL_H + NODE_H / 2;
  for (const n of nodes) for (const k of n.kids) shapes.push({ kind: "path", d: `M${cx(n)},${cy(n) + NODE_H / 2} L${cx(k)},${cy(k) - NODE_H / 2}`, cls: "line" });
  for (const n of nodes) {
    const w = wOf(n);
    shapes.push({ kind: "rect", x: cx(n) - w / 2, y: cy(n) - NODE_H / 2, w, h: NODE_H, rx: NODE_H / 2, cls: "line fill" });
    shapes.push({ kind: "text", x: cx(n), y: cy(n) + 5, text: n.node.label, cls: n.node.label === "?" ? "text ask mono" : "text mono", anchor: "middle" });
  }
  const maxX = Math.max(...nodes.map(n => cx(n) + wOf(n) / 2));
  const maxDepth = Math.max(...nodes.map(n => n.depth));
  return { width: Math.ceil(maxX + PAD), height: Math.ceil(PAD * 2 + maxDepth * LEVEL_H + NODE_H), shapes };
}

/** A scene as a standalone SVG string (for tests and previews; the app draws scenes with React). */
export function sceneToSvg(scene, { colors = { ink: "#1f1f28", muted: "#717c7c", accent: "#7e9cd8", ask: "#c0a36e", fill: "#f2ecbc", on: "#e6dfb5" } } = {}) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const style = (cls = "") => {
    const c = cls.split(" ");
    if (c.includes("text")) return `fill="${c.includes("ask") ? colors.ask : c.includes("accent") ? colors.accent : c.includes("muted") ? colors.muted : colors.ink}" font-size="${c.includes("small") ? 11 : 13}" font-family="${c.includes("mono") ? "monospace" : "sans-serif"}"`;
    if (c.includes("dot")) return `fill="${colors.ink}"`;
    return `fill="${c.includes("fill") ? (c.includes("on") ? colors.on : colors.fill) : "none"}" stroke="${colors.ink}" stroke-width="1.5"`;
  };
  const body = scene.shapes.map(s => {
    if (s.kind === "path") return `<path d="${s.d}" ${style(s.cls)}${s.marker ? ' marker-end="url(#ah)"' : ""}/>`;
    if (s.kind === "rect") return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx || 3}" ${style(s.cls)}/>`;
    if (s.kind === "circle") return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" ${style(s.cls)}/>`;
    return `<text x="${s.x}" y="${s.y}" text-anchor="${s.anchor || "start"}" ${style(s.cls)}>${esc(s.text)}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${colors.ink}"/></marker></defs><rect width="100%" height="100%" fill="#fffdf4"/>${body}</svg>`;
}

/** A short plain-text stand-in for a diagram (search, lists, and what the grader is told). */
export function describeDiagram(d) {
  if (!d) return "";
  return JSON.stringify(d.type === "tree" ? { type: "tree", root: d.root } : d);
}

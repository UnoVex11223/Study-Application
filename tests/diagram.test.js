import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDiagram, simulate, truthTable, checkDiagramAnswer, drawDiagram, sceneToSvg } from "../src/lib/diagram.js";

const MUX = {
  type: "circuit", inputs: ["a", "b", "sel"],
  gates: [
    { id: "n1", op: "NOT", in: ["sel"] },
    { id: "g1", op: "AND", in: ["a", "n1"] },
    { id: "g2", op: "AND", in: ["b", "sel"] },
    { id: "g3", op: "OR", in: ["g1", "g2"] },
  ],
  outputs: { out: "g3" }, values: { a: 1, b: 0, sel: 1 }, ask: "out",
};

test("a circuit is parsed from JSON text, and simulated", () => {
  const r = parseDiagram(JSON.stringify(MUX));
  assert.equal(r.ok, true, r.error);
  assert.equal(simulate(r.diagram).outputs.out, 0, "sel=1 picks b, which is 0");
  assert.equal(simulate(r.diagram, { a: 1, b: 0, sel: 0 }).outputs.out, 1);
  assert.equal(simulate(r.diagram, { a: 1 }), null, "a missing input can't be simulated");
  const t = truthTable(r.diagram);
  assert.deepEqual(t.columns, ["a", "b", "sel", "out"]);
  assert.equal(t.rows.length, 8);
  // The built-in MUX gate agrees with the one built from AND, OR and NOT.
  const chip = parseDiagram({ type: "circuit", inputs: ["a", "b", "sel"], gates: [{ id: "m", op: "MUX", in: ["a", "b", "sel"] }], outputs: { out: "m" } }).diagram;
  assert.deepEqual(truthTable(chip).rows, t.rows);
});

test("broken circuits are rejected with a reason", () => {
  const bad = (patch) => parseDiagram({ ...MUX, ...patch });
  assert.equal(bad({ gates: [{ id: "g", op: "FOO", in: ["a", "b"] }] }).ok, false);
  assert.match(bad({ gates: [{ id: "g", op: "AND", in: ["a", "zzz"] }], outputs: { out: "g" } }).error, /zzz/);
  assert.match(bad({ gates: [{ id: "x", op: "AND", in: ["a", "y"] }, { id: "y", op: "OR", in: ["b", "x"] }], outputs: { out: "y" } }).error, /loop/);
  assert.equal(bad({ gates: [{ id: "n", op: "NOT", in: ["a", "b"] }], outputs: { out: "n" } }).ok, false, "NOT takes one input");
  assert.equal(bad({ values: { a: 2 } }).ok, false);
  assert.equal(bad({ ask: "nope" }).ok, false);
  assert.equal(parseDiagram("{not json").ok, false);
  assert.equal(parseDiagram({ type: "venn" }).ok, false);
  assert.deepEqual(parseDiagram(""), { ok: true, diagram: null }, "empty means no diagram");
});

test("a circuit question whose answer disagrees with the simulation is caught", () => {
  const diagram = parseDiagram(MUX).diagram;
  assert.equal(checkDiagramAnswer({ diagram, accept: ["0", "false"] }), null);
  assert.match(checkDiagramAnswer({ diagram, accept: ["1"] }), /out = 0/);
  assert.equal(checkDiagramAnswer({ diagram, accept: ["the output is low because sel picks b"] }), null, "nothing checkable");
  assert.equal(checkDiagramAnswer({ diagram: { ...diagram, values: {} }, accept: ["1"] }), null, "no inputs given, nothing to check");
});

test("memory, bits and trees are checked and normalized", () => {
  const mem = parseDiagram({ type: "memory", boxes: [{ id: "p", cells: [""] }, { id: "a", label: "a", cells: ["3", "1", "4"], index: true }], arrows: [{ from: "p", to: "a", toCell: 1 }] });
  assert.equal(mem.ok, true, mem.error);
  assert.equal(mem.diagram.boxes[0].label, "p");
  assert.equal(parseDiagram({ type: "memory", boxes: [{ id: "a", cells: ["1"] }], arrows: [{ from: "a", to: "b" }] }).ok, false);
  assert.equal(parseDiagram({ type: "memory", boxes: [{ id: "a", cells: ["1"] }], arrows: [{ from: "a", to: "a", toCell: 3 }] }).ok, false);

  const bits = parseDiagram({ type: "bits", bits: "1110 0011 0000 1000", fields: [{ from: 12, to: 12, label: "a" }, { from: 15, to: 13, label: "111" }] });
  assert.equal(bits.ok, true, bits.error);
  assert.equal(bits.diagram.bits.length, 16);
  assert.deepEqual(bits.diagram.fields.map(f => f.from), [15, 12], "fields from the high bit down");
  assert.equal(parseDiagram({ type: "bits", bits: "10", fields: [{ from: 1, to: 0 }, { from: 0, to: 0 }] }).ok, false, "overlapping fields");
  assert.equal(parseDiagram({ type: "bits", bits: "102" }).ok, false);

  const tree = parseDiagram({ type: "tree", root: { label: "now", children: [{ label: "is", children: [{ label: "for" }, null] }, { label: "the" }] } });
  assert.equal(tree.ok, true, tree.error);
  assert.equal(tree.diagram.binary, true, "a null child makes it a binary tree");
  assert.equal(parseDiagram({ type: "tree" }).ok, false);
});

test("every kind draws to a scene with finite coordinates", () => {
  const specs = [
    MUX,
    { type: "circuit", inputs: ["a", "b"], gates: [{ id: "x", op: "XNOR", in: ["a", "b"] }, { id: "n", op: "NAND", in: ["a", "x"] }, { id: "o", op: "NOR", in: ["x", "n"] }], outputs: { y: "o", z: "x" } },
    { type: "memory", boxes: [{ id: "x", cells: ["5"] }, { id: "p", cells: [""] }, { id: "q", cells: ["?"] }], arrows: [{ from: "p", to: "x" }, { from: "q", to: "p" }] },
    { type: "memory", direction: "row", boxes: [{ id: "n1", label: "head", cells: ["1", ""] }, { id: "n2", cells: ["2", ""] }, { id: "n3", cells: ["3", "NULL"] }], arrows: [{ from: "n1", fromCell: 1, to: "n2" }, { from: "n2", fromCell: 1, to: "n3" }, { from: "n3", fromCell: 0, to: "n1" }] },
    { type: "bits", bits: "0000000000000111" },
    { type: "tree", root: { label: "+", children: [{ label: "*", children: [{ label: "2" }, { label: "x" }] }, { label: "1" }] } },
  ];
  for (const spec of specs) {
    const d = parseDiagram(spec);
    assert.equal(d.ok, true, d.error);
    const scene = drawDiagram(d.diagram);
    assert.ok(scene.width > 0 && scene.height > 0 && scene.width < 2000 && scene.height < 2000, `${spec.type} has a sensible size`);
    for (const s of scene.shapes) {
      for (const k of ["x", "y", "w", "h", "cx", "cy", "r"]) if (k in s) assert.ok(Number.isFinite(s[k]), `${spec.type} ${s.kind}.${k}`);
      if (s.kind === "path") assert.doesNotMatch(s.d, /NaN|undefined/, `${spec.type} path`);
    }
    assert.match(sceneToSvg(scene), /^<svg /);
  }
});

test("the asked-about output is drawn as a question mark, and internal wires aren't given away", () => {
  const scene = drawDiagram(parseDiagram(MUX).diagram);
  const texts = scene.shapes.filter(s => s.kind === "text").map(s => s.text);
  assert.ok(texts.includes("out = ?"));
  assert.ok(texts.includes("a = 1") && texts.includes("sel = 1"));
  assert.ok(!texts.some(t => /^g\d/.test(t)), "gate ids aren't labels");
});

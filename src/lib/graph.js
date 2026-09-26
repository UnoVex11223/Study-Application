// Knowledge-graph helpers: prerequisite DAG checks and layouts.

/** Would adding prereq edge from→to create a cycle? (i.e. can `to` already reach `from`) */
export function wouldCycle(edges, from, to) {
  if (from === to) return true;
  const out = {};
  for (const e of edges) if (e.type === "prereq") (out[e.from] ||= []).push(e.to);
  const seen = new Set([to]);
  const stack = [to];
  while (stack.length) {
    const n = stack.pop();
    if (n === from) return true;
    for (const m of out[n] || []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  return false;
}

/**
 * Add edges one at a time, skipping duplicates and any prereq edge that
 * would introduce a cycle. Returns { accepted, rejected }.
 */
export function mergeEdges(existing, incoming) {
  const all = [...existing];
  const key = (e) => e.type === "prereq" ? `p:${e.from}>${e.to}` : `r:${[e.from, e.to].sort().join("|")}`;
  const keys = new Set(all.map(key));
  const accepted = [], rejected = [];
  for (const e of incoming) {
    if (e.from === e.to || keys.has(key(e))) { rejected.push({ edge: e, reason: "duplicate" }); continue; }
    if (e.type === "prereq" && wouldCycle(all, e.from, e.to)) { rejected.push({ edge: e, reason: "cycle" }); continue; }
    all.push(e); keys.add(key(e)); accepted.push(e);
  }
  return { accepted, rejected };
}

/**
 * Layered (Sugiyama-style) layout for a DAG, left to right.
 * nodes: [{id}], edges: [{from,to}] (from before to).
 * Returns { pos: {id: {x, y, layer}}, width, height }.
 */
export function layeredLayout(nodes, edges, { colGap = 220, rowGap = 72, padX = 110, padY = 50 } = {}) {
  const ids = new Set(nodes.map(n => n.id));
  const es = edges.filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const inc = {}, out = {};
  for (const id of ids) { inc[id] = []; out[id] = []; }
  for (const e of es) { inc[e.to].push(e.from); out[e.from].push(e.to); }

  // Longest-path layering (Kahn order; any leftover cycle members go last).
  const layer = {};
  const indeg = Object.fromEntries([...ids].map(id => [id, inc[id].length]));
  const queue = [...ids].filter(id => indeg[id] === 0);
  for (const id of queue) layer[id] = 0;
  while (queue.length) {
    const n = queue.shift();
    for (const m of out[n]) {
      layer[m] = Math.max(layer[m] ?? 0, layer[n] + 1);
      if (--indeg[m] === 0) queue.push(m);
    }
  }
  const maxLayer = Math.max(0, ...Object.values(layer));
  for (const id of ids) if (layer[id] == null) layer[id] = maxLayer + 1;

  const layers = [];
  for (const n of nodes) (layers[layer[n.id]] ||= []).push(n.id);
  for (let i = 0; i < layers.length; i++) layers[i] ||= [];

  // Barycenter sweeps to reduce crossings.
  const orderIdx = {};
  const setIdx = () => layers.forEach(l => l.forEach((id, i) => { orderIdx[id] = i; }));
  setIdx();
  const bary = (id, nbrs) => nbrs.length ? nbrs.reduce((s, n) => s + orderIdx[n], 0) / nbrs.length : orderIdx[id];
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    const range = down ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).slice(0, -1).reverse();
    for (const li of range) {
      layers[li].sort((a, b) => bary(a, down ? inc[a] : out[a]) - bary(b, down ? inc[b] : out[b]));
      layers[li].forEach((id, i) => { orderIdx[id] = i; });
    }
  }

  const tallest = Math.max(1, ...layers.map(l => l.length));
  const pos = {};
  layers.forEach((l, li) => {
    const offset = (tallest - l.length) * rowGap / 2;
    l.forEach((id, i) => { pos[id] = { x: padX + li * colGap, y: padY + offset + i * rowGap, layer: li }; });
  });
  return { pos, width: padX * 2 + (layers.length - 1) * colGap, height: padY * 2 + (tallest - 1) * rowGap };
}

/** Topological order of concept ids restricted to prereq edges (stable, cycle-tolerant). */
export function topoOrder(ids, edges) {
  const set = new Set(ids);
  const indeg = Object.fromEntries(ids.map(id => [id, 0]));
  const out = {};
  for (const e of edges) {
    if (e.type !== "prereq" || !set.has(e.from) || !set.has(e.to)) continue;
    indeg[e.to]++; (out[e.from] ||= []).push(e.to);
  }
  const res = [], q = ids.filter(id => indeg[id] === 0);
  while (q.length) {
    const n = q.shift(); res.push(n);
    for (const m of out[n] || []) if (--indeg[m] === 0) q.push(m);
  }
  for (const id of ids) if (!res.includes(id)) res.push(id);
  return res;
}

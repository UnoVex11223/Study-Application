// One paste, several courses. A long paste (a guide, a set of notes) is cut
// into numbered lines for Claude to sort into courses and chapters
// (electron.cjs ai:plan); the answer is turned back into character ranges of
// the paste, and the whole thing becomes one background import whose
// chapters each go into their own course (lib/bookRunner.js), in reading
// order, so later chapters can build on earlier ones in any course.

import { callAi, ladderCost } from "./ai.js";
import { index, makeCourse, uid } from "./model.js";

const LONG = 1500;     // a line longer than this is numbered in pieces, cut at sentence ends
const PIECE = 900;
const BUDGET = 240000; // characters of numbered lines sent for sorting

/** The paste's non-empty lines (long ones in pieces): [{ at, text }], `at` its offset in the paste. */
export function segments(text) {
  const out = [];
  let at = 0;
  for (const line of String(text ?? "").split("\n")) {
    if (line.length <= LONG) {
      if (line.trim()) out.push({ at, text: line });
    } else {
      let start = 0;
      while (start < line.length) {
        let end = Math.min(line.length, start + PIECE);
        if (end < line.length) {
          const dot = line.lastIndexOf(". ", end);
          if (dot > start + PIECE / 3) end = dot + 2;
        }
        const piece = line.slice(start, end);
        if (piece.trim()) out.push({ at: at + start, text: piece });
        start = end;
      }
    }
    at += line.length + 1;
  }
  return out;
}

/** The numbered lines Claude sees, each cut short enough that the whole paste fits the budget. */
export function numberedLines(segs, budget = BUDGET) {
  const per = Math.max(40, Math.min(200, Math.floor(budget / Math.max(1, segs.length)) - 8));
  return segs.map((s, i) => {
    const t = s.text.trim();
    return `${i + 1}: ${t.length > per ? `${t.slice(0, per)}…` : t}`;
  }).join("\n");
}

const firstLine = (s) => {
  const line = String(s).split("\n").map(l => l.trim()).find(Boolean) || "";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
};

/**
 * Claude's sorting as courses of chapters (character ranges of the paste).
 * Returns { title, courses: [{ key, name, courseId | null, parts: [{ title, from, to, include }] }], skipped: [{ title, reason, from, to }] }.
 * Lines nobody claimed belong to the chapter (or skip) before them, and
 * anything before the first one to the first; out-of-range or repeated start
 * lines are ignored; courses aimed at the same existing course, or with the
 * same name, are merged. If nothing usable comes back, the whole paste is one
 * chapter of one new course.
 */
export function readPlan(data, { text, segs, courses = [] }) {
  const n = segs.length;
  const existingByName = new Map(courses.filter(c => c.kind !== "notes").map(c => [c.name.trim().toLowerCase(), c]));
  const plan = [], starts = [], seen = new Set();
  const claim = (raw) => {
    const line = Math.round(Number(raw));
    if (!(line >= 1 && line <= n) || seen.has(line)) return null;
    seen.add(line);
    return line;
  };

  for (const c of data?.courses || []) {
    const existing = existingByName.get(String(c.existing || "").trim().toLowerCase()) || null;
    const name = existing?.name ?? (String(c.name || "").trim() || "New course");
    // Two entries for one course (the same existing course, or the same name) are one.
    let k = plan.findIndex(p => (existing && p.courseId === existing.id) || p.name.toLowerCase() === name.toLowerCase());
    if (k < 0) { k = plan.length; plan.push({ key: `c${k}`, name, courseId: existing?.id ?? null, parts: [] }); }
    for (const p of c.parts || []) {
      const line = claim(p.start_line);
      if (line) starts.push({ line, k, title: String(p.title || "").trim() });
    }
  }
  for (const s of data?.skip || []) {
    const line = claim(s.start_line);
    if (line) starts.push({ line, k: null, reason: String(s.reason || "").trim() });
  }
  starts.sort((a, b) => a.line - b.line);

  const skipped = [];
  starts.forEach((s, i) => {
    const from = i === 0 ? 0 : segs[s.line - 1].at;
    const to = i + 1 < starts.length ? segs[starts[i + 1].line - 1].at : text.length;
    const body = text.slice(from, to);
    if (!body.trim()) return;
    if (s.k === null) skipped.push({ title: firstLine(body), reason: s.reason, from, to });
    else plan[s.k].parts.push({ title: s.title || firstLine(body), from, to, include: true });
  });

  const title = String(data?.title || "").trim();
  const sorted = plan.filter(c => c.parts.length);
  if (!sorted.length) {
    const name = String(data?.courses?.[0]?.name || "").trim() || title || "New course";
    return { title, courses: [{ key: "c0", name, courseId: null, parts: [{ title: firstLine(text) || name, from: 0, to: String(text).length, include: true }] }], skipped: [] };
  }
  return { title, courses: sorted, skipped };
}

/** Sort a paste into courses and chapters (one call to Claude). Returns { ok, ...readPlan } or { ok: false, error }. */
export async function planPaste({ state, text }) {
  const segs = segments(text);
  if (!segs.length) return { ok: false, error: "There's nothing to sort yet." };
  const ix = index(state);
  const own = state.courses.filter(c => c.kind !== "notes");
  const res = await callAi("plan", {
    lines: numberedLines(segs),
    total: segs.length,
    courses: own.map(c => ({ name: c.name, chapters: (ix.sectionsByCourse[c.id] || []).map(s => s.title) })),
  });
  if (!res.ok) return res;
  return { ok: true, ...readPlan(res.data, { text, segs, courses: own }) };
}

/**
 * Rough cost and time for importing chapters of a paste. Notes are far denser
 * than book pages: a 10,000-character guide gave 26 concepts, a terse 2,200
 * characters 10 (measured, November 2026), so concepts are estimated from
 * characters, one per 250–500, and priced like ladders (lib/ai.js), plus
 * about 1.4 cents per 1,000 characters for finding the concepts.
 */
export function pasteEstimate(chapters, { writer = "thorough", batch = false } = {}) {
  const chosen = chapters.filter(c => c.include);
  const chars = chosen.reduce((n, c) => n + (c.to - c.from), 0);
  const find = (chars / 1000) * 0.014;
  const [lo] = ladderCost(chars / 500, { writer, batch });
  const [, hi] = ladderCost(chars / 250, { writer, batch });
  const round = (x) => Math.max(1, Math.round(x));
  return {
    chapters: chosen.length,
    chars,
    batch,
    dollars: [Math.max(0.01, lo + find), Math.max(0.01, hi + find)],
    minutes: batch ? [round(chosen.length * 1.2 + 8), round(chosen.length * 1.5 + 60)] : [round(chosen.length * 1.5 + 2), round(chosen.length * 2.5 + 4)],
  };
}

/**
 * The import for a sorted paste: the new courses to create, and one job whose
 * chapters (in the paste's order) each name their course and their place in
 * it. A course you named like an existing one goes into that one.
 */
export function pasteJob({ state, plan, bookId, title, device = null, now = Date.now() }) {
  const ix = index(state);
  const byName = new Map(state.courses.filter(c => c.kind !== "notes").map(c => [c.name.trim().toLowerCase(), c.id]));
  const created = [], chapters = [];
  for (const c of plan.courses) {
    const parts = c.parts.filter(p => p.include);
    if (!parts.length) continue;
    const name = String(c.name || "").trim() || "New course";
    let courseId = c.courseId && ix.course[c.courseId] ? c.courseId : byName.get(name.toLowerCase());
    if (!courseId) {
      const course = makeCourse({ name, createdAt: now }, state.courses.length + created.length);
      created.push(course);
      courseId = course.id;
      byName.set(name.toLowerCase(), courseId);
    }
    for (const p of parts) chapters.push({ title: p.title, from: p.from, to: p.to, courseId });
  }
  chapters.sort((a, b) => a.from - b.from);
  const next = {};
  for (const ch of chapters) {
    if (!(ch.courseId in next)) next[ch.courseId] = Math.max(-1, ...(ix.sectionsByCourse[ch.courseId] || []).map(s => s.order)) + 1;
    ch.order = next[ch.courseId]++;
  }
  const job = {
    id: uid("job"), source: "text", courseId: chapters[0]?.courseId ?? null, bookId, title: title || created[0]?.name || "Pasted notes", fileName: "",
    status: "running", baseOrder: 0, startedAt: now, deviceId: device?.id ?? null, deviceName: device?.name ?? "",
    chapters: chapters.map(c => ({ ...c, include: true, read: true, status: "pending" })),
  };
  return { job, courses: created };
}

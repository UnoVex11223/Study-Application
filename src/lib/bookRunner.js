// Runs a whole-book import. Chapters are read and their concepts extracted in
// reading order, so each chapter can point at earlier chapters' concepts as
// prerequisites and doesn't recreate them. Question writing for up to two
// chapters runs alongside. Chapters are added to the course in order, locked
// unless you've marked them read.
//
// Everything the runner needs is passed in, so it can be tested without React:
//   getState()          latest app state (may lag a render behind; the runner
//                       tracks its own progress and never relies on reading
//                       its own writes back)
//   act(type, payload)  dispatch
//   book                { text({ bookId, from, to }) }

import { extractMaterial, generateTasks, linkConcepts } from "./ai.js";
import { chapterImport } from "./book.js";
import { reducer } from "../state/reducer.js";

const MAX_WRITING = 2;       // chapters whose questions are being written at once
const STOP_AFTER_FAILURES = 2; // consecutive API failures before pausing the job
const MIN_TEXT = 300;        // characters; less means a scanned or empty page range

// Chapters claimed by a runner in this session. Guards against two runners
// (e.g. pause then quick resume) ever importing the same chapter.
const claimed = new Set();
const key = (jobId, i) => `${jobId}:${i}`;

export async function runBookJob({ jobId, getState, act, book }) {
  const findJob = () => getState()?.bookJobs?.find(j => j.id === jobId);
  const job = findJob();
  if (!job) return "missing";
  const { courseId, bookId } = job;

  const setChapter = (index, patch) => act("book/chapter", { id: jobId, index, patch });
  const stopped = () => findJob()?.status !== "running";
  const alsoKnown = [];          // names extracted earlier in this run, for extraction
  const imported = [];           // { id, name } imported earlier in this run, for prerequisites
  const writing = new Set();
  let chain = Promise.resolve(); // imports happen in chapter order
  let failures = 0, stopError = null;

  const fail = (i, error, { counts = true } = {}) => {
    claimed.delete(key(jobId, i));
    setChapter(i, { status: "failed", error });
    if (!counts) return;
    failures++;
    if (failures >= STOP_AFTER_FAILURES) stopError = error;
  };

  for (let i = 0; i < job.chapters.length; i++) {
    const ch = job.chapters[i];
    if (!ch.include || ch.status === "done" || ch.status === "failed" || claimed.has(key(jobId, i))) continue;
    while (writing.size >= MAX_WRITING) await Promise.race(writing);
    if (stopped() || stopError) break;
    claimed.add(key(jobId, i));

    setChapter(i, { status: "reading", error: "" });
    let text;
    try { text = await book.text({ bookId, from: ch.from, to: ch.to }); } catch (err) { text = { ok: false, error: err?.message }; }
    if (!text?.ok) { fail(i, text?.error || "Couldn't read these pages."); continue; }
    if (text.text.replace(/\[Page \d+\]/g, "").replace(/\s+/g, "").length < MIN_TEXT) {
      fail(i, "These pages have no readable text. A scanned PDF needs text recognition (OCR) first.", { counts: false });
      continue;
    }

    let ex;
    try {
      ex = await extractMaterial({ state: getState(), courseId, title: ch.title, location: `pp. ${ch.from}–${ch.to}`, text: text.text, alsoKnown });
    } catch (err) { ex = { ok: false, error: err?.message || "Something went wrong." }; }
    if (!ex.ok) { fail(i, ex.error); continue; }
    failures = 0;
    for (const s of ex.sections) for (const c of s.concepts) alsoKnown.push({ name: c.name, section: ch.title });
    const found = ex.sections.reduce((n, s) => n + s.concepts.filter(c => c.selected).length, 0);
    if (!found) {
      // Only minor details (e.g. a history chapter): nothing worth adding.
      setChapter(i, { status: "done", concepts: 0, questions: 0, error: "" });
      continue;
    }
    setChapter(i, { status: "writing", found });

    // Take this chapter's place in the import order now, before writing starts.
    const prev = chain;
    let release;
    chain = new Promise(r => { release = r; });
    const w = (async () => {
      let res;
      try { res = await generateTasks({ state: getState(), courseId, sections: ex.sections }); }
      catch (err) { res = { ok: false, error: err?.message || "Something went wrong." }; }
      await prev;
      try {
        if (!res.ok) { fail(i, res.error); return; }
        failures = 0;
        if (!getState()?.courses.some(c => c.id === courseId)) return; // course deleted meanwhile
        const live = findJob()?.chapters[i] ?? ch;
        const state = getState();
        const payload = chapterImport({
          state, courseId, chapter: ch, extraction: ex, groups: res.groups,
          order: job.baseOrder + i, locked: !live.read, alsoKnown: imported,
        });
        act("import", {
          payload,
          bookChapter: { id: jobId, index: i, patch: {
            status: "done", error: res.partial || "", sectionId: payload.sections[0]?.id ?? null,
            concepts: payload.concepts.length, questions: payload.items.length,
          } },
        });
        imported.push(...payload.concepts.map(c => ({ id: c.id, name: c.name })));
        // Connect the chapter to your other courses in the background.
        if (payload.concepts.length) {
          linkConcepts({ state: reducer(state, { type: "import", payload }), conceptIds: payload.concepts.map(c => c.id) })
            .then(r => { if (r.ok && r.edges.length) act("edges/add", { edges: r.edges }); })
            .catch(() => {});
        }
      } finally { release(); }
    })();
    writing.add(w);
    w.finally(() => writing.delete(w));
  }

  await Promise.all(writing);
  await chain;
  if (stopError) {
    act("book/patch", { id: jobId, patch: { status: "paused", error: stopError } });
    return "paused";
  }
  if (stopped()) return "stopped";
  act("book/patch", { id: jobId, patch: { status: "done", finishedAt: Date.now() } });
  return "done";
}

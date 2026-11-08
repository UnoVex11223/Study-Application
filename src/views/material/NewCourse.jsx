// A new course from a paste: drop in a guide or a set of notes, Claude sorts
// it into courses and chapters (one paste can make several courses, or add
// chapters to ones you have), you look the split over, and the rest happens
// in the background like a book import (lib/paste.js, lib/bookRunner.js).
// An empty course is still a click away.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { bookBridge } from "../../state/bookImport.jsx";
import { useSync } from "../../state/sync.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, PageHeader } from "../../ui/layout.jsx";
import { Notice, Spinner } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { makeCourse } from "../../lib/model.js";
import { aiAvailable, writerOf } from "../../lib/ai.js";
import { planPaste, pasteEstimate, pasteJob } from "../../lib/paste.js";
import { plural } from "../../lib/format.js";
import CourseForm from "../courses/CourseForm.jsx";

const money = (x) => (x < 0.995 ? `${Math.max(1, Math.round(x * 100))}¢` : `$${Math.round(x)}`);

export default function NewCourse() {
  const { state, act } = useStore();
  const nav = useNav();
  const device = useSync()?.device ?? null;
  const [text, setText] = useState("");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasKey, setHasKey] = useState(null);
  const [drag, setDrag] = useState(false);
  const [empty, setEmpty] = useState(false);
  const fileRef = useRef(null);
  const bridge = bookBridge();

  useEffect(() => { aiAvailable().then(setHasKey); }, []);

  const readFiles = (list) => {
    setError("");
    for (const f of list) {
      if (/\.pdf$/i.test(f.name)) { setError(`${f.name} is a PDF: use Import a book on the Courses page for it.`); continue; }
      if (!/\.(md|markdown|txt|text)$/i.test(f.name)) { setError(`${f.name} isn't a text or markdown file. Paste its text instead.`); continue; }
      const reader = new FileReader();
      reader.onload = () => setText(t => [t.trim(), String(reader.result).trim()].filter(Boolean).join("\n\n"));
      reader.readAsText(f);
    }
  };

  const sort = async () => {
    setError(""); setBusy(true);
    const res = await planPaste({ state, text });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setPlan(res);
  };

  const rename = (k, name) => setPlan(p => ({ ...p, courses: p.courses.map(c => (c.key === k ? { ...c, name } : c)) }));
  const toggle = (k, i) => setPlan(p => ({
    ...p, courses: p.courses.map(c => (c.key !== k ? c : { ...c, parts: c.parts.map((x, j) => (j === i ? { ...x, include: !x.include } : x)) })),
  }));

  const start = async () => {
    setError(""); setBusy(true);
    const saved = await bridge.saveText(text);
    setBusy(false);
    if (!saved?.ok) { setError(saved?.error || "Couldn't save the text."); return; }
    const { job, courses } = pasteJob({ state, plan, bookId: saved.bookId, title: plan.title, device });
    if (!job.chapters.length) { bridge.remove(saved.bookId); return; }
    act("book/start", { job, courses });
    const targets = [...new Set(job.chapters.map(c => c.courseId))];
    if (targets.length === 1) nav.go("course", { courseId: targets[0] });
    else nav.go("courses");
  };

  const createEmpty = (fields) => {
    const course = makeCourse(fields, state.courses.length);
    act("course/add", { course });
    nav.go("course", { courseId: course.id, fresh: true });
  };

  const back = { label: "Courses", onClick: () => (plan ? setPlan(null) : nav.go("courses")) };
  const chapters = plan ? plan.courses.flatMap(c => c.parts) : [];
  const est = pasteEstimate(chapters, { writer: writerOf(state), batch: state.settings.batchImports !== false });
  const names = new Set(state.courses.filter(c => c.kind !== "notes").map(c => c.name.trim().toLowerCase()));
  const fresh = plan ? new Set(plan.courses.filter(c => !c.courseId && c.parts.some(p => p.include) && !names.has(c.name.trim().toLowerCase())).map(c => c.name.trim().toLowerCase())).size : 0;

  return (
    <Page width="narrow">
      <PageHeader title="New course" back={back}/>

      {!bridge && <Notice>Making courses from a paste works in the desktop app.</Notice>}
      {bridge && hasKey === false && <Notice tone="warn" icon="alert">Add an Anthropic API key in Settings first. It's used to sort the paste and write the questions.</Notice>}
      {error && <Notice tone="warn" icon="alert">{error}</Notice>}

      {!plan && (
        <div className="panel panel-pad form">
          <textarea className="textarea source-text paste-text" value={text} onChange={e => setText(e.target.value)} autoFocus
            aria-label="What you want to learn"
            placeholder="Paste a guide, notes or a transcript. Tenax sorts it into courses and writes the questions."/>
          <div className={cx("dropzone", drag && "over")} role="button" tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); readFiles(e.dataTransfer.files); }}>
            <Icon name="upload"/><span>Or drop .md / .txt files</span>
            <input ref={fileRef} type="file" accept=".md,.markdown,.txt,.text" multiple hidden onChange={e => { readFiles(e.target.files); e.target.value = ""; }}/>
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={!text.trim() || busy || !bridge || hasKey === false} onClick={sort}>
              {busy ? <Spinner/> : <Icon name="sparkle"/>}{busy ? "Sorting…" : "Sort into courses"}
            </button>
            <span className="grow"/>
            <button className="link small" onClick={() => setEmpty(true)}>Start an empty course</button>
          </div>
        </div>
      )}

      {plan && (
        <>
          {plan.courses.map(c => (
            <div key={c.key} className="list paste-course">
              <div className="list-head paste-course-head">
                {c.courseId
                  ? <><strong className="grow ell">{c.name}</strong><span className="muted small">adds to this course</span></>
                  : <input className="input paste-course-name" value={c.name} aria-label="Course name" onChange={e => rename(c.key, e.target.value)}/>}
              </div>
              {c.parts.map((p, i) => (
                <label key={i} className={cx("list-row pick-row", !p.include && "off")}>
                  <input type="checkbox" checked={p.include} onChange={() => toggle(c.key, i)}/>
                  <span className="grow ell">{p.title}</span>
                </label>
              ))}
            </div>
          ))}
          {plan.skipped.length > 0 && (
            <details className="disclosure">
              <summary>Left out</summary>
              <ul className="bullets small muted">{plan.skipped.map((s, i) => <li key={i}>{s.title}{s.reason && ` (${s.reason})`}</li>)}</ul>
            </details>
          )}
          <p className="muted small">
            {est.chapters
              ? `In the background, about ${est.minutes[0]}–${est.minutes[1]} minutes; roughly ${money(est.dollars[0])}–${money(est.dollars[1])} of API usage${est.batch ? " (half-price batches)" : ""}.`
              : "Tick at least one chapter."}
          </p>
          <div className="row">
            <button className="btn btn-quiet" onClick={() => setPlan(null)}>Back</button>
            <span className="grow"/>
            <button className="btn btn-primary" disabled={!est.chapters || busy} onClick={start}>
              {busy && <Spinner/>}{fresh ? `Create ${plural(fresh, "course")}` : `Add ${plural(est.chapters, "chapter")}`}
            </button>
          </div>
        </>
      )}

      {empty && <CourseForm onSave={createEmpty} onClose={() => setEmpty(false)}/>}
    </Page>
  );
}

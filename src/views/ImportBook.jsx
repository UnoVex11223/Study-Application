// Import a whole book from its PDF: pick the chapters, say which you've read,
// and the rest happens in the background (see lib/bookRunner.js).

import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { bookBridge } from "../state/bookImport.jsx";
import { useNav } from "../ui/nav.js";
import { Notice, Spinner } from "../ui/ui.jsx";
import Icon from "../ui/Icon.jsx";
import { index, makeCourse, uid } from "../lib/model.js";
import { detectChapters, chaptersFromStarts, estimate } from "../lib/book.js";
import { aiAvailable } from "../lib/ai.js";

const cleanName = (file) => file.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

export default function ImportBook({ courseId: presetCourse }) {
  const { state, act } = useStore();
  const nav = useNav();
  const ix = index(state);
  const [book, setBook] = useState(null); // { bookId, name, pages, chapters, manual }
  const [starts, setStarts] = useState([{ title: "", from: "" }]);
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(presetCourse || "new");
  const [name, setName] = useState("");
  const [hasKey, setHasKey] = useState(null);
  const saved = useRef(null);
  const started = useRef(false);
  const fileRef = useRef(null);

  useEffect(() => { aiAvailable().then(setHasKey); }, []);
  // Leaving without importing deletes the saved copy of the PDF.
  useEffect(() => () => { if (!started.current && saved.current) bookBridge()?.remove(saved.current); }, []);

  const bridge = bookBridge();

  const open = async (file) => {
    setError("");
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { setError(`${file.name} isn't a PDF.`); return; }
    setLoading(true);
    const res = await bridge.save(await file.arrayBuffer());
    setLoading(false);
    if (!res.ok) { setError(`${file.name}: ${res.error}`); return; }
    if (saved.current) bridge.remove(saved.current);
    saved.current = res.bookId;
    const chapters = detectChapters(res.outline, res.pages).map(c => ({ ...c, read: false }));
    setBook({ bookId: res.bookId, name: file.name, pages: res.pages, chapters, manual: chapters.length === 0 });
    if (!name) setName(res.title || cleanName(file.name));
  };

  const chapters = !book ? [] : book.manual
    ? chaptersFromStarts(starts.filter(r => Number(r.from) >= 1).map(r => ({ title: r.title, from: Number(r.from) })), book.pages).map(c => ({ ...c, read: false }))
    : book.chapters;
  const est = estimate(chapters);

  const patchChapter = (i, patch) => setBook(b => ({ ...b, chapters: b.chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const setAll = (include) => setBook(b => ({ ...b, chapters: b.chapters.map(c => ({ ...c, include })) }));

  const start = () => {
    let course = null, courseId = target;
    if (target === "new") {
      course = makeCourse({ name: name.trim() || cleanName(book.name) }, state.courses.length);
      courseId = course.id;
    }
    const baseOrder = Math.max(-1, ...(ix.sectionsByCourse[courseId] || []).map(s => s.order)) + 1;
    const job = {
      id: uid("job"), courseId, bookId: book.bookId, title: (target === "new" ? name.trim() : "") || cleanName(book.name), fileName: book.name,
      status: "running", baseOrder, startedAt: Date.now(),
      chapters: chapters.map(c => ({ title: c.title, from: c.from, to: c.to, include: c.include, read: c.read, status: "pending" })),
    };
    started.current = true;
    act("book/start", { job, course });
    nav.go("course", { courseId });
  };

  const back = presetCourse ? () => nav.go("course", { courseId: presetCourse }) : () => nav.go("courses");

  return (
    <div className="page page-narrow">
      <button className="crumb" onClick={back}><Icon name="back" size={14}/>{presetCourse ? ix.course[presetCourse]?.name : "Courses"}</button>
      <div className="page-head">
        <div>
          <h1>Import a book</h1>
          <p className="page-sub">The whole book at once: concepts, a prerequisite map and questions for every chapter.</p>
        </div>
      </div>

      {!bridge && <Notice icon="info">Book import runs in the desktop app.</Notice>}
      {bridge && hasKey === false && <Notice tone="warn" icon="alert">Add an Anthropic API key in Settings first. Importing a book uses it to find concepts and write questions.</Notice>}
      {error && <div style={{ marginBottom: 14 }}><Notice tone="warn" icon="alert">{error}</Notice></div>}

      {bridge && !book && (
        <div
          className={`dropzone book-drop${drag ? " over" : ""}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); open(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          role="button" tabIndex={0}
        >
          {loading ? <div className="progress-line" style={{ justifyContent: "center" }}><Spinner/>Reading the table of contents…</div> : (
            <>
              <Icon name="book" size={26}/>
              <strong>Drop the book's PDF here</strong>
              <span className="muted small">or click to choose it. Chapters are found from the PDF's table of contents.</span>
            </>
          )}
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => open(e.target.files[0])}/>
        </div>
      )}

      {book && (
        <>
          <div className="panel panel-pad book-source">
            <Icon name="book" size={18}/>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="list-title">{book.name}</div>
              <div className="section-stats"><span>{book.pages} pages</span>{!book.manual && <span>{book.chapters.length} entries in its table of contents</span>}</div>
            </div>
            <button className="btn btn-sm btn-quiet" onClick={() => { bridge.remove(book.bookId); saved.current = null; setBook(null); }}>Choose another</button>
          </div>

          <div className="panel panel-pad" style={{ marginTop: 14 }}>
            <div className="field">
              <label htmlFor="bk-course">Add to</label>
              <select id="bk-course" className="select" value={target} onChange={e => setTarget(e.target.value)}>
                <option value="new">A new course</option>
                {state.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {target === "new" && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="bk-name">Course name</label>
                <input id="bk-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. C Programming: A Modern Approach"/>
              </div>
            )}
          </div>

          <div className="row" style={{ margin: "26px 0 10px" }}>
            <h2 className="h grow" style={{ margin: 0 }}>Chapters</h2>
            {!book.manual && <>
              <button className="btn btn-sm btn-quiet" onClick={() => setAll(true)}>Select all</button>
              <button className="btn btn-sm btn-quiet" onClick={() => setAll(false)}>Select none</button>
            </>}
          </div>

          {book.manual ? (
            <div className="panel panel-pad">
              <p className="muted small" style={{ marginTop: 0 }}>This PDF has no table of contents, so add each chapter's title and the PDF page it starts on (the page number your PDF viewer shows, not the one printed on the page). Each chapter runs until the next one starts.</p>
              <div className="stack" style={{ gap: 8 }}>
                {starts.map((r, i) => (
                  <div key={i} className="row" style={{ gap: 8 }}>
                    <input className="input grow" placeholder={`Chapter ${i + 1} title`} value={r.title} onChange={e => setStarts(s => s.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}/>
                    <input className="input" style={{ width: 110 }} type="number" min={1} max={book.pages} placeholder="Start page" value={r.from} onChange={e => setStarts(s => s.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}/>
                    <button className="btn btn-quiet btn-sm btn-icon" title="Remove" onClick={() => setStarts(s => s.filter((_, j) => j !== i))}><Icon name="x" size={14}/></button>
                  </div>
                ))}
              </div>
              <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setStarts(s => [...s, { title: "", from: "" }])}><Icon name="plus" size={13}/>Add chapter</button>
            </div>
          ) : (
            <div className="panel chapter-list">
              <div className="chapter-row chapter-head">
                <span/>
                <span>Chapter</span>
                <span>Pages</span>
                <span>Already read</span>
              </div>
              {book.chapters.map((c, i) => (
                <div key={i} className={`chapter-row${c.include ? "" : " off"}`}>
                  <input type="checkbox" checked={c.include} onChange={() => patchChapter(i, { include: !c.include })} aria-label={`Import ${c.title}`}/>
                  <span className="chapter-title">{c.title}</span>
                  <span className="num muted small">{c.from}–{c.to}</span>
                  <label className="chapter-read">
                    <input type="checkbox" checked={c.read} disabled={!c.include} onChange={() => patchChapter(i, { read: !c.read })}/>
                    <span className="small">{c.read ? "Unlocked" : "Locked"}</span>
                  </label>
                </div>
              ))}
            </div>
          )}

          <div className="panel panel-pad book-estimate">
            {est.chapters ? (
              <>
                <div><strong>{est.chapters} chapter{est.chapters === 1 ? "" : "s"}, {est.pages} pages.</strong> Takes about {est.minutes[0]}–{est.minutes[1]} minutes in the background and roughly ${est.dollars[0]}–{est.dollars[1]} of API usage.</div>
                <p className="muted small" style={{ margin: "6px 0 0" }}>
                  Chapters are ready one by one, in order, and you can keep studying meanwhile. Closing the app pauses the import until you open it again.
                  Chapters you haven't read stay locked: nothing from them comes up until you mark them read, and then their concepts are introduced a few a day.
                </p>
              </>
            ) : <span className="muted">Pick at least one chapter.</span>}
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn btn-quiet" onClick={back}>Cancel</button>
            <div className="grow"/>
            <button className="btn btn-primary" disabled={!est.chapters || hasKey === false || (target === "new" && !name.trim())} onClick={start}>
              <Icon name="book" size={15}/>Import {est.chapters} chapter{est.chapters === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

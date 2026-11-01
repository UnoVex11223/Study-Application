// Import a whole book from its PDF: pick the chapters, say which you've read,
// and the rest happens in the background (see lib/bookRunner.js).

import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { bookBridge } from "../../state/bookImport.jsx";
import { useSync } from "../../state/sync.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, PageHeader, Section } from "../../ui/layout.jsx";
import { Field } from "../../ui/controls.jsx";
import { Notice, Spinner } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { index, makeCourse, uid } from "../../lib/model.js";
import { detectChapters, chaptersFromStarts, estimate } from "../../lib/book.js";
import { aiAvailable } from "../../lib/ai.js";
import { plural } from "../../lib/format.js";

const cleanName = (file) => file.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/** The import's record (state/bookImport.jsx runs it): which chapters go into which course, started now on this computer. */
function makeJob({ courseId, book, title, baseOrder, device, chapters }) {
  return {
    id: uid("job"), courseId, bookId: book.bookId, title, fileName: book.name,
    status: "running", baseOrder, startedAt: Date.now(), deviceId: device?.id ?? null, deviceName: device?.name ?? "",
    chapters: chapters.map(c => ({ title: c.title, from: c.from, to: c.to, include: c.include, read: c.read, status: "pending" })),
  };
}

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
  const bridge = bookBridge();
  const device = useSync()?.device ?? null;

  useEffect(() => { aiAvailable().then(setHasKey); }, []);
  // Leaving without importing deletes the saved copy of the PDF.
  useEffect(() => () => { if (!started.current && saved.current) bookBridge()?.remove(saved.current); }, []);

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
  const chooseAnother = () => { bridge.remove(book.bookId); saved.current = null; setBook(null); };

  const chapters = !book ? [] : book.manual
    ? chaptersFromStarts(starts.filter(r => Number(r.from) >= 1).map(r => ({ title: r.title, from: Number(r.from) })), book.pages).map(c => ({ ...c, read: false }))
    : book.chapters;
  const est = estimate(chapters, { batch: state.settings.batchImports !== false });

  const patchChapter = (i, patch) => setBook(b => ({ ...b, chapters: b.chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const setAll = (include) => setBook(b => ({ ...b, chapters: b.chapters.map(c => ({ ...c, include })) }));
  const patchStart = (i, patch) => setStarts(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const start = () => {
    let course = null, courseId = target;
    if (target === "new") {
      course = makeCourse({ name: name.trim() || cleanName(book.name) }, state.courses.length);
      courseId = course.id;
    }
    const baseOrder = Math.max(-1, ...(ix.sectionsByCourse[courseId] || []).map(s => s.order)) + 1;
    const title = (target === "new" ? name.trim() : "") || cleanName(book.name);
    const job = makeJob({ courseId, book, title, baseOrder, device, chapters });
    started.current = true;
    act("book/start", { job, course });
    nav.go("course", { courseId });
  };

  const back = presetCourse
    ? { label: ix.course[presetCourse]?.name, onClick: () => nav.go("course", { courseId: presetCourse }) }
    : { label: "Courses", onClick: () => nav.go("courses") };

  return (
    <Page width="narrow">
      <PageHeader title="Import a book" back={back}/>

      {!bridge && <Notice>Book import runs in the desktop app.</Notice>}
      {bridge && hasKey === false && <Notice tone="warn" icon="alert">Add an Anthropic API key in Settings first. Importing a book uses it to find concepts and write questions.</Notice>}
      {error && <Notice tone="warn" icon="alert">{error}</Notice>}

      {bridge && !book && (
        <div className={cx("dropzone book-drop", drag && "over")} role="button" tabIndex={0}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); open(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          onKeyDown={e => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}>
          {loading ? <div className="busy"><Spinner/>Reading the table of contents…</div> : (
            <>
              <Icon name="book" size={24}/>
              <strong>Drop the book's PDF here</strong>
              <span className="muted small">or click to choose it</span>
            </>
          )}
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => open(e.target.files[0])}/>
        </div>
      )}

      {book && (
        <>
          <div className="panel panel-pad stack gap-5">
            <div className="row gap-3">
              <Icon name="book"/>
              <div className="grow stack gap-1">
                <div className="list-title ell">{book.name}</div>
                <div className="meta"><span className="num">{plural(book.pages, "page")}</span>{!book.manual && <span>{plural(book.chapters.length, "entry", "entries")} in its table of contents</span>}</div>
              </div>
              <button className="btn btn-sm btn-quiet" onClick={chooseAnother}>Choose another</button>
            </div>
            <div className="form-row">
              <Field label="Add to" htmlFor="bk-course">
                <select id="bk-course" className="select" value={target} onChange={e => setTarget(e.target.value)}>
                  <option value="new">A new course</option>
                  {state.courses.filter(c => c.kind !== "notes").map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              {target === "new" && (
                <Field label="Course name" htmlFor="bk-name">
                  <input id="bk-name" className="input" value={name} onChange={e => setName(e.target.value)}/>
                </Field>
              )}
            </div>
          </div>

          <Section title="Chapters" actions={!book.manual && <>
            <button className="btn btn-sm btn-quiet" onClick={() => setAll(true)}>Select all</button>
            <button className="btn btn-sm btn-quiet" onClick={() => setAll(false)}>Select none</button>
          </>}>
            {book.manual ? (
              <div className="panel panel-pad stack">
                <p className="help">This PDF has no table of contents, so add each chapter's title and the PDF page it starts on (the page number your PDF viewer shows, not the one printed on the page). Each chapter runs until the next one starts.</p>
                <div className="start-row caption"><span>Title</span><span>Start page</span><span/></div>
                {starts.map((r, i) => (
                  <div key={i} className="start-row">
                    <input className="input" aria-label={`Chapter ${i + 1} title`} value={r.title} onChange={e => patchStart(i, { title: e.target.value })}/>
                    <input className="input" type="number" min={1} max={book.pages} aria-label={`Chapter ${i + 1} start page`} value={r.from} onChange={e => patchStart(i, { from: e.target.value })}/>
                    <button className="btn btn-quiet btn-icon" title="Remove" aria-label="Remove chapter" onClick={() => setStarts(s => s.filter((_, j) => j !== i))}><Icon name="x"/></button>
                  </div>
                ))}
                <div><button className="btn btn-sm" onClick={() => setStarts(s => [...s, { title: "", from: "" }])}><Icon name="plus"/>Add chapter</button></div>
              </div>
            ) : (
              <div className="list">
                <div className="chapter-row chapter-head"><span/><span>Chapter</span><span>Pages</span><span>Already read</span></div>
                {book.chapters.map((c, i) => (
                  <div key={i} className={cx("chapter-row", !c.include && "off")}>
                    <input type="checkbox" checked={c.include} onChange={() => patchChapter(i, { include: !c.include })} aria-label={`Import ${c.title}`}/>
                    <span className="ell">{c.title}</span>
                    <span className="num muted small">{c.from}–{c.to}</span>
                    <label className="check-label">
                      <input type="checkbox" checked={c.read} disabled={!c.include} onChange={() => patchChapter(i, { read: !c.read })}/>
                      {c.read ? "Unlocked" : "Locked"}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div className="panel panel-pad">
            {est.chapters ? (
              <p><strong>{plural(est.chapters, "chapter")}, {plural(est.pages, "page")}.</strong> Takes about {est.minutes[0]}–{est.minutes[1]} minutes in the background and roughly ${est.dollars[0]}–{est.dollars[1]} of API usage{est.batch ? " (half-price batches)" : ""}.</p>
            ) : <p className="muted">Pick at least one chapter.</p>}
          </div>

          <div className="row">
            <button className="btn btn-quiet" onClick={back.onClick}>Cancel</button>
            <span className="grow"/>
            <button className="btn btn-primary" disabled={!est.chapters || hasKey === false || (target === "new" && !name.trim())} onClick={start}>
              <Icon name="book"/>Import {plural(est.chapters, "chapter")}
            </button>
          </div>
        </>
      )}
    </Page>
  );
}

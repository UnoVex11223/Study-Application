// Add material to a course, in three steps:
//   1. Source: paste text, drop notes, or pick a chapter from a book's PDF
//   2. Choose concepts: what Claude found worth remembering (untick what you don't need)
//   3. Review questions: what passed the quality check (keep or leave out each one)
// Questions are written in the background as soon as concepts are found, so
// most are ready by the time you've looked the list over.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Page, PageHeader } from "../../ui/layout.jsx";
import { Field } from "../../ui/controls.jsx";
import { Bar, ImportanceTag, Notice, Spinner } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { index } from "../../lib/model.js";
import { aiBridge, aiAvailable, extractMaterial, generateTasks, buildImport, linkConcepts } from "../../lib/ai.js";
import { plural } from "../../lib/format.js";
import QuestionRow from "../concepts/QuestionRow.jsx";

const STEPS = ["Source", "Choose concepts", "Review questions"];
const selectedKeys = (ex) => ex.sections.flatMap(s => s.concepts.filter(c => c.selected).map(c => c.key));
const pdfApi = () => (typeof window !== "undefined" ? window.tenax?.pdf : null);

/** Where you are in the three steps. */
function Steps({ step, done }) {
  return (
    <ol className="steps">
      {STEPS.map((s, i) => <li key={s} className={cx(i === step && !done && "on", (i < step || done) && "done")}>{i + 1}. {s}</li>)}
    </ol>
  );
}

/** A book's PDF: pick a chapter from its contents (or type pages) and load its text. */
function PdfPicker({ book, setBook, onLoad, onRemove }) {
  if (book.loading && !book.pages) return <div className="pdf-picker busy"><Spinner/>Opening {book.name}…</div>;
  return (
    <div className="pdf-picker stack">
      <div className="row">
        <strong className="grow ell">{book.name}</strong>
        <span className="muted small num">{plural(book.pages, "page")}</span>
        <button className="btn btn-quiet btn-sm btn-icon" onClick={onRemove} aria-label="Remove PDF"><Icon name="x"/></button>
      </div>
      <div className="pdf-range">
        {book.outline.length > 0 && (
          <Field label="Chapter" htmlFor="am-ch">
            <select id="am-ch" className="select" value={book.pick} onChange={e => setBook(b => {
              const idx = e.target.value === "" ? "" : Number(e.target.value);
              const o = b.outline[idx];
              return { ...b, pick: idx, from: o ? o.page : b.from, to: o ? o.end : b.to };
            })}>
              <option value="">Choose from the book's contents</option>
              {book.outline.map((o, i) => <option key={i} value={i}>{o.depth ? " " : ""}{o.title} (p. {o.page})</option>)}
            </select>
          </Field>
        )}
        <Field label="From page" htmlFor="am-from">
          <input id="am-from" className="input" type="number" min={1} max={book.pages} value={book.from} onChange={e => setBook(b => ({ ...b, from: e.target.value }))}/>
        </Field>
        <Field label="To page" htmlFor="am-to">
          <input id="am-to" className="input" type="number" min={1} max={book.pages} value={book.to} onChange={e => setBook(b => ({ ...b, to: e.target.value }))}/>
        </Field>
        <button className="btn" onClick={onLoad} disabled={book.loading || !(Number(book.to) >= Number(book.from))}>
          {book.loading && <Spinner/>}Load these pages
        </button>
      </div>
    </div>
  );
}

export default function AddMaterial({ courseId }) {
  const { state, act } = useStore();
  const nav = useNav();
  const ix = index(state);
  const course = ix.course[courseId];

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [extraction, setExtraction] = useState(null);
  const [result, setResult] = useState(null);
  const [review, setReview] = useState(null); // { groups, written, reviewed, partial }
  const [linkState, setLinkState] = useState(null);
  const [hasKey, setHasKey] = useState(null);
  const [book, setBook] = useState(null); // { name, data, pages, outline, pick, from, to, loading }
  const fileRef = useRef(null);
  // Questions are written in the background as soon as concepts are found.
  // `ready` holds finished groups by concept key; `running` is the background run, if any.
  const ready = useRef(new Map());
  const running = useRef(null);

  useEffect(() => { aiAvailable().then(setHasKey); }, []);
  if (!course) return null;

  const ai = Boolean(aiBridge());
  const source = [text, ...files.map(f => `# ${f.name}\n\n${f.content}`)].filter(s => s.trim()).join("\n\n");

  // ── Step 1: the source ──────────────────────────────────────────────────
  const openPdf = async (f) => {
    if (!pdfApi()) { setError("PDF import works in the desktop app. Paste the chapter's text instead."); return; }
    setError("");
    setBook({ name: f.name, loading: true });
    const data = await f.arrayBuffer();
    const res = await pdfApi().outline(data);
    if (!res.ok) { setBook(null); setError(`${f.name}: ${res.error}`); return; }
    setBook({ name: f.name, data, pages: res.pages, outline: res.outline, pick: "", from: 1, to: Math.min(res.pages, 20) });
  };

  const loadPages = async () => {
    setBook(b => ({ ...b, loading: true }));
    const res = await pdfApi().text({ data: book.data, from: Number(book.from), to: Number(book.to) });
    setBook(b => ({ ...b, loading: false }));
    if (!res.ok) { setError(res.error); return; }
    setText(res.text);
    const o = book.outline?.[book.pick];
    if (o && !title.trim()) setTitle(o.title);
    setLocation(res.from === res.to ? `p. ${res.from}` : `pp. ${res.from}–${res.to}`);
  };

  const readFiles = (list) => {
    for (const f of list) {
      if (/\.pdf$/i.test(f.name)) { openPdf(f); continue; }
      if (!/\.(md|markdown|txt|text)$/i.test(f.name)) { setError(`${f.name} isn't a PDF, text or markdown file. Paste its text instead.`); continue; }
      const reader = new FileReader();
      reader.onload = () => setFiles(prev => [...prev.filter(x => x.name !== f.name), { name: f.name, content: String(reader.result) }]);
      reader.readAsText(f);
    }
  };

  // ── Step 2: concepts ────────────────────────────────────────────────────
  const extract = async () => {
    setError(""); setStep(1);
    setBusy({ label: "Reading the material and picking out what's worth remembering" });
    const res = await extractMaterial({
      state, courseId, title: title.trim(), location: location.trim(), text: source,
      onProgress: (p) => p.parts > 1 && setBusy({ label: `Reading part ${p.part} of ${p.parts}` }),
    });
    setBusy(null);
    ready.current = new Map(); running.current = null;
    if (!res.ok) { setError(res.error); setStep(0); return; }
    setExtraction(res);
    if (!title.trim() && res.title) setTitle(res.title);
    writeInBackground(res);
  };

  // Start writing questions for the concepts that are ticked by default.
  const writeInBackground = (ex) => {
    const run = { keys: new Set(selectedKeys(ex)), progress: null, listen: null };
    run.promise = generateTasks({
      state, courseId, sections: ex.sections,
      onProgress: (p) => { run.progress = p; run.listen?.(); },
    }).then((res) => {
      if (running.current === run && res.ok) for (const g of res.groups) ready.current.set(g.conceptKey, g);
      return res;
    });
    running.current = run;
  };

  const toggleConcept = (si, ci) => setExtraction(x => ({
    ...x, sections: x.sections.map((s, i) => (i !== si ? s : { ...s, concepts: s.concepts.map((c, j) => (j !== ci ? c : { ...c, selected: !c.selected })) })),
  }));
  const selectedCount = extraction ? extraction.sections.reduce((n, s) => n + s.concepts.filter(c => c.selected).length, 0) : 0;
  const totalCount = extraction ? extraction.sections.reduce((n, s) => n + s.concepts.length, 0) : 0;

  // ── Step 3: questions ───────────────────────────────────────────────────
  const create = async () => {
    setError(""); setStep(2);
    const wanted = selectedKeys(extraction);
    const bg = running.current;
    const onlyKeys = (keys) => extraction.sections.map(s => ({ ...s, concepts: s.concepts.map(c => ({ ...c, selected: keys.has(c.key) })) }));

    // Progress across the background run and anything written now.
    const runs = [];
    const show = () => {
      const sum = (f) => runs.reduce((n, r) => n + (r.progress?.[f] ?? 0), 0);
      setBusy({ label: "Writing and reviewing questions", done: sum("done"), total: sum("total"), passed: sum("passed") });
    };
    const write = (keys) => {
      const run = { progress: null };
      runs.push(run);
      return generateTasks({ state, courseId, sections: onlyKeys(keys), onProgress: (p) => { run.progress = p; show(); } })
        .then((res) => { if (res.ok) for (const g of res.groups) ready.current.set(g.conceptKey, g); return res; });
    };

    const waiting = bg && wanted.some(k => bg.keys.has(k) && !ready.current.has(k));
    if (waiting) { runs.push(bg); bg.listen = show; }
    const fresh = new Set(wanted.filter(k => !ready.current.has(k) && !(waiting && bg.keys.has(k))));
    show();
    const results = await Promise.all([waiting ? bg.promise : null, fresh.size ? write(fresh) : null]);

    // Anything still missing (a failed group) gets one more try now.
    const missing = new Set(wanted.filter(k => !ready.current.has(k)));
    const last = missing.size ? await write(missing) : null;
    if (bg) bg.listen = null;
    setBusy(null);

    const groups = wanted.map(k => ready.current.get(k)).filter(Boolean);
    const failure = [last, ...results].find(r => r && !r.ok)?.error ?? last?.partial ?? null;
    if (!groups.length) { setError(failure || "No questions could be written."); setStep(1); return; }
    setReview({
      groups,
      written: groups.reduce((n, g) => n + g.kept.length + g.dropped.length, 0),
      reviewed: groups.every(g => g.reviewed !== false),
      partial: groups.length < wanted.length ? failure : null,
    });
  };

  const toggleQuestion = (gi, list, qi) => setReview(r => ({
    ...r,
    groups: r.groups.map((g, i) => (i !== gi ? g : { ...g, [list]: g[list].map((q, j) => (j !== qi ? q : { ...q, selected: !q.selected })) })),
  }));
  const chosenQuestions = review ? review.groups.reduce((n, g) => n + [...g.kept, ...g.dropped].filter(q => q.selected).length, 0) : 0;
  const chosenConcepts = review ? review.groups.filter(g => [...g.kept, ...g.dropped].some(q => q.selected)).length : 0;
  const passed = review ? review.groups.reduce((n, g) => n + g.kept.length, 0) : 0;

  const save = async () => {
    const label = [title.trim() || extraction.title, location.trim()].filter(Boolean).join(", ");
    const payload = buildImport({ state, courseId, extraction, groups: review.groups, sourceLabel: label });
    act("import", { payload });
    setResult({ ...payload, partial: review.partial });
    setReview(null);

    // Connect the new concepts to everything else you know, in the background.
    const predicted = {
      ...state,
      sections: [...state.sections, ...payload.sections],
      concepts: [...state.concepts, ...payload.concepts],
      items: [...state.items, ...payload.items],
      edges: [...state.edges, ...payload.edges],
    };
    if (state.concepts.length) {
      setLinkState("working");
      const linked = await linkConcepts({ state: predicted, conceptIds: payload.concepts.map(c => c.id) });
      if (linked.ok) { act("edges/add", { edges: linked.edges }); setLinkState(linked.edges.length); }
      else setLinkState("failed");
    }
  };

  // Keep an opened PDF around so the next chapter is one click away.
  const reset = () => {
    ready.current = new Map(); running.current = null;
    setStep(0); setTitle(""); setLocation(""); setText(""); setFiles([]); setExtraction(null); setResult(null); setReview(null); setLinkState(null); setError("");
    setBook(b => {
      if (!b?.outline) return b;
      const next = typeof b.pick === "number" ? b.outline.findIndex((o, i) => i > b.pick && o.depth <= b.outline[b.pick].depth) : -1;
      return next >= 0 ? { ...b, pick: next, from: b.outline[next].page, to: b.outline[next].end } : { ...b, pick: "" };
    });
  };

  const sectionTitles = review ? [...new Set(review.groups.map(g => g.sectionTitle))] : [];

  return (
    <Page width="narrow">
      <PageHeader title="Add material" back={{ label: course.name, onClick: () => nav.go("course", { courseId }) }}
        actions={ai && <button className="btn" onClick={() => nav.go("book", { courseId })}><Icon name="book"/>Import a whole book</button>}>
        <Steps step={step} done={Boolean(result)}/>
      </PageHeader>

      {error && <Notice tone="bad" icon="alert">{error}</Notice>}
      {!ai && step === 0 && <Notice>Concept extraction runs in the desktop app. Here you can still write questions yourself from the course page.</Notice>}
      {ai && hasKey === false && step === 0 && (
        <Notice tone="warn" icon="alert">Add your Anthropic API key in <button className="link" onClick={() => nav.go("settings")}>Settings</button> to extract concepts automatically.</Notice>
      )}

      {step === 0 && (
        <div className="panel panel-pad form">
          <div className="form-row source-row">
            <Field label="What is it?" htmlFor="am-title">
              <input id="am-title" className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Chapter 7: Pointers"/>
            </Field>
            <Field label="Pages or timestamps" htmlFor="am-loc">
              <input id="am-loc" className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="pp. 241–268"/>
            </Field>
          </div>
          <Field label="Text" htmlFor="am-text">
            <textarea id="am-text" className="textarea source-text" value={text} onChange={e => setText(e.target.value)}
              placeholder="Paste the chapter, transcript or notes you want to remember"/>
          </Field>
          <div className={cx("dropzone", drag && "over")} role="button" tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); readFiles(e.dataTransfer.files); }}>
            <Icon name="upload"/><span>Or drop a PDF of the book, or .md / .txt notes</span>
            <input ref={fileRef} type="file" accept=".pdf,.md,.markdown,.txt,.text" multiple hidden onChange={e => { readFiles(e.target.files); e.target.value = ""; }}/>
          </div>
          {book && <PdfPicker book={book} setBook={setBook} onLoad={loadPages} onRemove={() => setBook(null)}/>}
          {files.length > 0 && (
            <div className="row wrap">
              {files.map(f => (
                <span key={f.name} className="chip">{f.name}
                  <button className="btn btn-quiet btn-sm btn-icon" onClick={() => setFiles(p => p.filter(x => x.name !== f.name))} aria-label={`Remove ${f.name}`}><Icon name="x"/></button>
                </span>
              ))}
            </div>
          )}
          <div className="row">
            <button className="btn btn-primary" disabled={!source.trim() || !ai || hasKey === false} onClick={extract}><Icon name="sparkle"/>Find key concepts</button>
            {source.length > 0 && <span className="muted small num">{Math.round(source.length / 1000)}k characters</span>}
          </div>
        </div>
      )}

      {busy && (
        <div className="panel panel-pad stack">
          <div className="busy"><Spinner/>{busy.label}…</div>
          {busy.total > 0 && (
            <>
              <Bar value={busy.done / busy.total} thin/>
              <p className="muted small num">{busy.done} of {busy.total} concept groups done{busy.passed ? `, ${plural(busy.passed, "question")} passed so far` : ""}</p>
            </>
          )}
        </div>
      )}

      {step === 1 && !busy && extraction && (
        <>
          <p><strong>{selectedCount} of {totalCount} concepts selected.</strong> <span className="muted">Details are left out by default. Untick anything you don't need to remember.</span></p>
          {extraction.partial && <Notice tone="warn" icon="alert">Only part of the material was processed: {extraction.partial}</Notice>}
          {extraction.gaps?.length > 0 && (
            <Notice tone="warn" icon="alert">
              <strong>Some information may have been lost when the text was copied:</strong>
              <ul className="bullets">{extraction.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </Notice>
          )}
          {extraction.sections.map((s, si) => (
            <div key={si} className="list">
              <div className="list-head">{s.title}</div>
              {s.concepts.map((c, ci) => (
                <label key={c.key} className={cx("list-row top pick-row", !c.selected && "off")}>
                  <input type="checkbox" checked={c.selected} onChange={() => toggleConcept(si, ci)}/>
                  <div className="grow stack gap-1">
                    <div className="list-title">{c.name}</div>
                    <Markdown className="small muted">{c.summary}</Markdown>
                    {c.importance_reason && <div className="small muted"><em>{c.importance_reason}</em></div>}
                  </div>
                  <ImportanceTag importance={c.importance}/>
                </label>
              ))}
            </div>
          ))}
          <div className="row">
            <button className="btn btn-quiet" onClick={() => setStep(0)}>Back</button>
            <span className="grow"/>
            <button className="btn btn-primary" disabled={!selectedCount} onClick={create}>Write questions for {plural(selectedCount, "concept")}</button>
          </div>
        </>
      )}

      {step === 2 && review && !busy && !result && (
        <>
          <h2 className="step-title">{passed} of {review.written} questions passed the quality check</h2>
          {!review.reviewed && <Notice tone="warn" icon="alert">The quality review couldn't run for part of this material, so only the rule checks were applied there. Look those questions over before adding them.</Notice>}
          {review.partial && <Notice tone="warn" icon="alert">Some sections didn't get questions: {review.partial}</Notice>}
          {sectionTitles.map(sectionTitle => (
            <div key={sectionTitle} className="list">
              <div className="list-head">{sectionTitle}</div>
              {review.groups.map((g, gi) => g.sectionTitle !== sectionTitle ? null : (
                <div key={g.conceptKey} className="review-concept stack gap-2">
                  <div className="row"><strong className="grow">{g.conceptName}</strong><ImportanceTag importance={g.importance}/></div>
                  {g.kept.map((q, qi) => <QuestionRow key={q.id} q={q} onToggle={() => toggleQuestion(gi, "kept", qi)}/>)}
                  {!g.kept.length && <p className="small muted">No question passed for this concept, so it won't be added unless you keep one below.</p>}
                  {g.dropped.length > 0 && (
                    <details className="disclosure">
                      <summary>Filtered out ({g.dropped.length})</summary>
                      <div className="stack gap-2">
                        {g.dropped.map((q, qi) => <QuestionRow key={q.id} q={q} dropped onToggle={() => toggleQuestion(gi, "dropped", qi)}/>)}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ))}
          <div className="row">
            <button className="btn btn-quiet" onClick={() => { setReview(null); setStep(1); }}>Back to concepts</button>
            <span className="grow"/>
            <button className="btn btn-primary" disabled={!chosenQuestions} onClick={save}>Add {plural(chosenQuestions, "question")} for {plural(chosenConcepts, "concept")}</button>
          </div>
        </>
      )}

      {result && !busy && (
        <article className="result">
          <div className="result-label">Added to {course.name}</div>
          <div className="result-title">{plural(result.concepts.length, "concept")}, {plural(result.items.length, "question")}</div>
          <p className="result-text">They'll be introduced gradually, up to {plural(state.settings.maxNewPerDay, "new concept")} a day across your courses, prerequisites first.</p>
          {linkState === "working" && <p className="result-text busy"><Spinner/>Looking for connections to your other courses…</p>}
          {typeof linkState === "number" && <p className="result-text">{linkState ? `Found ${plural(linkState, "connection")} to things you already know.` : "No strong connections to your other courses yet."}</p>}
          {linkState === "failed" && <p className="result-text">Couldn't look for connections this time.</p>}
          <div className="row">
            <button className="btn btn-primary" onClick={() => nav.go("course", { courseId })}>View course</button>
            <button className="btn" onClick={reset}>Add another chapter</button>
          </div>
        </article>
      )}
    </Page>
  );
}

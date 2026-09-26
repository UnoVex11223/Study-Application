import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { ImportanceTag, Notice, Spinner } from "../ui/ui.jsx";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import Markdown from "../ui/Markdown.jsx";
import { index } from "../lib/model.js";
import { aiBridge, aiAvailable, extractMaterial, generateTasks, buildImport, linkConcepts } from "../lib/ai.js";

const STEPS = ["Source", "Choose concepts", "Create questions"];

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
  const [linkState, setLinkState] = useState(null);
  const [hasKey, setHasKey] = useState(null);
  const [book, setBook] = useState(null); // { name, data, pages, outline, pick, from, to, loading }
  const fileRef = useRef(null);

  useEffect(() => { aiAvailable().then(setHasKey); }, []);

  if (!course) return null;

  const source = [text, ...files.map(f => `# ${f.name}\n\n${f.content}`)].filter(s => s.trim()).join("\n\n");

  const pdfApi = typeof window !== "undefined" ? window.aeroflash?.pdf : null;

  const openPdf = async (f) => {
    if (!pdfApi) { setError("PDF import works in the desktop app. Paste the chapter's text instead."); return; }
    setError("");
    setBook({ name: f.name, loading: true });
    const data = await f.arrayBuffer();
    const res = await pdfApi.outline(data);
    if (!res.ok) { setBook(null); setError(`${f.name}: ${res.error}`); return; }
    setBook({ name: f.name, data, pages: res.pages, outline: res.outline, pick: "", from: 1, to: Math.min(res.pages, 20) });
  };

  const pickChapter = (idx) => {
    const o = book.outline[idx];
    setBook(b => ({ ...b, pick: idx, from: o ? o.page : b.from, to: o ? o.end : b.to }));
  };

  const loadPages = async () => {
    setBook(b => ({ ...b, loading: true }));
    const res = await pdfApi.text({ data: book.data, from: Number(book.from), to: Number(book.to) });
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

  const extract = async () => {
    setError(""); setStep(1);
    setBusy({ label: "Reading the material and picking out what's worth remembering" });
    const res = await extractMaterial({
      state, courseId, title: title.trim(), location: location.trim(), text: source,
      onProgress: (p) => p.parts > 1 && setBusy({ label: `Reading part ${p.part} of ${p.parts}` }),
    });
    setBusy(null);
    if (!res.ok) { setError(res.error); setStep(0); return; }
    setExtraction(res);
    if (!title.trim() && res.title) setTitle(res.title);
  };

  const toggle = (si, ci) => setExtraction(x => ({
    ...x, sections: x.sections.map((s, i) => i !== si ? s : { ...s, concepts: s.concepts.map((c, j) => (j !== ci ? c : { ...c, selected: !c.selected })) }),
  }));

  const selectedCount = extraction ? extraction.sections.reduce((n, s) => n + s.concepts.filter(c => c.selected).length, 0) : 0;
  const totalCount = extraction ? extraction.sections.reduce((n, s) => n + s.concepts.length, 0) : 0;

  const create = async () => {
    setError(""); setStep(2);
    setBusy({ label: "Writing questions" });
    const res = await generateTasks({
      state, courseId, sections: extraction.sections,
      onProgress: (p) => setBusy({ label: `Writing questions for "${p.section}"`, part: p.part, parts: p.parts }),
    });
    if (!res.ok) { setBusy(null); setError(res.error); setStep(1); return; }
    const label = [title.trim() || extraction.title, location.trim()].filter(Boolean).join(", ");
    const payload = buildImport({ state, courseId, extraction, tasks: res.tasks, sourceLabel: label });
    act("import", { payload });
    setBusy(null);
    setResult({ ...payload, partial: res.partial });

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
    setStep(0); setTitle(""); setLocation(""); setText(""); setFiles([]); setExtraction(null); setResult(null); setLinkState(null); setError("");
    setBook(b => {
      if (!b?.outline) return b;
      const next = typeof b.pick === "number" ? b.outline.findIndex((o, i) => i > b.pick && o.depth <= b.outline[b.pick].depth) : -1;
      return next >= 0 ? { ...b, pick: next, from: b.outline[next].page, to: b.outline[next].end } : { ...b, pick: "" };
    });
  };

  return (
    <div className="page page-narrow">
      <button className="crumb" onClick={() => nav.go("course", { courseId })}><Icon name="back" size={14}/>{course.name}</button>
      <div className="page-head">
        <div>
          <h1>Add material</h1>
          <div className="page-sub">Add one chapter or lesson at a time, as you finish it.</div>
        </div>
      </div>

      <div className="steps">
        {STEPS.map((s, i) => <span key={s} className={i === step && !result ? "on" : i < step || result ? "done" : ""}>{i + 1}. {s}</span>)}
      </div>

      {error && <div style={{ marginBottom: 16 }}><Notice tone="bad" icon="alert">{error}</Notice></div>}

      {!aiBridge() && step === 0 && (
        <div style={{ marginBottom: 16 }}><Notice icon="info">Concept extraction runs in the desktop app. Here you can still write questions yourself from the course page.</Notice></div>
      )}
      {aiBridge() && hasKey === false && step === 0 && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warn" icon="alert">Add your Anthropic API key in <button className="link" onClick={() => nav.go("settings")}>Settings</button> to extract concepts automatically.</Notice>
        </div>
      )}

      {step === 0 && (
        <div className="panel panel-pad">
          <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
            <div className="field grow">
              <label htmlFor="am-title">What is it?</label>
              <input id="am-title" className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Chapter 11: Pointers"/>
            </div>
            <div className="field" style={{ width: 200 }}>
              <label htmlFor="am-loc">Pages or timestamps</label>
              <input id="am-loc" className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="pp. 241–262"/>
            </div>
          </div>
          <div className="field">
            <label htmlFor="am-text">Text</label>
            <textarea id="am-text" className="textarea" style={{ minHeight: 240, fontFamily: "var(--serif)", fontSize: 15 }} value={text}
              onChange={e => setText(e.target.value)} placeholder="Paste the chapter, transcript or your notes here"/>
          </div>
          <div className={`dropzone${drag ? " over" : ""}`} role="button" tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); readFiles(e.dataTransfer.files); }}>
            <Icon name="upload" size={18}/> <span>Or drop a PDF of the book, or .md / .txt notes</span>
            <input ref={fileRef} type="file" accept=".pdf,.md,.markdown,.txt,.text" multiple hidden onChange={e => { readFiles(e.target.files); e.target.value = ""; }}/>
          </div>
          {book && (
            <div className="panel panel-pad" style={{ marginTop: 12, background: "var(--surface-2)" }}>
              {book.loading && !book.pages ? <div className="progress-line"><Spinner/>Opening {book.name}…</div> : (
                <>
                  <div className="row" style={{ marginBottom: 10 }}>
                    <strong className="grow">{book.name}</strong>
                    <span className="muted small">{book.pages} pages</span>
                    <button className="btn btn-quiet btn-sm btn-icon" onClick={() => setBook(null)} aria-label="Remove PDF"><Icon name="x" size={14}/></button>
                  </div>
                  <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                    {book.outline.length > 0 && (
                      <div className="field grow" style={{ marginBottom: 0, minWidth: 240 }}>
                        <label htmlFor="am-ch">Chapter</label>
                        <select id="am-ch" className="select" value={book.pick} onChange={e => pickChapter(e.target.value === "" ? "" : Number(e.target.value))}>
                          <option value="">Choose from the book's contents</option>
                          {book.outline.map((o, i) => <option key={i} value={i}>{o.depth ? "\u2003" : ""}{o.title} (p. {o.page})</option>)}
                        </select>
                      </div>
                    )}
                    <div className="field" style={{ marginBottom: 0, width: 90 }}>
                      <label htmlFor="am-from">From page</label>
                      <input id="am-from" className="input" type="number" min={1} max={book.pages} value={book.from} onChange={e => setBook(b => ({ ...b, from: e.target.value }))}/>
                    </div>
                    <div className="field" style={{ marginBottom: 0, width: 90 }}>
                      <label htmlFor="am-to">To page</label>
                      <input id="am-to" className="input" type="number" min={1} max={book.pages} value={book.to} onChange={e => setBook(b => ({ ...b, to: e.target.value }))}/>
                    </div>
                    <button className="btn" onClick={loadPages} disabled={book.loading || !(Number(book.to) >= Number(book.from))}>
                      {book.loading ? <Spinner/> : null}Load these pages
                    </button>
                  </div>
                  <p className="help" style={{ marginTop: 10 }}>The pages' text goes into the box above so you can check it first. Page numbers are kept so each concept can point back to its page.</p>
                </>
              )}
            </div>
          )}
          {files.length > 0 && <div className="row-wrap" style={{ marginTop: 10 }}>
            {files.map(f => <span key={f.name} className="chip">{f.name}<button onClick={() => setFiles(p => p.filter(x => x.name !== f.name))} aria-label={`Remove ${f.name}`}>×</button></span>)}
          </div>}
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn btn-primary" disabled={!source.trim() || !aiBridge() || hasKey === false} onClick={extract}><Icon name="sparkle" size={15}/>Find key concepts</button>
            <span className="muted small grow">{source.length ? `${Math.round(source.length / 1000)}k characters` : ""}</span>
          </div>
          <p className="help" style={{ marginTop: 14 }}>
            Code, equations and examples are kept. If a figure or formula didn't survive copying, you'll be told instead of getting a question built on missing information.
          </p>
        </div>
      )}

      {busy && (
        <div className="panel panel-pad">
          <div className="progress-line"><Spinner/><span>{busy.label}{busy.parts > 1 ? ` (${busy.part} of ${busy.parts})` : ""}…</span></div>
          <p className="muted small" style={{ marginTop: 10 }}>A long chapter can take a minute or two.</p>
        </div>
      )}

      {step === 1 && !busy && extraction && (
        <>
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="grow">
              <strong>{selectedCount} of {totalCount} concepts selected.</strong>
              <span className="muted"> Details are left out by default. Untick anything you don't need to remember.</span>
            </div>
          </div>
          {extraction.partial && <div style={{ marginBottom: 14 }}><Notice tone="warn" icon="alert">Only part of the material was processed: {extraction.partial}</Notice></div>}
          {extraction.gaps?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <Notice tone="warn" icon="alert">
                <strong>Some information may have been lost when the text was copied:</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{extraction.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
              </Notice>
            </div>
          )}
          {extraction.sections.map((s, si) => (
            <div key={si} className="extract-section">
              <div className="extract-section-head">
                <div className="list-title">{s.title}</div>
                {s.summary && <div className="list-meta">{s.summary}</div>}
              </div>
              {s.concepts.map((c, ci) => (
                <label key={c.key} className={`extract-concept${c.selected ? "" : " off"}`}>
                  <input type="checkbox" checked={c.selected} onChange={() => toggle(si, ci)} style={{ marginTop: 3 }}/>
                  <div style={{ minWidth: 0 }}>
                    <div className="list-title">{c.name}</div>
                    <Markdown className="small muted">{c.summary}</Markdown>
                    {c.importance_reason && <div className="small muted" style={{ marginTop: 2, fontStyle: "italic" }}>{c.importance_reason}</div>}
                  </div>
                  <ImportanceTag importance={c.importance}/>
                </label>
              ))}
            </div>
          ))}
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn btn-quiet" onClick={() => setStep(0)}>Back</button>
            <div className="grow"/>
            <button className="btn btn-primary" disabled={!selectedCount} onClick={create}>Create questions for {selectedCount} concept{selectedCount === 1 ? "" : "s"}</button>
          </div>
        </>
      )}

      {result && !busy && (
        <div className="card-stack">
          <article className="index-card">
            <div className="index-card-head"><span className="ability">Added to {course.name}</span></div>
            <div className="ruled">
              <div className="plan-title">{result.concepts.length} concepts, {result.items.length} questions</div>
              <div className="plan-sub">
                They'll be introduced gradually, up to {state.settings.maxNewPerDay} new concepts a day across your courses, in an order that puts prerequisites first.
              </div>
              {linkState === "working" && <div className="plan-sub row"><Spinner/>Looking for connections to your other courses…</div>}
              {typeof linkState === "number" && <div className="plan-sub">{linkState ? `Found ${linkState} connection${linkState === 1 ? "" : "s"} to things you already know.` : "No strong connections to your other courses yet."}</div>}
              {linkState === "failed" && <div className="plan-sub">Couldn't look for connections this time.</div>}
            </div>
            {result.partial && <div style={{ marginTop: 12 }}><Notice tone="warn" icon="alert">Some sections didn't get questions: {result.partial}</Notice></div>}
            <div className="plan-foot">
              <button className="btn btn-primary" onClick={() => nav.go("course", { courseId })}>View course</button>
              <button className="btn" onClick={reset}>Add another chapter</button>
            </div>
          </article>
        </div>
      )}
    </div>
  );
}

// Notes: capture things worth remembering from projects, docs and everyday
// work, then have them turned into questions (see lib/notes.js). They live in
// their own space, organized by topic, and never count toward a course.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useNav, pct } from "../ui/nav.js";
import { Notice, Spinner, StatusDot, ImportanceTag } from "../ui/ui.jsx";
import Icon from "../ui/Icon.jsx";
import Markdown from "../ui/Markdown.jsx";
import ConceptPanel from "./ConceptPanel.jsx";
import { QuestionRow } from "./AddMaterial.jsx";
import { index } from "../lib/model.js";
import { sectionMastery } from "../lib/mastery.js";
import { aiAvailable, aiBridge } from "../lib/ai.js";
import { splitNotes, newNotes, processNotes, buildNotesImport, notesCourse } from "../lib/notes.js";

const PER_RUN = 40; // notes processed per run, so a big upload stays reviewable
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// One line of a note as you wrote it (no markdown stripping, which would eat
// the underscores in names like foreign_keys).
const preview = (text, max) => {
  const t = String(text).replace(/```[\s\S]*?```/g, " [code] ").replace(/^([-*+]|\d+[.)])\s+/gm, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export default function Notes() {
  const { state, act } = useStore();
  const nav = useNav();
  const ix = index(state);
  const space = notesCourse(state);
  const inbox = state.notes.filter(n => n.status === "inbox");
  const history = state.notes.filter(n => n.status !== "inbox").sort((a, b) => (b.processedAt || 0) - (a.processedAt || 0));

  const [text, setText] = useState("");
  const [context, setContext] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [review, setReview] = useState(null); // { entries, partial }
  const [hasKey, setHasKey] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [conceptId, setConceptId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [drag, setDrag] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { aiAvailable().then(setHasKey); }, []);
  useEffect(() => { if (nav.route.capture) taRef.current?.focus(); }, [nav.route.capture]);

  const addPieces = (pieces, source) => {
    const { notes, duplicates } = newNotes(state, pieces, { source });
    if (notes.length) act("notes/add", { notes });
    setMsg(`${notes.length ? `${plural(notes.length, "note")} added to your inbox` : "Nothing new"}${duplicates ? ` (${duplicates} you'd already added ${duplicates === 1 ? "was" : "were"} skipped)` : ""}.`);
  };

  const capture = () => {
    const t = text.trim();
    if (!t) return;
    const pieces = splitNotes(t, { context: context.trim() });
    addPieces(pieces.length ? pieces : [{ text: t, context: context.trim() }], "Captured");
    setText("");
    taRef.current?.focus();
  };

  const readFiles = (list) => {
    setError("");
    for (const f of list) {
      if (!/\.(md|markdown|txt|text)$/i.test(f.name)) { setError(`${f.name} isn't a text or markdown file.`); continue; }
      const r = new FileReader();
      r.onload = () => addPieces(splitNotes(String(r.result), { context: f.name.replace(/\.[^.]+$/, "") }), f.name);
      r.readAsText(f);
    }
  };

  const process = async () => {
    setError(""); setMsg("");
    const batch = inbox.slice(0, PER_RUN);
    setBusy({ label: "Reading your notes" });
    const res = await processNotes({
      state, noteIds: batch.map(n => n.id),
      onProgress: (p) => setBusy(p.step === "write" ? { label: "Writing questions" } : { label: "Reading your notes", done: p.done, total: p.total }),
    });
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setReview(res);
  };

  const toggle = (ei, ci, list, qi) => setReview(r => ({
    ...r,
    entries: r.entries.map((e, i) => (i !== ei ? e : {
      ...e,
      concepts: e.concepts.map((c, j) => (j !== ci ? c : {
        ...c, group: { ...c.group, [list]: c.group[list].map((q, k) => (k !== qi ? q : { ...q, selected: !q.selected })) },
      })),
    })),
  }));

  const keepAnyway = (id) => {
    act("notes/requeue", { id, force: true });
    setReview(r => (r ? { ...r, entries: r.entries.filter(e => e.note.id !== id) } : r));
    setMsg("It's back in your inbox and will be kept next time you process.");
  };

  const save = () => {
    const payload = buildNotesImport({ state, entries: review.entries });
    act("notes/import", { payload });
    const fresh = payload.concepts.length;
    const merged = new Set(payload.items.filter(i => !payload.concepts.some(c => c.id === i.conceptId)).map(i => i.conceptId)).size;
    const skipped = payload.noteUpdates.filter(u => u.patch.status === "skipped").length;
    setMsg([fresh && `${plural(fresh, "new concept")} in Notes`, merged && `more questions on ${plural(merged, "concept")} you already study`, skipped && `${skipped} skipped`].filter(Boolean).join(", ") + ".");
    setReview(null);
  };

  const topics = space ? ix.sectionsByCourse[space.id] || [] : [];
  const chosen = review ? review.entries.reduce((n, e) => n + e.concepts.reduce((m, c) => m + (c.group ? [...c.group.kept, ...c.group.dropped].filter(q => q.selected).length : 0), 0), 0) : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Notes</h1>
          <div className="page-sub">What you pick up outside a course: from projects, docs and work. Reviewed with everything else, never counted toward a course.</div>
        </div>
      </div>

      {!aiBridge() && <div style={{ marginBottom: 14 }}><Notice icon="info">Turning notes into questions runs in the desktop app. You can still collect notes here.</Notice></div>}
      {aiBridge() && hasKey === false && <div style={{ marginBottom: 14 }}><Notice tone="warn" icon="alert">Add your Anthropic API key in <button className="link" onClick={() => nav.go("settings")}>Settings</button> to turn notes into questions.</Notice></div>}

      <div className="grid-2 notes-top">
        <div className="panel panel-pad">
          <label className="label" htmlFor="note-text">Capture a note</label>
          <textarea
            id="note-text" ref={taRef} className="textarea" rows={4} value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); capture(); } }}
            style={{ marginTop: 8 }}
          />
          <label className="label" htmlFor="note-context" style={{ display: "block", marginTop: 14 }}>Project or topic <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <div className="row" style={{ marginTop: 8, gap: 10 }}>
            <input id="note-context" className="input grow" value={context} onChange={e => setContext(e.target.value)} aria-label="Project or topic"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); capture(); } }}/>
            <button className="btn btn-primary" disabled={!text.trim()} onClick={capture}><Icon name="plus" size={14}/>Add note</button>
          </div>
          <p className="muted small" style={{ margin: "8px 0 0" }}>Ctrl+Enter adds it. Write it the way you'd explain it to yourself; one idea per paragraph or bullet works best.</p>
        </div>

        <div
          className={`panel panel-pad dropzone notes-drop${drag ? " over" : ""}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); readFiles([...e.dataTransfer.files]); }}
          onClick={() => fileRef.current?.click()} role="button" tabIndex={0}
        >
          <Icon name="upload" size={20}/>
          <strong>Upload notes</strong>
          <span className="muted small">Drop .md or .txt files. Each bullet or paragraph becomes a note. Upload the same file again whenever you add to it: only new parts are picked up.</span>
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt,.text,text/plain,text/markdown" multiple hidden onChange={e => { readFiles([...e.target.files]); e.target.value = ""; }}/>
        </div>
      </div>

      {msg && <div style={{ margin: "14px 0" }}><Notice icon="check">{msg}</Notice></div>}
      {error && <div style={{ margin: "14px 0" }}><Notice tone="warn" icon="alert">{error}</Notice></div>}

      {busy && (
        <div className="panel panel-pad" style={{ marginTop: 20 }}>
          <div className="progress-line"><Spinner/><span>{busy.label}{busy.total > 1 ? ` (${busy.done} of ${busy.total})` : ""}…</span></div>
          <p className="muted small" style={{ marginTop: 10 }}>Claude checks each note against what you already study, then writes questions for what's worth keeping.</p>
        </div>
      )}

      {review && !busy && (
        <section style={{ marginTop: 28 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 className="h grow" style={{ margin: 0 }}>Review</h2>
            <button className="btn btn-quiet" onClick={() => setReview(null)}>Discard</button>
            <button className="btn btn-primary" onClick={save}>Save {plural(chosen, "question")}</button>
          </div>
          {review.partial && <div style={{ marginBottom: 12 }}><Notice tone="warn" icon="alert">Part of this didn't go through: {review.partial}. Those notes stay in your inbox.</Notice></div>}
          <div className="stack" style={{ gap: 12 }}>
            {review.entries.map((e, ei) => (
              <div key={e.note.id} className="panel panel-pad note-result">
                <div className="note-source">
                  <Markdown className="small">{e.note.text}</Markdown>
                  {e.note.context && <span className="tag">{e.note.context}</span>}
                </div>
                {e.outcome !== "keep" && (
                  <div className="row small" style={{ marginTop: 10 }}>
                    <span className="grow review-reason">{e.outcome === "error" ? e.reason : `Skipped: ${e.reason}`}</span>
                    {e.outcome === "skip" && <button className="btn btn-sm" onClick={() => keepAnyway(e.note.id)}>Keep anyway</button>}
                  </div>
                )}
                {e.concepts.map((c, ci) => {
                  const target = c.sameAs ? ix.concept[c.sameAs] : null;
                  return (
                    <div key={c.key} className="note-concept">
                      <div className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
                        {target
                          ? <span><Icon name="link" size={12}/> Adds questions to <strong>{target.name}</strong> <span className="muted">in {ix.course[target.courseId]?.name}</span></span>
                          : <span>New in <strong>{c.topic}</strong>: <strong>{c.name}</strong></span>}
                        {c.filledIn && <span className="tag">Filled in by Claude, check it</span>}
                        {c.related.map(l => ix.concept[l.id] && <span key={l.id} className="tag" title={l.why}>Linked to {ix.concept[l.id].name}</span>)}
                      </div>
                      {!target && <Markdown className="small muted" >{c.summary}</Markdown>}
                      {c.corrected && <div style={{ marginTop: 8 }}><Notice tone="warn" icon="alert">Your note needed a correction: {c.corrected}</Notice></div>}
                      <div style={{ marginTop: 10 }}>
                        {!c.group && <div className="small muted">Questions for this one couldn't be written. It stays in your inbox if you discard.</div>}
                        {c.group && c.group.kept.length === 0 && <div className="small muted" style={{ marginBottom: 8 }}>No question passed the quality check. Tick a filtered one below to keep it; otherwise this is skipped.</div>}
                        {c.group?.kept.map((q, qi) => <QuestionRow key={q.id} q={q} onToggle={() => toggle(ei, ci, "kept", qi)}/>)}
                        {c.group?.dropped.length > 0 && (
                          <details className="small">
                            <summary className="muted" style={{ cursor: "pointer" }}>Filtered out ({c.group.dropped.length})</summary>
                            <div style={{ marginTop: 8 }}>{c.group.dropped.map((q, qi) => <QuestionRow key={q.id} q={q} dropped onToggle={() => toggle(ei, ci, "dropped", qi)}/>)}</div>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      )}

      {!review && !busy && inbox.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 className="h grow" style={{ margin: 0 }}>Inbox <span className="muted num" style={{ fontWeight: 400 }}>{inbox.length}</span></h2>
            <button className="btn btn-primary" disabled={!aiBridge() || hasKey === false} onClick={process}>
              <Icon name="sparkle" size={14}/>Process {inbox.length > PER_RUN ? `next ${PER_RUN}` : plural(inbox.length, "note")}
            </button>
          </div>
          <div className="panel list">
            {inbox.slice(0, 12).map(n => (
              <div key={n.id} className="list-row static">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="note-preview">{preview(n.text, 180)}</div>
                  <div className="section-stats"><span>{n.source}</span>{n.context && <span>{n.context}</span>}{n.force && <span>keep anyway</span>}</div>
                </div>
                <button className="btn btn-quiet btn-sm btn-icon" title="Remove from inbox" onClick={() => act("notes/remove", { id: n.id })}><Icon name="x" size={14}/></button>
              </div>
            ))}
            {inbox.length > 12 && <div className="list-row static muted small">and {inbox.length - 12} more</div>}
          </div>
        </section>
      )}

      <section style={{ marginTop: 32 }}>
        <h2 className="h" style={{ marginBottom: 12 }}>Topics</h2>
        {topics.length === 0 ? (
          <div className="panel empty">
            <h3>Nothing here yet</h3>
            <p>Add a few notes and process them. Claude files each idea under a topic like "SQLite" or "Git", links it to related concepts from your courses, and writes questions for it.</p>
          </div>
        ) : (
          <div className="panel">
            {topics.map(s => {
              const sm = sectionMastery(state, s.id, nav.now);
              const concepts = ix.conceptsBySection[s.id] || [];
              const isOpen = open.has(s.id);
              const questions = concepts.reduce((n, c) => n + (ix.itemsByConcept[c.id] || []).filter(i => !i.flag).length, 0);
              return (
                <div key={s.id} className="section-block">
                  <div className="section-head">
                    <button className={`section-row${isOpen ? " open" : ""}`} onClick={() => setOpen(o => { const x = new Set(o); if (x.has(s.id)) x.delete(s.id); else x.add(s.id); return x; })} aria-expanded={isOpen}>
                      <Icon name="chevron" size={14} className="chev"/>
                      <div className="section-text">
                        <div className="list-title">{s.title}</div>
                        <div className="section-stats">
                          <span>{plural(sm.total, "concept")}</span>
                          <span>{plural(questions, "question")}</span>
                          <span>{sm.introduced}/{sm.total} started</span>
                          {sm.memory != null && <span>recall {pct(sm.memory)}</span>}
                        </div>
                      </div>
                    </button>
                    <div className="section-side" />
                  </div>
                  {isOpen && (
                    <div style={{ paddingBottom: 8 }}>
                      {concepts.map(c => (
                        <button key={c.id} className="concept-row" onClick={() => setConceptId(c.id)}>
                          <StatusDot status={sm.per[c.id]?.status ?? "new"}/>
                          <span className="ell">{c.name}</span>
                          <span className="list-meta">
                            {c.filledIn && <span className="tag">filled in</span>}
                            <ImportanceTag importance={c.importance}/>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 className="h" style={{ marginBottom: 12 }}>Processed notes</h2>
          <div className="panel list">
            {(showAll ? history : history.slice(0, 10)).map(n => (
              <div key={n.id} className="list-row static">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="note-preview">{preview(n.text, 160)}</div>
                  <div className="note-outcome small">
                    {n.status === "skipped" ? <span className="muted">Skipped: {n.reason}</span> : <>
                      {(n.result?.conceptIds || []).map(id => ix.concept[id] && <button key={id} className="link" onClick={() => setConceptId(id)}>{ix.concept[id].name}</button>)}
                      {(n.result?.merged || []).map(id => ix.concept[id] && <span key={id}>more questions on <button className="link" onClick={() => setConceptId(id)}>{ix.concept[id].name}</button></span>)}
                    </>}
                  </div>
                </div>
                {n.status === "skipped" && <button className="btn btn-sm" onClick={() => keepAnyway(n.id)}>Keep anyway</button>}
                <button className="btn btn-quiet btn-sm btn-icon" title="Forget this note (anything made from it stays)" onClick={() => act("notes/remove", { id: n.id })}><Icon name="x" size={14}/></button>
              </div>
            ))}
            {history.length > 10 && !showAll && <button className="list-row muted small" onClick={() => setShowAll(true)}>Show all {history.length}</button>}
          </div>
        </section>
      )}

      {conceptId && <ConceptPanel conceptId={conceptId} onOpen={setConceptId} onClose={() => setConceptId(null)}/>}
    </div>
  );
}

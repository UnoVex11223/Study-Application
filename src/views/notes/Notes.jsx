// Notes: capture things worth remembering from projects, docs and everyday
// work, then have them turned into questions (see lib/notes.js). They live in
// their own space, organized by topic, and never count toward a course.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Page, PageHeader, Section } from "../../ui/layout.jsx";
import { Notice, Spinner, ImportanceTag } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { index } from "../../lib/model.js";
import { sectionMastery } from "../../lib/mastery.js";
import { aiAvailable, aiBridge } from "../../lib/ai.js";
import { splitNotes, newNotes, processNotes, buildNotesImport, notesCourse } from "../../lib/notes.js";
import { plural, pluralWord, pct } from "../../lib/format.js";
import { Outline, OutlineItem, ConceptRow } from "../concepts/Outline.jsx";
import ConceptPanel from "../concepts/ConceptPanel.jsx";
import QuestionRow from "../concepts/QuestionRow.jsx";

const PER_RUN = 40; // notes processed per run, so a big upload stays reviewable
const INBOX_SHOWN = 12;
const HISTORY_SHOWN = 10;
// One line of a note as you wrote it (no markdown stripping, which would eat
// the underscores in names like foreign_keys).
const preview = (text, max) => {
  const t = String(text).replace(/```[\s\S]*?```/g, " [code] ").replace(/^([-*+]|\d+[.)])\s+/gm, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** What processing found for one note: new concepts or extra questions, each with its questions to keep. */
function NoteResult({ entry: e, ix, onToggle, onKeep }) {
  return (
    <div className="panel panel-pad stack gap-4">
      <div className="note-source">
        <Markdown className="small">{e.note.text}</Markdown>
        {e.note.context && <span className="tag">{e.note.context}</span>}
      </div>
      {e.outcome !== "keep" && (
        <div className="row small">
          <span className="grow error-text">{e.outcome === "error" ? e.reason : `Skipped: ${e.reason}`}</span>
          {e.outcome === "skip" && <button className="btn btn-sm" onClick={onKeep}>Keep anyway</button>}
        </div>
      )}
      {e.concepts.map((c, ci) => {
        const target = c.sameAs ? ix.concept[c.sameAs] : null;
        return (
          <div key={c.key} className="note-concept stack gap-3">
            <div className="row wrap small">
              {target
                ? <span><Icon name="link" size={12}/> Adds questions to <strong>{target.name}</strong> <span className="muted">in {ix.course[target.courseId]?.name}</span></span>
                : <span>New in <strong>{c.topic}</strong>: <strong>{c.name}</strong></span>}
              {c.filledIn && <span className="tag">Filled in by Claude, check it</span>}
              {c.related.map(l => ix.concept[l.id] && <span key={l.id} className="tag" title={l.why}>Linked to {ix.concept[l.id].name}</span>)}
            </div>
            {!target && <Markdown className="small muted">{c.summary}</Markdown>}
            {c.corrected && <Notice tone="warn" icon="alert">Your note needed a correction: {c.corrected}</Notice>}
            {!c.group && <p className="small muted">Questions for this one couldn't be written. It stays in your inbox if you discard.</p>}
            {c.group && c.group.kept.length === 0 && <p className="small muted">No question passed the quality check. Tick a filtered one below to keep it; otherwise this is skipped.</p>}
            {c.group?.kept.map((q, qi) => <QuestionRow key={q.id} q={q} onToggle={() => onToggle(ci, "kept", qi)}/>)}
            {c.group?.dropped.length > 0 && (
              <details className="disclosure">
                <summary>Filtered out ({c.group.dropped.length})</summary>
                <div className="stack gap-2">{c.group.dropped.map((q, qi) => <QuestionRow key={q.id} q={q} dropped onToggle={() => onToggle(ci, "dropped", qi)}/>)}</div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
  const [conceptId, setConceptId] = useState(nav.route.conceptId ?? null);
  const [showAll, setShowAll] = useState(false);
  const [drag, setDrag] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { aiAvailable().then(setHasKey); }, []);
  useEffect(() => { if (nav.route.capture) taRef.current?.focus(); }, [nav.route.capture]);

  const addPieces = (pieces, source) => {
    const { notes, duplicates } = newNotes(state, pieces, { source });
    if (notes.length) act("notes/add", { notes });
    const added = notes.length ? `${plural(notes.length, "note")} added to your inbox` : "Nothing new";
    setMsg(`${added}${duplicates ? ` (${duplicates} you'd already added ${pluralWord(duplicates, "was", "were")} skipped)` : ""}.`);
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

  const toggleQuestion = (ei, ci, list, qi) => setReview(r => ({
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
  const toggleTopic = (id) => setOpen(o => { const x = new Set(o); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  return (
    <Page>
      <PageHeader title="Notes"/>

      {!aiBridge() && <Notice>Turning notes into questions runs in the desktop app. You can still collect notes here.</Notice>}
      {aiBridge() && hasKey === false && <Notice tone="warn" icon="alert">Add your Anthropic API key in <button className="link" onClick={() => nav.go("settings")}>Settings</button> to turn notes into questions.</Notice>}

      <div className={cx("panel capture", drag && "over")}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); readFiles([...e.dataTransfer.files]); }}>
        <textarea id="note-text" ref={taRef} className="capture-text" rows={3} value={text} aria-label="Capture a note"
          placeholder="Capture a note: something you learned, in a sentence or two"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); capture(); } }}/>
        <div className="capture-foot">
          <input id="note-context" className="input capture-topic" value={context} onChange={e => setContext(e.target.value)} aria-label="Project or topic"
            placeholder="Project or topic" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); capture(); } }}/>
          <span className="grow"/>
          <button className="btn btn-quiet" onClick={() => fileRef.current?.click()} title="Upload .md or .txt notes (or drop them here)"><Icon name="upload"/>Upload notes</button>
          <button className="btn btn-primary" disabled={!text.trim()} onClick={capture}><Icon name="plus"/>Add note</button>
        </div>
        <input ref={fileRef} type="file" accept=".md,.markdown,.txt,.text,text/plain,text/markdown" multiple hidden onChange={e => { readFiles([...e.target.files]); e.target.value = ""; }}/>
      </div>

      {msg && <Notice icon="check">{msg}</Notice>}
      {error && <Notice tone="warn" icon="alert">{error}</Notice>}
      {busy && <div className="panel panel-pad busy"><Spinner/>{busy.label}{busy.total > 1 ? ` (${busy.done} of ${busy.total})` : ""}…</div>}

      {review && !busy && (
        <Section title="Review" actions={<>
          <button className="btn btn-sm btn-quiet" onClick={() => setReview(null)}>Discard</button>
          <button className="btn btn-sm btn-primary" onClick={save}>Save {plural(chosen, "question")}</button>
        </>}>
          {review.partial && <Notice tone="warn" icon="alert">Part of this didn't go through: {review.partial}. Those notes stay in your inbox.</Notice>}
          {review.entries.map((e, ei) => (
            <NoteResult key={e.note.id} entry={e} ix={ix} onKeep={() => keepAnyway(e.note.id)} onToggle={(ci, list, qi) => toggleQuestion(ei, ci, list, qi)}/>
          ))}
        </Section>
      )}

      {!review && !busy && inbox.length > 0 && (
        <Section title="Inbox" count={inbox.length} actions={
          <button className="btn btn-primary btn-sm" disabled={!aiBridge() || hasKey === false} onClick={process}>
            <Icon name="sparkle"/>Process {inbox.length > PER_RUN ? `next ${PER_RUN}` : plural(inbox.length, "note")}
          </button>
        }>
          <div className="list">
            {inbox.slice(0, INBOX_SHOWN).map(n => (
              <div key={n.id} className="list-row">
                <div className="grow stack gap-1">
                  <div className="ell">{preview(n.text, 180)}</div>
                  <div className="meta"><span>{n.source}</span>{n.context && <span>{n.context}</span>}{n.force && <span>keep anyway</span>}</div>
                </div>
                <button className="btn btn-quiet btn-sm btn-icon" title="Remove from inbox" aria-label="Remove from inbox" onClick={() => act("notes/remove", { id: n.id })}><Icon name="x"/></button>
              </div>
            ))}
            {inbox.length > INBOX_SHOWN && <div className="list-row muted small">and {inbox.length - INBOX_SHOWN} more</div>}
          </div>
        </Section>
      )}

      <Section title="Topics">
        {topics.length === 0 ? (
          <p className="muted small">Processed notes are filed here by topic.</p>
        ) : (
          <Outline>
            {topics.map(s => {
              const sm = sectionMastery(state, s.id, nav.now);
              const concepts = ix.conceptsBySection[s.id] || [];
              const questions = concepts.reduce((n, c) => n + (ix.itemsByConcept[c.id] || []).filter(i => !i.flag).length, 0);
              return (
                <OutlineItem key={s.id} title={s.title} open={open.has(s.id)} onToggle={() => toggleTopic(s.id)}
                  meta={<>
                    <span>{plural(sm.total, "concept")}</span>
                    <span>{plural(questions, "question")}</span>
                    <span>{sm.introduced} of {sm.total} started</span>
                    {sm.memory != null && <span>recall {pct(sm.memory)}</span>}
                  </>}>
                  {concepts.map(c => (
                    <ConceptRow key={c.id} concept={c} status={sm.per[c.id]?.status ?? "new"} onOpen={setConceptId}
                      tags={<>{c.filledIn && <span className="tag">filled in</span>}<ImportanceTag importance={c.importance}/></>}/>
                  ))}
                </OutlineItem>
              );
            })}
          </Outline>
        )}
      </Section>

      {history.length > 0 && (
        <Section title="Processed notes">
          <div className="list">
            {(showAll ? history : history.slice(0, HISTORY_SHOWN)).map(n => (
              <div key={n.id} className="list-row">
                <div className="grow stack gap-1">
                  <div className="ell">{preview(n.text, 160)}</div>
                  <div className="note-outcome small">
                    {n.status === "skipped" ? <span className="muted">Skipped: {n.reason}</span> : <>
                      {(n.result?.conceptIds || []).map(id => ix.concept[id] && <button key={id} className="link" onClick={() => setConceptId(id)}>{ix.concept[id].name}</button>)}
                      {(n.result?.merged || []).map(id => ix.concept[id] && <span key={id}>more questions on <button className="link" onClick={() => setConceptId(id)}>{ix.concept[id].name}</button></span>)}
                    </>}
                  </div>
                </div>
                {n.status === "skipped" && <button className="btn btn-sm" onClick={() => keepAnyway(n.id)}>Keep anyway</button>}
                <button className="btn btn-quiet btn-sm btn-icon" title="Forget this note (anything made from it stays)" aria-label="Forget this note" onClick={() => act("notes/remove", { id: n.id })}><Icon name="x"/></button>
              </div>
            ))}
            {history.length > HISTORY_SHOWN && !showAll && <button className="list-row muted small" onClick={() => setShowAll(true)}>Show all {history.length}</button>}
          </div>
        </Section>
      )}

      {conceptId && <ConceptPanel conceptId={conceptId} onOpen={setConceptId} onClose={() => setConceptId(null)}/>}
    </Page>
  );
}

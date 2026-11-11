// Notes: capture things worth remembering from projects, docs and everyday
// work, then have them turned into questions (see lib/notes.js). Claude files
// each idea under a broad area, a course of its own, and leaves out what you
// already study. Areas can be regrouped into broader ones, and a note can be
// deleted along with everything made from it.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Page, PageHeader, Section } from "../../ui/layout.jsx";
import { Notice, Spinner } from "../../ui/display.jsx";
import { ConfirmDialog } from "../../ui/overlays.jsx";
import { cx } from "../../ui/cx.js";
import { index } from "../../lib/model.js";
import { aiAvailable, aiBridge } from "../../lib/ai.js";
import { splitNotes, newNotes, processNotes, buildNotesImport, noteAreas, planRegroup, madeFrom, nameKey } from "../../lib/notes.js";
import { plural, pluralWord } from "../../lib/format.js";
import ConceptPanel from "../concepts/ConceptPanel.jsx";
import QuestionRow from "../concepts/QuestionRow.jsx";
import CourseRow from "../courses/CourseRow.jsx";

const PER_RUN = 40; // notes processed per run, so a big upload stays reviewable
const INBOX_SHOWN = 12;
const HISTORY_SHOWN = 10;
// One line of a note as you wrote it (no markdown stripping, which would eat
// the underscores in names like foreign_keys).
const preview = (text, max) => {
  const t = String(text).replace(/```[\s\S]*?```/g, " [code] ").replace(/^([-*+]|\d+[.)])\s+/gm, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** What processing found for one note: new concepts with their questions to keep, and what was already covered. */
function NoteResult({ entry: e, ix, areaNames, onToggle, onKeep }) {
  const covered = e.covered.map(c => (c.course ? `${c.name} (${c.course})` : `${c.name} (another note)`)).join(", ");
  return (
    <div className="panel panel-pad stack gap-4">
      <div className="note-source">
        <Markdown className="small">{e.note.text}</Markdown>
        {e.note.context && <span className="tag">{e.note.context}</span>}
      </div>
      {e.outcome !== "keep" && (
        <div className="row small">
          <span className={cx("grow", e.outcome === "error" ? "error-text" : "muted")}>{e.outcome === "error" ? e.reason : `Skipped. ${e.reason}`}</span>
          {e.outcome === "skip" && <button className="btn btn-sm" onClick={onKeep}>Keep anyway</button>}
        </div>
      )}
      {e.outcome === "keep" && covered && <p className="small muted">Left out, already covered: {covered}.</p>}
      {e.concepts.map((c, ci) => (
        <div key={c.key} className="note-concept stack gap-3">
          <div className="row wrap small">
            <span><span className="muted">{c.area} › {c.topic}:</span> <strong>{c.name}</strong></span>
            {!areaNames.has(nameKey(c.area)) && <span className="tag">New area</span>}
            {c.filledIn && <span className="tag">Filled in by Claude, check it</span>}
            {c.related.map(l => ix.concept[l.id] && <span key={l.id} className="tag" title={l.why}>Linked to {ix.concept[l.id].name}</span>)}
          </div>
          <Markdown className="small muted">{c.summary}</Markdown>
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
      ))}
    </div>
  );
}

/** Where a processed note went: its concepts (by area), what it found already covered, or why it was skipped. */
function NoteOutcome({ note: n, ix, onOpen }) {
  const exists = (id) => Boolean(ix.concept[id]);
  const link = (id) => <button key={id} className="link" onClick={() => onOpen(id)}>{ix.concept[id].name}</button>;
  const made = (n.result?.conceptIds || []).filter(exists);
  const covered = (n.result?.covered || []).filter(exists);
  const merged = (n.result?.merged || []).filter(exists); // from versions that added questions to a matching concept
  return (
    <div className="note-outcome small">
      {made.map(id => <span key={id}>{ix.course[ix.concept[id].courseId]?.name} › {link(id)}</span>)}
      {merged.map(id => <span key={id}>More questions on {link(id)}</span>)}
      {covered.length > 0 && <span>Already covered: {covered.map(link)}</span>}
      {n.status === "skipped" && !covered.length && <span>Skipped. {n.reason}</span>}
      {n.status === "done" && !made.length && !merged.length && <span>What it made has since been deleted.</span>}
    </div>
  );
}

export default function Notes() {
  const { state, act } = useStore();
  const nav = useNav();
  const ix = index(state);
  const areas = noteAreas(state);
  const inbox = state.notes.filter(n => n.status === "inbox");
  const history = state.notes.filter(n => n.status !== "inbox").sort((a, b) => (b.processedAt || 0) - (a.processedAt || 0));
  const skipped = history.filter(n => n.status === "skipped");

  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [review, setReview] = useState(null); // { entries, partial }
  const [hasKey, setHasKey] = useState(null);
  const [conceptId, setConceptId] = useState(nav.route.conceptId ?? null);
  const [showAll, setShowAll] = useState(false);
  const [drag, setDrag] = useState(false);
  const [deleting, setDeleting] = useState(null); // { notes, made }: waiting for you to confirm
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
    const pieces = splitNotes(t, { context: "" });
    addPieces(pieces.length ? pieces : [{ text: t, context: "" }], "Captured");
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
    const inAreas = new Set(payload.concepts.map(c => c.courseId)).size;
    const skippedNow = payload.noteUpdates.filter(u => u.patch.status === "skipped").length;
    setMsg([
      fresh && `${plural(fresh, "new concept")} in ${plural(inAreas, "area")}`,
      payload.courses.length && `${plural(payload.courses.length, "new area")}`,
      skippedNow && `${skippedNow} skipped`,
    ].filter(Boolean).join(", ") + ".");
    setReview(null);
  };

  const regroup = async () => {
    setError(""); setMsg("");
    setBusy({ label: "Regrouping your areas" });
    const res = await planRegroup(state);
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    act("notes/regroup", { moves: res.moves });
    const names = [...new Map(res.moves.map(m => [nameKey(m.area), m.area])).values()];
    setMsg(`Your topics are now in ${plural(names.length, "area")}: ${names.join(", ")}.`);
  };

  // Notes that made concepts ask first, since those concepts (and their history) go too.
  const remove = (notes) => {
    const ids = notes.map(n => n.id);
    const made = madeFrom(state, ids).length;
    if (made) setDeleting({ notes, made });
    else act("notes/delete", { ids });
  };

  const areaNames = new Set(areas.map(c => nameKey(c.name)));
  const chosen = review ? review.entries.reduce((n, e) => n + e.concepts.reduce((m, c) => m + (c.group ? [...c.group.kept, ...c.group.dropped].filter(q => q.selected).length : 0), 0), 0) : 0;

  return (
    <Page>
      <PageHeader center title="Notes"/>

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
            <NoteResult key={e.note.id} entry={e} ix={ix} areaNames={areaNames}
              onKeep={() => keepAnyway(e.note.id)} onToggle={(ci, list, qi) => toggleQuestion(ei, ci, list, qi)}/>
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
                <button className="btn btn-quiet btn-sm btn-icon" title="Delete note" aria-label="Delete note" onClick={() => remove([n])}><Icon name="trash"/></button>
              </div>
            ))}
            {inbox.length > INBOX_SHOWN && <div className="list-row muted small">and {inbox.length - INBOX_SHOWN} more</div>}
          </div>
        </Section>
      )}

      {areas.length > 0 && (
        <Section title="Areas" count={areas.length} actions={
          <button className="btn btn-sm btn-quiet" disabled={!aiBridge() || hasKey === false || Boolean(busy || review)} onClick={regroup}
            title="Have Claude group your topics into a few broad areas"><Icon name="sparkle"/>Regroup</button>
        }>
          <div className="list">{areas.map(c => <CourseRow key={c.id} course={c}/>)}</div>
        </Section>
      )}

      {history.length > 0 && (
        <Section title="Processed" count={history.length} actions={skipped.length > 0 && (
          <button className="btn btn-sm btn-quiet" onClick={() => remove(skipped)}>Clear {plural(skipped.length, "skipped note")}</button>
        )}>
          <div className="list">
            {(showAll ? history : history.slice(0, HISTORY_SHOWN)).map(n => (
              <div key={n.id} className="list-row">
                <div className="grow stack gap-1">
                  <div className="ell">{preview(n.text, 160)}</div>
                  <NoteOutcome note={n} ix={ix} onOpen={setConceptId}/>
                </div>
                {n.status === "skipped" && <button className="btn btn-sm" onClick={() => keepAnyway(n.id)}>Keep anyway</button>}
                <button className="btn btn-quiet btn-sm btn-icon" title="Delete note and what it made" aria-label="Delete note" onClick={() => remove([n])}><Icon name="trash"/></button>
              </div>
            ))}
            {history.length > HISTORY_SHOWN && !showAll && <button className="list-row muted small" onClick={() => setShowAll(true)}>Show all {history.length}</button>}
          </div>
        </Section>
      )}

      {conceptId && <ConceptPanel conceptId={conceptId} onOpen={setConceptId} onClose={() => setConceptId(null)}/>}
      {deleting && (
        <ConfirmDialog title={deleting.notes.length > 1 ? `Delete ${plural(deleting.notes.length, "note")}?` : "Delete this note?"} action="Delete"
          onConfirm={() => act("notes/delete", { ids: deleting.notes.map(n => n.id) })} onClose={() => setDeleting(null)}>
          The {plural(deleting.made, "concept")} made from {pluralWord(deleting.notes.length, "it", "them")} {pluralWord(deleting.made, "goes", "go")} too,
          with {pluralWord(deleting.made, "its", "their")} questions and review history. An area left empty is removed.
        </ConfirmDialog>
      )}
    </Page>
  );
}

// Notes: capture things worth remembering from projects, docs and everyday
// work, then have them turned into questions (see lib/notes.js). Claude files
// each idea under a broad area, a course of its own, and leaves out what you
// already study. Areas can be regrouped into broader ones, and a note can be
// deleted along with everything made from it.
//
// The page stays short however many notes there are: the inbox and the
// history are each one row that opens into a list (ui/layout.jsx Fold), and
// what processing found is one card of ideas, a row each, that open to show
// their questions (Review, below).

import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Page, PageHeader, Section, Fold } from "../../ui/layout.jsx";
import { Notice, Spinner } from "../../ui/display.jsx";
import { ConfirmDialog } from "../../ui/overlays.jsx";
import { cx } from "../../ui/cx.js";
import { index } from "../../lib/model.js";
import { aiAvailable, aiBridge } from "../../lib/ai.js";
import { splitNotes, newNotes, processNotes, buildNotesImport, noteAreas, planRegroup, madeFrom, nameKey } from "../../lib/notes.js";
import { plural, pluralWord } from "../../lib/format.js";
import QuestionRow from "../concepts/QuestionRow.jsx";
import CourseRow from "../courses/CourseRow.jsx";

const PER_RUN = 40; // notes processed per run, so a big upload stays reviewable
// One line of a note as you wrote it (no markdown stripping, which would eat
// the underscores in names like foreign_keys).
const preview = (text, max) => {
  const t = String(text).replace(/```[\s\S]*?```/g, " [code] ").replace(/^([-*+]|\d+[.)])\s+/gm, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const selectedIn = (c) => (c.group ? [...c.group.kept, ...c.group.dropped].filter(q => q.selected).length : 0);

/** One idea a note held: a row (keep it or not, its name, where it's filed, how many questions) that opens to show the rest. */
function ReviewIdea({ entry: e, concept: c, ix, isNewArea, open, onOpen, onToggleAll, onToggle }) {
  const n = selectedIn(c);
  const any = Boolean(c.group && c.group.kept.length + c.group.dropped.length);
  const covered = e.covered.map(k => (k.course ? `${k.name} (${k.course})` : `${k.name} (another note)`)).join(", ");
  return (
    <div className={cx("rv-idea", open && "open", !n && "off")}>
      <div className="rv-row">
        <input type="checkbox" checked={n > 0} disabled={!any} onChange={onToggleAll} aria-label={n ? `Leave out ${c.name}` : `Keep ${c.name}`}/>
        <button type="button" className="rv-toggle" aria-expanded={open} onClick={onOpen}>
          <span className="rv-name">
            <span className="ell">{c.name}</span>
            {(c.filledIn || c.corrected) && <span className="tag warn">Check</span>}
          </span>
          <span className="rv-where"><span className="ell">{c.area} › {c.topic}</span>{isNewArea && <span className="tag">New area</span>}</span>
          <span className="rv-count num">{n ? plural(n, "question") : "Left out"}</span>
          <Icon name="chevron" className="rv-chevron"/>
        </button>
      </div>
      {open && (
        <div className="rv-more">
          <Markdown className="muted">{c.summary}</Markdown>
          {c.corrected && <Notice tone="warn" icon="alert">Your note needed a correction: {c.corrected}</Notice>}
          {c.filledIn && <p className="small muted">Claude filled in part of this from what it knows. Check that it's what you meant.</p>}
          <div className="note-source">
            <Markdown className="small">{e.note.text}</Markdown>
            {e.note.context && <span className="tag">{e.note.context}</span>}
          </div>
          {(covered || c.related.some(l => ix.concept[l.id])) && (
            <p className="small muted">
              {covered && <>Left out of this note, already covered: {covered}. </>}
              {c.related.filter(l => ix.concept[l.id]).map(l => `Linked to ${ix.concept[l.id].name}.`).join(" ")}
            </p>
          )}
          {!c.group && <p className="small muted">Questions for this one couldn't be written. It stays in your inbox if you discard.</p>}
          {c.group && c.group.kept.length === 0 && <p className="small muted">No question passed the quality check. Tick a filtered one below to keep it; otherwise this is skipped.</p>}
          {c.group?.kept.length > 0 && (
            <div className="rq-list">{c.group.kept.map((q, qi) => <QuestionRow key={q.id} q={q} onToggle={() => onToggle("kept", qi)}/>)}</div>
          )}
          {c.group?.dropped.length > 0 && (
            <details className="disclosure">
              <summary>Filtered out ({c.group.dropped.length})</summary>
              <div className="rq-list">{c.group.dropped.map((q, qi) => <QuestionRow key={q.id} q={q} dropped onToggle={() => onToggle("dropped", qi)}/>)}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What processing found, as one card: an idea a row (open one to see its
 * questions), then the notes that were skipped, and Discard and Save at the
 * two ends of its foot. The list scrolls inside the card, so both stay in reach.
 */
function Review({ review, ix, areaNames, chosen, onToggle, onToggleAll, onKeep, onDiscard, onSave }) {
  const [openKey, setOpenKey] = useState(null);
  const ideas = review.entries.flatMap((e, ei) => e.concepts.map((c, ci) => ({ e, ei, c, ci })));
  const others = review.entries.filter(e => !e.concepts.length);
  return (
    <section className="rv">
      <header className="rv-head">
        <h2 className="rv-title">Review<span className="rv-title-count num">{plural(ideas.length, "idea")}</span></h2>
        <span className="small muted">Open an idea to see its questions</span>
      </header>
      <div className="rv-list">
        {ideas.map(({ e, ei, c, ci }) => (
          <ReviewIdea key={c.key} entry={e} concept={c} ix={ix} isNewArea={!areaNames.has(nameKey(c.area))}
            open={openKey === c.key} onOpen={() => setOpenKey(k => (k === c.key ? null : c.key))}
            onToggleAll={() => onToggleAll(ei, ci)} onToggle={(list, qi) => onToggle(ei, ci, list, qi)}/>
        ))}
        {others.length > 0 && <div className="rv-sub">Not kept<span className="num">{others.length}</span></div>}
        {others.map(e => (
          <div key={e.note.id} className="rv-row rv-other">
            <span className="rv-name"><span className="ell">{preview(e.note.text, 160)}</span></span>
            <span className={cx("rv-why", e.outcome === "error" && "error-text")}>{e.outcome === "error" ? e.reason : e.reason || "Skipped"}</span>
            {e.outcome === "skip" && <button className="btn btn-sm" onClick={() => onKeep(e.note.id)}>Keep anyway</button>}
          </div>
        ))}
      </div>
      <footer className="card-foot">
        <button className="btn" onClick={onDiscard}>Discard</button>
        <button className="btn btn-primary" disabled={!chosen} onClick={onSave}>Save {plural(chosen, "question")}</button>
      </footer>
    </section>
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
  const [open, setOpen] = useState(null); // which list is open: "inbox", "history" or neither
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

  // Keep or leave out a whole idea: all the questions that passed, or none.
  const toggleIdea = (ei, ci) => setReview(r => ({
    ...r,
    entries: r.entries.map((e, i) => (i !== ei ? e : {
      ...e,
      concepts: e.concepts.map((c, j) => {
        if (j !== ci || !c.group) return c;
        const any = [...c.group.kept, ...c.group.dropped].some(q => q.selected);
        return { ...c, group: { ...c.group, kept: c.group.kept.map(q => ({ ...q, selected: !any })), dropped: c.group.dropped.map(q => ({ ...q, selected: false })) } };
      }),
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
  const chosen = review ? review.entries.reduce((n, e) => n + e.concepts.reduce((m, c) => m + selectedIn(c), 0), 0) : 0;
  const reviewing = Boolean(review && !busy);

  return (
    <Page>
      <PageHeader center title="Notes"/>

      {!aiBridge() && <Notice>Turning notes into questions runs in the desktop app. You can still collect notes here.</Notice>}
      {aiBridge() && hasKey === false && <Notice tone="warn" icon="alert">Add your Anthropic API key in <button className="link" onClick={() => nav.go("settings")}>Settings</button> to turn notes into questions.</Notice>}

      {!reviewing && (
        <div className={cx("capture", drag && "over")}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); readFiles([...e.dataTransfer.files]); }}>
          <textarea id="note-text" ref={taRef} className="capture-text" rows={3} value={text} aria-label="Capture a note"
            placeholder="Capture a note: something you learned, in a sentence or two"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); capture(); } }}/>
          <div className="capture-foot">
            <button className="btn" onClick={() => fileRef.current?.click()} title="Upload .md or .txt notes (or drop them here)"><Icon name="upload"/>Upload notes</button>
            <button className="btn btn-primary" disabled={!text.trim()} onClick={capture}><Icon name="plus"/>Add note</button>
          </div>
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt,.text,text/plain,text/markdown" multiple hidden onChange={e => { readFiles([...e.target.files]); e.target.value = ""; }}/>
        </div>
      )}

      {msg && <Notice icon="check">{msg}</Notice>}
      {error && <Notice tone="warn" icon="alert">{error}</Notice>}
      {busy && <div className="panel panel-pad busy"><Spinner/>{busy.label}{busy.total > 1 ? ` (${busy.done} of ${busy.total})` : ""}…</div>}

      {reviewing && review.partial && <Notice tone="warn" icon="alert">Part of this didn't go through: {review.partial}. Those notes stay in your inbox.</Notice>}
      {reviewing && (
        <Review review={review} ix={ix} areaNames={areaNames} chosen={chosen}
          onToggle={toggleQuestion} onToggleAll={toggleIdea} onKeep={keepAnyway} onDiscard={() => setReview(null)} onSave={save}/>
      )}

      {!review && !busy && inbox.length > 0 && (
        <Fold title="Inbox" count={inbox.length} open={open === "inbox"} onToggle={(v) => setOpen(v ? "inbox" : null)} actions={
          <button className="btn btn-primary" disabled={!aiBridge() || hasKey === false} onClick={process}>
            <Icon name="sparkle"/>{inbox.length > PER_RUN ? `Process next ${PER_RUN}` : "Process notes"}
          </button>
        }>
          {inbox.map(n => (
            <div key={n.id} className="fold-row">
              <div className="note-text grow">{preview(n.text, 220)}</div>
              {n.force && <span className="tag">Keep anyway</span>}
              {n.source && n.source !== "Captured" && <span className="note-from">{n.source}</span>}
              <div className="fold-row-actions">
                <button className="btn btn-quiet btn-sm btn-icon" title="Delete note" aria-label="Delete note" onClick={() => remove([n])}><Icon name="trash"/></button>
              </div>
            </div>
          ))}
        </Fold>
      )}

      {!reviewing && areas.length > 0 && (
        <Section title="Areas" count={areas.length} actions={
          <button className="btn btn-sm btn-quiet" disabled={!aiBridge() || hasKey === false || Boolean(busy || review)} onClick={regroup}
            title="Have Claude group your topics into a few broad areas"><Icon name="sparkle"/>Regroup</button>
        }>
          <div className="list">{areas.map(c => <CourseRow key={c.id} course={c}/>)}</div>
        </Section>
      )}

      {!reviewing && history.length > 0 && (
        <Fold title="Processed" count={history.length} open={open === "history"} onToggle={(v) => setOpen(v ? "history" : null)} actions={skipped.length > 0 && (
          <button className="btn btn-quiet" onClick={() => remove(skipped)}>Clear {plural(skipped.length, "skipped note")}</button>
        )}>
          {history.map(n => (
            <div key={n.id} className="fold-row">
              <div className="note-line">
                <div className="note-text">{preview(n.text, 200)}</div>
                <NoteOutcome note={n} ix={ix} onOpen={(id) => nav.go("course", { courseId: ix.concept[id].courseId, conceptId: id, at: Date.now() })}/>
              </div>
              {n.status === "skipped" && <button className="btn btn-sm" onClick={() => keepAnyway(n.id)}>Keep anyway</button>}
              <div className="fold-row-actions">
                <button className="btn btn-quiet btn-sm btn-icon" title="Delete note and what it made" aria-label="Delete note" onClick={() => remove([n])}><Icon name="trash"/></button>
              </div>
            </div>
          ))}
        </Fold>
      )}

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

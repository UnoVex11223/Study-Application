// The shelf: books you read for their own sake, textbooks and courses, each
// with its own tab (Tenax courses are on it automatically, see lib/shelf.js).
// Reading books also keep notes in your own words, a rating, and a recall now
// and then: say what you remember, then compare with your notes (see
// lib/recall.js).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useNav, pct } from "../ui/nav.js";
import { Bar, Drawer, Modal, Spinner } from "../ui/ui.jsx";
import Icon from "../ui/Icon.jsx";
import { shelfEntries, shelfStats, SHELF_FILTERS, SHELF_KINDS, categoryOf, makeShelfItem, itemFinished } from "../lib/shelf.js";
import { dueForRecall, recallWhen, hasNotes, RECALL_RATINGS } from "../lib/recall.js";
import { shrinkImage } from "../lib/image.js";

const initials = (t) => String(t || "?").split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
const longDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const monthYear = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", year: "numeric" });

// "Want to read" is for books only.
const STATUS = {
  reading: { active: "Reading", finished: "Finished", want: "Want to read" },
  study: { active: "In progress", finished: "Finished" },
};
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function Stars({ value, onChange, size = 15 }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className={`stars${onChange ? " editable" : ""}`} onMouseLeave={() => setHover(0)} role={onChange ? "radiogroup" : "img"} aria-label={`${value || 0} of 5 stars`}>
      {[1, 2, 3, 4, 5].map(n => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" aria-hidden={!onChange}
          role={onChange ? "radio" : undefined} aria-checked={onChange ? value === n : undefined}
          onMouseEnter={() => onChange && setHover(n)} onClick={() => onChange?.(value === n ? 0 : n)}>
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
            fill={n <= shown ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      ))}
    </span>
  );
}

/** A cover image filling its box, or the title's initials. */
function Cover({ src, title, className = "" }) {
  if (!src) return <div className={`shelf-blank ${className}`}><span>{initials(title)}</span></div>;
  return <img className={`cover-img ${className}`} src={src} alt="" draggable={false}/>;
}

export default function Shelf({ recall: startRecall = false }) {
  const { state, act } = useStore();
  const nav = useNav();
  const [filter, setFilter] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState(null); // null | { entry } (entry null = new)
  const [openId, setOpenId] = useState(null);
  const [recallQueue, setRecallQueue] = useState(() => (startRecall ? dueForRecall(state.shelf, Date.now()).map(it => it.id) : null));

  const entries = useMemo(() => shelfEntries(state, nav.now), [state, nav.now]);
  const stats = shelfStats(entries);
  const due = dueForRecall(state.shelf, nav.now);
  const tab = SHELF_FILTERS.find(f => f.id === filter);
  const shown = entries.filter(e => !e.hidden && tab.test(e));
  const hidden = entries.filter(e => e.hidden);
  const open = state.shelf.find(it => it.id === openId && it.kind === "reading" && !it.courseId) || null;
  const add = () => setEditing({ entry: null });

  // Log a chapter by hand. On a Tenax course you can't go below what Tenax counts.
  const bump = (e, d) => {
    const done = Math.max(e.read, e.done + d, 0);
    const capped = e.total ? Math.min(e.total, done) : done;
    if (e.item) act("shelf/update", { id: e.item.id, patch: { done: capped } });
    else act("shelf/add", { item: makeShelfItem({ courseId: e.course.id, kind: e.kind, unitLabel: e.unit, done: capped }) });
  };
  const setHidden = (e, hide) => (e.item
    ? act("shelf/update", { id: e.item.id, patch: { hidden: hide } })
    : act("shelf/add", { item: makeShelfItem({ courseId: e.course.id, kind: e.kind, unitLabel: e.unit, hidden: hide }) }));
  const openEntry = (e) => (e.course ? nav.go("course", { courseId: e.course.id })
    : e.kind === "reading" ? setOpenId(e.item.id)
    : setEditing({ entry: e }));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Shelf</h1></div>
        <div className="row">
          {due.length > 0 && (
            <button className="btn" onClick={() => setRecallQueue(due.map(it => it.id))}>
              <Icon name="play" size={12}/>Recall {due.length}
            </button>
          )}
          <button className="btn btn-primary" onClick={add}><Icon name="plus" size={16}/>Add to shelf</button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="panel empty">
          <h3>Your shelf is empty</h3>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={add}><Icon name="plus" size={16}/>Add to shelf</button>
          </div>
        </div>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 22 }}>
            <div className="stat"><div className="stat-value">{stats.count}</div><div className="stat-label">On the shelf</div></div>
            <div className="stat"><div className="stat-value">{stats.active}</div><div className="stat-label">In progress</div></div>
            <div className="stat"><div className="stat-value">{stats.finished}</div><div className="stat-label">Finished</div></div>
            <div className="stat"><div className="stat-value">{stats.due}</div><div className="stat-label">To recall</div></div>
          </div>

          <div className="shelf-filters">
            <div className="seg" role="tablist" aria-label="Show">
              {SHELF_FILTERS.map(f => (
                <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>{f.label}</button>
              ))}
            </div>
          </div>

          <div className="shelf-grid">
            {shown.map(e => (
              <ShelfCard key={e.key} entry={e}
                onOpen={() => openEntry(e)}
                onEdit={() => setEditing({ entry: e })}
                onBump={(d) => bump(e, d)}
                onHide={() => setHidden(e, true)}
                onRemove={() => act("shelf/remove", { id: e.item.id })}/>
            ))}
            {(filter === "all" || tab.kind) && (
              <button className="shelf-add" onClick={add}>
                <Icon name="plus" size={22}/>
                <span>{tab.kind ? `Add a ${SHELF_KINDS[tab.kind].label.toLowerCase()}` : "Add to shelf"}</span>
              </button>
            )}
          </div>
          {shown.length === 0 && !tab.kind && filter !== "all" && <p className="muted small" style={{ textAlign: "center", marginTop: 28 }}>Nothing here yet.</p>}

          {hidden.length > 0 && (
            <div style={{ marginTop: 28, textAlign: "center" }}>
              <button className="btn btn-quiet btn-sm" onClick={() => setShowHidden(v => !v)}>
                {showHidden ? "Done" : `Hidden from the shelf (${hidden.length})`}
              </button>
              {showHidden && (
                <div className="shelf-grid" style={{ marginTop: 16, textAlign: "left" }}>
                  {hidden.map(e => (
                    <ShelfCard key={e.key} entry={e} dim
                      onOpen={() => setHidden(e, false)} onEdit={() => setEditing({ entry: e })}
                      onBump={() => {}} onHide={() => setHidden(e, false)}/>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {open && <ItemPanel key={open.id} item={open} now={nav.now} onClose={() => setOpenId(null)}
        onEdit={() => setEditing({ entry: entries.find(e => e.item?.id === open.id) })}
        onRecall={() => setRecallQueue([open.id])}/>}
      {editing && <ShelfForm entry={editing.entry} startKind={tab.kind || "reading"} onClose={() => setEditing(null)}
        onSaved={(item, created) => {
          setEditing(null);
          if (item.kind !== "reading") setOpenId(null);
          else if (created) setOpenId(item.id);
        }}/>}
      {recallQueue && <RecallSession queue={recallQueue} onClose={() => setRecallQueue(null)}/>}
    </div>
  );
}

function ShelfCard({ entry: e, dim, onOpen, onEdit, onBump, onHide, onRemove }) {
  const [confirming, setConfirming] = useState(false);
  const stop = (fn) => (ev) => { ev.stopPropagation(); fn(); };
  const reading = e.category === "reading";
  const status = STATUS[e.category];
  const progress = e.total
    ? `${e.done} / ${e.total} ${e.unit}`
    : e.finished ? (e.finishedAt ? monthYear(e.finishedAt) : "Done")
    : e.want ? status.want
    : e.done ? `${e.done} ${e.unit} ${reading ? "read" : "done"}` : "Not started";
  return (
    <article className={`shelf-card${dim ? " dim" : ""}`}>
      <div className="shelf-cover" onClick={onOpen} role="button" tabIndex={0}
        aria-label={`Open ${e.title}`}
        onKeyDown={(ev) => { if (ev.key === "Enter") onOpen(); }}>
        <Cover src={e.cover} title={e.title}/>
        {e.finished && <span className="shelf-done"><Icon name="check" size={13}/>Finished</span>}
        {e.want && <span className="shelf-done quiet">{status.want}</span>}
        {e.recallDue && !dim && <span className="shelf-due">Recall</span>}
        <div className="shelf-acts">
          <button className="shelf-act" title="Edit" aria-label="Edit" onClick={stop(onEdit)}><Icon name="edit" size={15}/></button>
          {dim ? (
            <button className="shelf-act" title="Put back on the shelf" aria-label="Put back on the shelf" onClick={stop(onHide)}><Icon name="undo" size={15}/></button>
          ) : e.linked ? (
            <button className="shelf-act" title="Hide from the shelf" aria-label="Hide from the shelf" onClick={stop(onHide)}><Icon name="x" size={15}/></button>
          ) : (
            <button className="shelf-act" title="Remove" aria-label="Remove" onClick={stop(() => setConfirming(true))}><Icon name="trash" size={15}/></button>
          )}
        </div>
      </div>
      <div className="shelf-body">
        <div className="shelf-title">{e.title}</div>
        {reading && (e.author || e.rating > 0) && (
          <div className="shelf-byline">
            {e.author && <span className="ell">{e.author}</span>}
            {e.rating > 0 && <Stars value={e.rating} size={11}/>}
          </div>
        )}
        <div className="shelf-foot">
          <div className="shelf-prog">
            <span>{progress}</span>
            {e.total > 0
              ? <span>{pct(e.pct)}</span>
              : !dim && !e.finished && !e.want && <button className="shelf-link" onClick={onEdit}>Set total</button>}
          </div>
          <Bar value={e.pct} tone={e.finished ? "good" : undefined} thin/>
          {!reading && (
            <div className="shelf-step">
              <button className="btn btn-sm btn-icon" disabled={dim || e.done <= e.read} onClick={() => onBump(-1)} aria-label={`One ${e.unit.replace(/s$/, "")} less`}>−</button>
              {e.linked ? (
                <span className="shelf-meta" title="Chapters read and mastery in Tenax">
                  <Icon name="link" size={12}/>{e.read} read{e.mastery != null && e.read > 0 ? ` · ${pct(e.mastery)} mastered` : ""}
                </span>
              ) : (
                <span>{e.finished ? "Finished" : `Log ${e.unit}`}</span>
              )}
              <button className="btn btn-sm btn-icon" disabled={dim || (e.total > 0 && e.done >= e.total)} onClick={() => onBump(1)} aria-label={`One more ${e.unit.replace(/s$/, "")}`}>+</button>
            </div>
          )}
        </div>
      </div>
      {confirming && (
        <div className="shelf-confirm">
          <div>Remove “{e.title}” from your shelf?</div>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn btn-sm btn-quiet" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn btn-sm btn-danger" onClick={onRemove}>Remove</button>
          </div>
        </div>
      )}
    </article>
  );
}

/** Notes save as you type (after a short pause) and when the panel closes. */
function useDraft(item, act) {
  const [draft, setDraft] = useState({ description: item.description || "", thoughts: item.thoughts || "", ideas: item.ideas || "" });
  const pending = useRef(null);
  const timer = useRef(0);
  const id = item.id;
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current) { act("shelf/update", { id, patch: pending.current }); pending.current = null; }
  }, [act, id]);
  useEffect(() => flush, [flush]);
  const change = (field, value) => {
    setDraft(d => ({ ...d, [field]: value }));
    pending.current = { ...(pending.current || {}), [field]: value };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  return [draft, change];
}

/** A book you're reading: status, pages, rating, notes and recall. */
function ItemPanel({ item, now, onClose, onEdit, onRecall }) {
  const { act } = useStore();
  const [draft, change] = useDraft(item, act);
  const [confirm, setConfirm] = useState(false);
  const patch = (p) => act("shelf/update", { id: item.id, patch: p });
  const finished = itemFinished(item);
  const status = item.status === "want" && !finished ? "want" : finished ? "finished" : "active";
  const unit = item.unitLabel || "pages";

  return (
    <Drawer onClose={onClose} title={item.title} subtitle={item.author || undefined}
      actions={<button className="btn btn-sm btn-quiet" onClick={onEdit}><Icon name="edit" size={14}/>Edit</button>}>
      <div className="book-panel-top">
        <Cover src={item.cover} title={item.title} className="panel-cover"/>
        <div className="stack" style={{ gap: 12, minWidth: 0 }}>
          <div className="seg" role="group" aria-label="Status">
            {Object.entries(STATUS.reading).map(([k, label]) => (
              <button key={k} className={status === k ? "on" : ""} onClick={() => patch({ status: k })}>{label}</button>
            ))}
          </div>
          {status !== "want" && (
            <div className="row" style={{ gap: 8 }}>
              <input className="input" type="number" min="0" style={{ width: 84 }} aria-label={`${unit} done`} value={item.done || ""}
                onChange={e => patch({ done: Math.max(0, parseInt(e.target.value, 10) || 0) })}/>
              <span className="muted small">of</span>
              <input className="input" type="number" min="0" style={{ width: 84 }} aria-label={`Total ${unit}`} value={item.total || ""}
                onChange={e => patch({ total: Math.max(0, parseInt(e.target.value, 10) || 0) })}/>
              <span className="muted small">{unit}</span>
            </div>
          )}
          {finished && <Stars value={item.rating || 0} onChange={(n) => patch({ rating: n })} size={18}/>}
          <div className="book-dates">
            {item.startedAt && <span>Started {longDate(item.startedAt)}</span>}
            {item.finishedAt && <span>Finished {longDate(item.finishedAt)}</span>}
          </div>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="it-about">What it's about</label>
          <textarea id="it-about" className="textarea" style={{ minHeight: 80 }} value={draft.description} onChange={e => change("description", e.target.value)}/>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="it-thoughts">What I thought</label>
          <textarea id="it-thoughts" className="textarea" style={{ minHeight: 80 }} value={draft.thoughts} onChange={e => change("thoughts", e.target.value)}/>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="it-ideas">Ideas worth keeping</label>
          <textarea id="it-ideas" className="textarea" style={{ minHeight: 80 }} value={draft.ideas} onChange={e => change("ideas", e.target.value)}/>
        </div>
      </div>

      {hasNotes({ ...item, ...draft }) && (
        <div className="book-recall-row">
          <span className="grow small">
            {item.recall
              ? <>Next recall {recallWhen(item.recall, now)}{item.recall.count ? <span className="muted"> · recalled {item.recall.count} time{item.recall.count === 1 ? "" : "s"}</span> : null}</>
              : "First recall in 3 days"}
          </span>
          <button className="btn btn-sm" onClick={onRecall}><Icon name="play" size={11}/>Recall now</button>
        </div>
      )}

      <div>
        {!confirm
          ? <button className="btn btn-sm btn-quiet" onClick={() => setConfirm(true)}><Icon name="trash" size={14}/>Remove from shelf</button>
          : (
            <div className="row" style={{ gap: 8 }}>
              <span className="small grow">Remove “{item.title}” and its notes?</span>
              <button className="btn btn-sm btn-quiet" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-sm btn-danger" onClick={() => { act("shelf/remove", { id: item.id }); onClose(); }}>Remove</button>
            </div>
          )}
      </div>
    </Drawer>
  );
}

function ShelfForm({ entry, startKind, onClose, onSaved }) {
  const { act } = useStore();
  const item = entry?.item || null;
  const linkedAlready = Boolean(entry?.course);
  const [kind, setKind] = useState(entry?.kind || startKind);
  const [title, setTitle] = useState(entry?.title || "");
  const [author, setAuthor] = useState(entry?.author || "");
  const [cover, setCover] = useState(entry?.cover || null);
  const [status, setStatus] = useState(entry ? (entry.want ? "want" : entry.finished ? "finished" : "active") : "active");
  const [unitLabel, setUnitLabel] = useState(capitalize(entry && entry.category === "study" ? entry.unit : SHELF_KINDS[kind].unit));
  const [unitTouched, setUnitTouched] = useState(Boolean(entry && entry.category === "study"));
  const [total, setTotal] = useState(item?.total || "");
  const [done, setDone] = useState(entry?.done ?? 0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  const reading = kind === "reading";
  // Books are counted in pages, unless one of yours was already counted another way.
  const readingUnit = entry?.category === "reading" && entry.unit ? entry.unit : "pages";
  // Tenax courses are on the shelf by themselves; editing one keeps it linked.
  const course = entry?.course || null;
  const statuses = STATUS[categoryOf(kind)];
  const shownStatus = statuses[status] ? status : "active";
  // A Tenax course is a textbook or a course; anything else can be any kind.
  const kinds = Object.keys(SHELF_KINDS).filter(k => !linkedAlready || categoryOf(k) === "study");

  const pickKind = (k) => {
    setKind(k);
    if (k !== "reading" && !unitTouched) setUnitLabel(capitalize(SHELF_KINDS[k].unit));
  };
  const takeFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try { setCover(await shrinkImage(file)); setError(""); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const save = () => {
    const t = title.trim() || course?.name || "";
    if (!t) return setError("Give it a title.");
    const tot = Math.max(0, parseInt(total, 10) || 0);
    const unit = unitLabel.trim();
    const st = shownStatus;
    const fields = {
      kind, cover, author: reading ? author.trim() : "",
      title: course && t === course.name ? "" : t, // follows the course's name unless you changed it
      // Shown capitalized here; cards read "4 / 12 chapters".
      unitLabel: reading ? readingUnit : /^(chapters|modules)$/i.test(unit) ? unit.toLowerCase() : unit || SHELF_KINDS[kind].unit,
      total: tot,
      done: st === "want" ? 0 : Math.max(0, tot ? Math.min(tot, parseInt(done, 10) || 0) : parseInt(done, 10) || 0),
      courseId: course?.id ?? null,
      ...(course ? {} : { status: st }),
    };
    if (item) { act("shelf/update", { id: item.id, patch: fields }); onSaved({ ...item, ...fields }, false); return; }
    const created = makeShelfItem(fields);
    act("shelf/add", { item: created });
    onSaved(created, true);
  };

  return (
    <Modal title={entry ? "Edit" : "Add to your shelf"} onClose={onClose} width={580}
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{entry ? "Save changes" : "Add to shelf"}</button>
      </>}>
      <div className={kinds.length > 1 ? "shelf-form-top" : undefined}>
        {kinds.length > 1 && (
          <div className="field">
            <span className="label">Type</span>
            <div className="seg">
              {kinds.map(k => (
                <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => pickKind(k)}>{SHELF_KINDS[k].label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="shelf-title">Title</label>
          <input id="shelf-title" className="input" value={title} autoFocus={!entry} onChange={e => setTitle(e.target.value)}/>
        </div>
      </div>
      {reading && (
        <div className="field">
          <label htmlFor="shelf-author">Author</label>
          <input id="shelf-author" className="input" value={author} onChange={e => setAuthor(e.target.value)}/>
        </div>
      )}
      <div className="field">
        <span className="label">Cover</span>
        {cover ? (
          <div className="shelf-cover-edit">
            <Cover src={cover} title={title} className={`edit-cover${reading ? " portrait" : ""}`}/>
            <button type="button" className="btn btn-sm" onClick={() => setCover(null)}><Icon name="x" size={14}/>Remove</button>
          </div>
        ) : (
          <button type="button" className={`dropzone${over ? " over" : ""}`} onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); takeFile(e.dataTransfer.files?.[0]); }}>
            {busy ? <Spinner/> : <Icon name="upload" size={18}/>}
            <span>Drop an image or click to choose one</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { takeFile(e.target.files?.[0]); e.target.value = ""; }}/>
      </div>
      {!course && (
        <div className="field">
          <span className="label">Status</span>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {Object.entries(statuses).map(([k, label]) => (
              <button key={k} type="button" className={shownStatus === k ? "on" : ""} onClick={() => setStatus(k)}>{label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="shelf-form-row">
        {!reading && (
          <div className="field">
            <label htmlFor="shelf-unit">Counted in</label>
            <input id="shelf-unit" className="input" value={unitLabel} onChange={e => { setUnitLabel(e.target.value); setUnitTouched(true); }}/>
          </div>
        )}
        <div className="field">
          <label htmlFor="shelf-total">{reading ? capitalize(readingUnit) : "Total"}</label>
          <input id="shelf-total" className="input" type="number" min="0" value={total} onChange={e => setTotal(e.target.value)}/>
        </div>
        {shownStatus !== "want" && (
          <div className="field">
            <label htmlFor="shelf-done">{reading ? "Read so far" : "Done so far"}</label>
            <input id="shelf-done" className="input" type="number" min="0" value={done} onChange={e => setDone(e.target.value)}/>
          </div>
        )}
      </div>
      {error && <p className="small" style={{ color: "var(--bad)" }}>{error}</p>}
    </Modal>
  );
}

/** One at a time: say what you remember, then compare with your notes and say how it went. */
function RecallSession({ queue, onClose }) {
  const { state, act } = useStore();
  const [at, setAt] = useState(0);
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  const [keep, setKeep] = useState(false);
  const [done, setDone] = useState(0);
  const item = state.shelf.find(it => it.id === queue[at]);

  const rate = (rating) => {
    act("shelf/recall", { id: item.id, rating, note: keep ? text : "" });
    setDone(n => n + 1);
    setAt(i => i + 1);
    setText(""); setShown(false); setKeep(false);
  };

  if (!item) {
    return (
      <Modal title="Recall" onClose={onClose} width={620}
        footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
        <p style={{ margin: 0 }}>{done ? `${done} recalled.` : "Nothing to recall right now."}</p>
      </Modal>
    );
  }

  return (
    <Modal title="Recall" onClose={onClose} width={620}>
      <div className="recall-head">
        <Cover src={item.cover} title={item.title} className="recall-cover"/>
        <div style={{ minWidth: 0 }}>
          <div className="muted small">{at + 1} of {queue.length}</div>
          <div className="recall-title">{item.title}</div>
          {item.author && <div className="muted">{item.author}</div>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="rc-text">What do you remember?</label>
        <textarea id="rc-text" className="textarea" style={{ minHeight: 110 }} value={text} autoFocus
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !shown) { e.preventDefault(); setShown(true); } }}/>
      </div>
      {!shown ? (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={() => setShown(true)}>Show my notes</button>
        </div>
      ) : (
        <>
          <div className="recall-notes">
            {item.description?.trim() && <div><div className="label">What it's about</div><p>{item.description}</p></div>}
            {item.thoughts?.trim() && <div><div className="label">What I thought</div><p>{item.thoughts}</p></div>}
            {item.ideas?.trim() && <div><div className="label">Ideas worth keeping</div><p>{item.ideas}</p></div>}
          </div>
          {text.trim() && (
            <label className="row small" style={{ gap: 8, margin: "14px 0 4px", cursor: "pointer" }}>
              <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)}/>Add what I wrote to my notes
            </label>
          )}
          <div className="recall-ratings">
            {RECALL_RATINGS.map(r => (
              <button key={r.rating} className="btn" onClick={() => rate(r.rating)}>{r.label}</button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

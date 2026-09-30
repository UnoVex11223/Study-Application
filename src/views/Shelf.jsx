// The shelf: the books and courses you're working through, with covers and
// progress. Tenax courses are on it automatically (see lib/shelf.js). Books and
// courses you add yourself also keep notes in your own words, a rating, and a
// recall now and then: say what you remember, then compare with your notes
// (see lib/recall.js).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useNav, pct } from "../ui/nav.js";
import { Bar, Drawer, Modal, Notice, Spinner } from "../ui/ui.jsx";
import Icon from "../ui/Icon.jsx";
import { shelfEntries, shelfStats, SHELF_FILTERS, SHELF_KINDS, SHELF_STATUS, makeShelfItem, itemFinished, fromAeroShelf } from "../lib/shelf.js";
import { dueForRecall, recallWhen, hasNotes, RECALL_RATINGS } from "../lib/recall.js";
import { shrinkImage } from "../lib/image.js";

const legacyBridge = () => (typeof window !== "undefined" ? window.tenax?.shelf : null);
const initials = (t) => String(t || "?").split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
const longDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

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

/** A cover that fits any shape: book covers stand in front of a blurred copy of themselves. */
function Cover({ src, title, className = "" }) {
  const [wide, setWide] = useState(false);
  if (!src) return <div className={`shelf-blank ${className}`}><span>{initials(title)}</span></div>;
  return (
    <div className={`cover-frame${wide ? " wide" : ""} ${className}`}>
      <img className="cover-bg" src={src} alt="" draggable={false} aria-hidden="true"/>
      <img className="cover-fg" src={src} alt="" draggable={false}
        onLoad={(e) => setWide(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight > 1.25)}/>
    </div>
  );
}

export default function Shelf({ recall: startRecall = false }) {
  const { state, act } = useStore();
  const nav = useNav();
  const [filter, setFilter] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState(null); // null | { entry } (entry null = new)
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [recallQueue, setRecallQueue] = useState(() => (startRecall ? dueForRecall(state.shelf, Date.now()).map(it => it.id) : null));

  const entries = useMemo(() => shelfEntries(state, nav.now), [state, nav.now]);
  const stats = shelfStats(entries);
  const due = dueForRecall(state.shelf, nav.now);
  const test = SHELF_FILTERS.find(f => f.id === filter).test;
  const shown = entries.filter(e => !e.hidden && test(e));
  const hidden = entries.filter(e => e.hidden);
  const canImport = Boolean(legacyBridge()) && !state.settings.aeroshelfImportedAt;
  const open = state.shelf.find(it => it.id === openId && !it.courseId) || null;

  // Log a chapter by hand. On a Tenax course you can't go below what Tenax counts.
  const bump = (e, d) => {
    const done = Math.max(e.read, e.done + d, 0);
    const capped = e.total ? Math.min(e.total, done) : done;
    if (e.item) act("shelf/update", { id: e.item.id, patch: { done: capped } });
    else act("shelf/add", { item: makeShelfItem({ courseId: e.course.id, kind: e.kind, done: capped }) });
  };
  const setHidden = (e, hide) => (e.item
    ? act("shelf/update", { id: e.item.id, patch: { hidden: hide } })
    : act("shelf/add", { item: makeShelfItem({ courseId: e.course.id, kind: e.kind, hidden: hide }) }));
  const openEntry = (e) => (e.course ? nav.go("course", { courseId: e.course.id }) : setOpenId(e.item.id));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Shelf</h1></div>
        <div className="row">
          {canImport && <button className="btn" onClick={() => setImporting(true)}><Icon name="download" size={15}/>Import from AeroShelf</button>}
          {due.length > 0 && (
            <button className="btn" onClick={() => setRecallQueue(due.map(it => it.id))}>
              <Icon name="play" size={12}/>Recall {due.length}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setEditing({ entry: null })}><Icon name="plus" size={16}/>Add to shelf</button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="panel empty">
          <h3>Your shelf is empty</h3>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => setEditing({ entry: null })}><Icon name="plus" size={16}/>Add to shelf</button>
            {canImport && <button className="btn" onClick={() => setImporting(true)}><Icon name="download" size={15}/>Import from AeroShelf</button>}
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
                onSetTotal={() => setEditing({ entry: e })}
                onEdit={() => setEditing({ entry: e })}
                onBump={(d) => bump(e, d)}
                onHide={() => setHidden(e, true)}
                onRemove={() => act("shelf/remove", { id: e.item.id })}/>
            ))}
            {filter === "all" && (
              <button className="shelf-add" onClick={() => setEditing({ entry: null })}>
                <Icon name="plus" size={22}/>
                <span>Add a book or course</span>
              </button>
            )}
          </div>
          {shown.length === 0 && filter !== "all" && <p className="muted small" style={{ textAlign: "center", marginTop: 28 }}>Nothing here yet.</p>}

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
      {editing && <ShelfForm entry={editing.entry} onClose={() => setEditing(null)}
        onCreated={(id, standalone) => { setEditing(null); if (standalone) setOpenId(id); }}/>}
      {importing && <ImportAeroShelf onClose={() => setImporting(false)}/>}
      {recallQueue && <RecallSession queue={recallQueue} onClose={() => setRecallQueue(null)}/>}
    </div>
  );
}

function ShelfCard({ entry: e, dim, onOpen, onEdit, onBump, onHide, onRemove, onSetTotal }) {
  const [confirming, setConfirming] = useState(false);
  const stop = (fn) => (ev) => { ev.stopPropagation(); fn(); };
  return (
    <article className={`shelf-card${dim ? " dim" : ""}`}>
      <div className="shelf-cover" onClick={onOpen} role="button" tabIndex={0}
        aria-label={`Open ${e.title}`}
        onKeyDown={(ev) => { if (ev.key === "Enter") onOpen(); }}>
        <Cover src={e.cover} title={e.title}/>
        {e.finished && <span className="shelf-done"><Icon name="check" size={13}/>Finished</span>}
        {e.want && <span className="shelf-done quiet">Want to read</span>}
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
        {(e.author || e.rating > 0) && (
          <div className="shelf-byline">
            {e.author && <span className="ell">{e.author}</span>}
            {e.rating > 0 && <Stars value={e.rating} size={11}/>}
          </div>
        )}
        {e.description && <div className="shelf-desc">{e.description}</div>}
        <div className="shelf-foot">
          <div className="shelf-prog">
            <span>{e.total ? `${e.done} / ${e.total} ${e.unit}` : e.finished ? (e.finishedAt ? new Date(e.finishedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "Done") : e.done ? `${e.done} ${e.unit} read` : `No ${e.unit} yet`}</span>
            {e.total > 0
              ? <span>{pct(e.pct)}</span>
              : !dim && !e.finished && onSetTotal && <button className="shelf-link" onClick={onSetTotal}>Set total</button>}
          </div>
          <Bar value={e.pct} tone={e.finished ? "good" : undefined} thin/>
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

/** A book or course you track yourself: status, progress, rating, notes and recall. */
function ItemPanel({ item, now, onClose, onEdit, onRecall }) {
  const { act } = useStore();
  const [draft, change] = useDraft(item, act);
  const [confirm, setConfirm] = useState(false);
  const patch = (p) => act("shelf/update", { id: item.id, patch: p });
  const finished = itemFinished(item);
  const status = item.status === "want" && !finished ? "want" : finished ? "finished" : "active";
  const unit = item.unitLabel || "chapters";

  return (
    <Drawer onClose={onClose} title={item.title} subtitle={item.author || undefined}
      actions={<button className="btn btn-sm btn-quiet" onClick={onEdit}><Icon name="edit" size={14}/>Edit</button>}>
      <div className="book-panel-top">
        <Cover src={item.cover} title={item.title} className="panel-cover"/>
        <div className="stack" style={{ gap: 12, minWidth: 0 }}>
          <div className="seg" role="group" aria-label="Status">
            {Object.entries(SHELF_STATUS).map(([k, v]) => (
              <button key={k} className={status === k ? "on" : ""} onClick={() => patch({ status: k })}>{v.label}</button>
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

function ShelfForm({ entry, onClose, onCreated }) {
  const { state, act } = useStore();
  const item = entry?.item || null;
  const [kind, setKind] = useState(entry?.kind || "book");
  const [title, setTitle] = useState(entry?.title || "");
  const [author, setAuthor] = useState(entry?.author || "");
  const [cover, setCover] = useState(entry?.cover || null);
  const [description, setDescription] = useState(entry?.description || "");
  const [courseId, setCourseId] = useState(entry?.course?.id || "");
  const [status, setStatus] = useState(entry ? (entry.want ? "want" : entry.finished ? "finished" : "active") : "active");
  const [unitLabel, setUnitLabel] = useState(entry?.unit || SHELF_KINDS[entry?.kind || "book"].unit);
  const [unitTouched, setUnitTouched] = useState(Boolean(entry));
  const [total, setTotal] = useState(item?.total || "");
  const [done, setDone] = useState(entry?.done ?? 0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  const course = state.courses.find(c => c.id === courseId) || null;
  // A course can be on the shelf once.
  const taken = new Set(state.shelf.filter(it => it.courseId && it.id !== item?.id).map(it => it.courseId));
  const options = state.courses.filter(c => c.kind !== "notes" && (!taken.has(c.id) || c.id === courseId));

  const pickKind = (k) => { setKind(k); if (!unitTouched) setUnitLabel(SHELF_KINDS[k].unit); };
  const pickCourse = (id) => {
    setCourseId(id);
    const c = state.courses.find(x => x.id === id);
    if (c && !title.trim()) setTitle(c.name);
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
    const fields = {
      kind, cover, description: description.trim(), author: kind === "book" ? author.trim() : "",
      title: course && t === course.name ? "" : t, // follows the course's name unless you changed it
      unitLabel: unitLabel.trim() || SHELF_KINDS[kind].unit,
      total: tot,
      done: Math.max(0, tot ? Math.min(tot, parseInt(done, 10) || 0) : parseInt(done, 10) || 0),
      courseId: course?.id ?? null,
      ...(course ? {} : { status }),
    };
    if (item) { act("shelf/update", { id: item.id, patch: fields }); onClose(); return; }
    const created = makeShelfItem(fields);
    act("shelf/add", { item: created });
    onCreated(created.id, !course);
  };

  return (
    <Modal title={entry ? "Edit" : "Add to your shelf"} onClose={onClose} width={580}
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{entry ? "Save changes" : "Add to shelf"}</button>
      </>}>
      <div className="shelf-form-top">
        <div className="field">
          <span className="label">Type</span>
          <div className="seg">
            {Object.entries(SHELF_KINDS).map(([k, v]) => (
              <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => pickKind(k)}>{v.label}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="shelf-title">Title</label>
          <input id="shelf-title" className="input" value={title} autoFocus={!entry} onChange={e => setTitle(e.target.value)}/>
        </div>
      </div>
      {kind === "book" && (
        <div className="field">
          <label htmlFor="shelf-author">Author</label>
          <input id="shelf-author" className="input" value={author} onChange={e => setAuthor(e.target.value)}/>
        </div>
      )}
      <div className="field">
        <span className="label">Cover</span>
        {cover ? (
          <div className="shelf-cover-edit">
            <Cover src={cover} title={title} className="edit-cover"/>
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
      <div className="field">
        <label htmlFor="shelf-desc">What it's about</label>
        <textarea id="shelf-desc" className="textarea" style={{ minHeight: 64 }} value={description} onChange={e => setDescription(e.target.value)}/>
      </div>
      <div className="field">
        <label htmlFor="shelf-course">Tenax course</label>
        <select id="shelf-course" className="select" value={courseId} onChange={e => pickCourse(e.target.value)}>
          <option value="">None: track progress here</option>
          {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {!course && (
        <div className="field">
          <span className="label">Status</span>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {Object.entries(SHELF_STATUS).map(([k, v]) => (
              <button key={k} type="button" className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{v.label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="shelf-form-row">
        <div className="field">
          <label htmlFor="shelf-unit">Counted in</label>
          <input id="shelf-unit" className="input" value={unitLabel} onChange={e => { setUnitLabel(e.target.value); setUnitTouched(true); }}/>
        </div>
        <div className="field">
          <label htmlFor="shelf-total">Total</label>
          <input id="shelf-total" className="input" type="number" min="0" value={total} onChange={e => setTotal(e.target.value)}/>
        </div>
        {status !== "want" && (
          <div className="field">
            <label htmlFor="shelf-done">Done so far</label>
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

function ImportAeroShelf({ onClose }) {
  const { state, act } = useStore();
  const [found, setFound] = useState(null); // { items, file } | { error }
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const miss = { error: "AeroShelf's data isn't on this computer." };
    Promise.resolve(legacyBridge()?.legacy())
      .then(r => { if (alive) setFound(r?.ok ? { items: r.items, file: r.file } : r?.error ? { error: r.error } : miss); })
      .catch(() => { if (alive) setFound(miss); });
    return () => { alive = false; };
  }, []);

  const readFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result));
        const items = Array.isArray(data) ? data : data?.as_items;
        if (!Array.isArray(items)) throw new Error();
        setFound({ items, file: file.name });
      } catch { setFound({ error: "That file isn't AeroShelf's data (its config.json)." }); }
    };
    r.readAsText(file);
  };

  const plan = found?.items ? fromAeroShelf(found.items, state) : null;

  const run = async () => {
    setBusy(true);
    const items = [];
    for (const it of plan.items) {
      let cover = it.cover;
      if (cover) { try { cover = await shrinkImage(cover); } catch { cover = null; } }
      items.push({ ...it, cover });
    }
    act("shelf/import", { items });
    act("settings", { patch: { aeroshelfImportedAt: Date.now() } });
    onClose();
  };

  return (
    <Modal title="Import from AeroShelf" onClose={onClose}
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>{plan && !plan.items.length ? "Close" : "Cancel"}</button>
        {plan?.items.length > 0 && (
          <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? <Spinner/> : <Icon name="download" size={15}/>}Import {plan.items.length}</button>
        )}
      </>}>
      {!found && <p className="muted"><Spinner/> Looking for AeroShelf's data…</p>}
      {found?.error && (
        <div className="stack" style={{ gap: 12 }}>
          <Notice icon="info">{found.error} On the computer you used it on, it's <code>%APPDATA%\aeroshelf\config.json</code>.</Notice>
          <div><button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={15}/>Choose the file…</button></div>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { readFile(e.target.files?.[0]); e.target.value = ""; }}/>
        </div>
      )}
      {plan && (
        <div className="stack" style={{ gap: 10 }}>
          <p>
            {plan.items.length
              ? <>Found <strong>{plan.items.length}</strong> {plan.items.length === 1 ? "book or course" : "books and courses"} to add, with their covers and progress.</>
              : "Everything in AeroShelf is already on your shelf."}
            {plan.skipped > 0 && plan.items.length > 0 && <span className="muted"> {plan.skipped} already on your shelf {plan.skipped === 1 ? "is" : "are"} skipped.</span>}
          </p>
          {plan.linked.length > 0 && (
            <p className="small">
              Linked to your Tenax courses, so their progress comes from Tenax:{" "}
              {plan.linked.map(l => l.course).join(", ")}.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

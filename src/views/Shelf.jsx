// The shelf: the books and courses you're working through, with covers and
// progress. Tenax courses are on it automatically (see lib/shelf.js).

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useNav, pct } from "../ui/nav.js";
import { Bar, Modal, Notice, Spinner } from "../ui/ui.jsx";
import Icon from "../ui/Icon.jsx";
import { shelfEntries, shelfStats, SHELF_FILTERS, SHELF_KINDS, makeShelfItem, courseChapters, fromAeroShelf } from "../lib/shelf.js";
import { shrinkImage } from "../lib/image.js";

const legacyBridge = () => (typeof window !== "undefined" ? window.tenax?.shelf : null);
const initials = (t) => String(t || "?").split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";

export default function Shelf() {
  const { state, act } = useStore();
  const nav = useNav();
  const [filter, setFilter] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState(null); // null | { entry } (entry null = new)
  const [importing, setImporting] = useState(false);

  const entries = useMemo(() => shelfEntries(state, nav.now), [state, nav.now]);
  const stats = shelfStats(entries);
  const test = SHELF_FILTERS.find(f => f.id === filter).test;
  const shown = entries.filter(e => !e.hidden && test(e));
  const hidden = entries.filter(e => e.hidden);
  const canImport = Boolean(legacyBridge()) && !state.settings.aeroshelfImportedAt;

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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Shelf</h1>
          <div className="page-sub">Everything you're reading or taking, and how far along you are.</div>
        </div>
        <div className="row">
          {canImport && <button className="btn" onClick={() => setImporting(true)}><Icon name="download" size={15}/>Import from AeroShelf</button>}
          <button className="btn btn-primary" onClick={() => setEditing({ entry: null })}><Icon name="plus" size={16}/>Add to shelf</button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="panel empty">
          <h3>Your shelf is empty</h3>
          <p>Add a book or course you're working through. Your Tenax courses show up here on their own.</p>
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
            <div className="stat"><div className="stat-value">{pct(stats.pct)}</div><div className="stat-label">Overall progress</div></div>
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
                onOpen={() => (e.course ? nav.go("course", { courseId: e.course.id }) : setEditing({ entry: e }))}
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

      {editing && <ShelfForm entry={editing.entry} onClose={() => setEditing(null)}/>}
      {importing && <ImportAeroShelf onClose={() => setImporting(false)}/>}
    </div>
  );
}

function ShelfCard({ entry: e, dim, onOpen, onEdit, onBump, onHide, onRemove, onSetTotal }) {
  const [confirming, setConfirming] = useState(false);
  const stop = (fn) => (ev) => { ev.stopPropagation(); fn(); };
  return (
    <article className={`shelf-card${dim ? " dim" : ""}`}>
      <div className="shelf-cover" onClick={onOpen} role="button" tabIndex={0}
        aria-label={e.course ? `Open ${e.title}` : `Edit ${e.title}`}
        onKeyDown={(ev) => { if (ev.key === "Enter") onOpen(); }}>
        {e.cover
          ? <img src={e.cover} alt="" draggable={false}/>
          : <div className="shelf-blank"><span>{initials(e.title)}</span></div>}
        {e.finished && <span className="shelf-done"><Icon name="check" size={13}/>Finished</span>}
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
        {e.description && <div className="shelf-desc">{e.description}</div>}
        <div className="shelf-foot">
          <div className="shelf-prog">
            <span>{e.total ? `${e.done} / ${e.total} ${e.unit}` : e.done ? `${e.done} ${e.unit} read` : `No ${e.unit} yet`}</span>
            {e.total > 0
              ? <span>{pct(e.pct)}</span>
              : !dim && onSetTotal && <button className="shelf-link" onClick={onSetTotal}>Set total</button>}
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

function ShelfForm({ entry, onClose }) {
  const { state, act } = useStore();
  const item = entry?.item || null;
  const [kind, setKind] = useState(entry?.kind || "book");
  const [title, setTitle] = useState(entry?.title || "");
  const [cover, setCover] = useState(entry?.cover || null);
  const [description, setDescription] = useState(entry?.description || "");
  const [courseId, setCourseId] = useState(entry?.course?.id || "");
  const [unitLabel, setUnitLabel] = useState(entry?.unit || SHELF_KINDS[entry?.kind || "book"].unit);
  const [unitTouched, setUnitTouched] = useState(Boolean(entry));
  const [total, setTotal] = useState(item?.total || "");
  const [done, setDone] = useState(entry?.done ?? 0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  const course = state.courses.find(c => c.id === courseId) || null;
  const chapters = course ? courseChapters(state, course.id) : null;
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
    const tot = parseInt(total, 10);
    if (!t) return setError("Give it a title.");
    if (!course && !(tot >= 1)) return setError(`How many ${unitLabel.trim() || "chapters"} does it have?`);
    const fields = {
      kind, cover, description: description.trim(),
      title: course && t === course.name ? "" : t, // follows the course's name unless you changed it
      unitLabel: unitLabel.trim() || SHELF_KINDS[kind].unit,
      total: tot >= 1 ? tot : 0,
      done: Math.max(0, tot >= 1 ? Math.min(tot, parseInt(done, 10) || 0) : parseInt(done, 10) || 0),
      courseId: course?.id ?? null,
    };
    if (item) act("shelf/update", { id: item.id, patch: fields });
    else act("shelf/add", { item: makeShelfItem(fields) });
    onClose();
  };

  return (
    <Modal title={entry ? "Edit" : "Add to your shelf"} onClose={onClose} width={560}
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
      <div className="field">
        <span className="label">Cover</span>
        {cover ? (
          <div className="shelf-cover-edit">
            <img src={cover} alt="Cover"/>
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
        <label htmlFor="shelf-desc">Description</label>
        <textarea id="shelf-desc" className="textarea" style={{ minHeight: 64 }} value={description} onChange={e => setDescription(e.target.value)}/>
      </div>
      <div className="field">
        <label htmlFor="shelf-course">Tenax course</label>
        <select id="shelf-course" className="select" value={courseId} onChange={e => pickCourse(e.target.value)}>
          <option value="">None: track progress here</option>
          {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {course && (
          <span className="help">
            {chapters.read} {chapters.read === 1 ? "chapter" : "chapters"} read in Tenax. Progress is that or what you log here, whichever is more,
            so chapters you read before Tenax count too.
          </span>
        )}
      </div>
      <div className="shelf-form-row">
        <div className="field">
          <label htmlFor="shelf-unit">Counted in</label>
          <input id="shelf-unit" className="input" value={unitLabel} onChange={e => { setUnitLabel(e.target.value); setUnitTouched(true); }}/>
        </div>
        <div className="field">
          <label htmlFor="shelf-total">Total</label>
          <input id="shelf-total" className="input" type="number" min="1" value={total} onChange={e => setTotal(e.target.value)}/>
        </div>
        <div className="field">
          <label htmlFor="shelf-done">Done so far</label>
          <input id="shelf-done" className="input" type="number" min="0" value={done} onChange={e => setDone(e.target.value)}/>
        </div>
      </div>
      {error && <p className="small" style={{ color: "var(--bad)" }}>{error}</p>}
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
          {plan.items.length > 0 && <p className="muted small">Import once on this computer; sync takes it to the others.</p>}
        </div>
      )}
    </Modal>
  );
}

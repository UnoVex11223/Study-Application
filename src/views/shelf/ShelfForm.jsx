// Add something to the shelf, or edit it: what kind it is, its title, author
// and cover (chosen, dropped, or found on Open Library), its status and how
// far along you are.
//
// The form is two columns that start and end together: the cover with its two
// actions at the left, and the fields at the right, every row as wide as the
// column (see .shelf-form in styles/shelf.css).

import { useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import Icon from "../../ui/Icon.jsx";
import { Modal } from "../../ui/overlays.jsx";
import { Field, Segmented } from "../../ui/controls.jsx";
import { Spinner } from "../../ui/display.jsx";
import { CoverArt, useCoverInfo } from "../../ui/Cover.jsx";
import { cx } from "../../ui/cx.js";
import { SHELF_KINDS, SHELF_STATUS, categoryOf, makeShelfItem } from "../../lib/shelf.js";
import { shrinkImage, cutToBook } from "../../lib/image.js";
import { bookShaped } from "../../lib/cover.js";

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const coverApi = () => (typeof window !== "undefined" ? window.tenax?.covers : null);

/**
 * Choosing a cover: a picture you pick or drop, or one found on Open Library.
 * A picture that isn't a book's shape is cut to fit, and can be dragged to
 * choose what shows (`pos`). Returns what the two parts below need.
 */
function useCoverPicker({ cover, setCover, pos, setPos, title, author, setError, setBusy }) {
  const [found, setFound] = useState(null); // null | { query, covers, error }
  const [finding, setFinding] = useState(false);
  const [picking, setPicking] = useState(null);
  const info = useCoverInfo(cover);
  const movable = Boolean(info && !bookShaped(info.aspect));

  const choose = (src) => { setCover(src); setPos(null); setError(""); };
  const takeFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try { choose(await shrinkImage(file)); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  // Covers from Open Library: searched by the title (or an ISBN typed as the title) and author.
  const find = async () => {
    const q = { title: title.trim(), author: author.trim() };
    if (!q.title) return setError("Give it a title first.");
    setFinding(true); setError("");
    const res = await coverApi().search(q).catch(() => ({ ok: false, error: "Couldn't reach Open Library" }));
    setFinding(false);
    setFound({ query: q.title, covers: res.ok ? res.covers : [], error: res.ok ? "" : res.error });
  };
  const pick = async (c) => {
    setPicking(c.id);
    const res = await coverApi().fetch(c.id).catch(() => ({ ok: false, error: "Couldn't download the cover" }));
    if (res.ok) {
      try { choose(await shrinkImage(res.dataUrl)); setFound(null); } catch (err) { setError(err.message); }
    } else setError(res.error);
    setPicking(null);
  };
  return { cover, pos, setPos, title, author, info, movable, found, finding, picking, choose, takeFile, find, pick };
}

/** The left column: the cover as it will stand on the shelf (or an empty place for one), and the two ways to get one. */
function CoverSide({ picker: p, busy }) {
  const [over, setOver] = useState(false);
  const drag = useRef(null);
  const fileRef = useRef(null);
  const browse = () => fileRef.current?.click();
  const wide = p.info?.aspect > 2 / 3;
  const at = p.pos ?? p.info?.pos ?? 0.5;

  // Dragging moves the picture under the cover: the part that shows follows the pointer.
  const startDrag = (e) => {
    if (!p.movable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const room = wide ? r.height * p.info.aspect - r.width : r.width / p.info.aspect - r.height;
    drag.current = { from: wide ? e.clientX : e.clientY, at, room };
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    p.setPos(Math.min(1, Math.max(0, d.at - ((wide ? e.clientX : e.clientY) - d.from) / d.room)));
  };
  const nudge = (e) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!p.movable || !step) return;
    e.preventDefault();
    p.setPos(v => Math.min(1, Math.max(0, (v ?? p.info.pos) + step * 0.05)));
  };

  return (
    <div className={cx("shelf-form-cover", over && "over")}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); p.takeFile(e.dataTransfer.files?.[0]); }}>
      <div className="cover-slot">
        {p.cover || p.title ? (
          <div className={cx("cover-adjust", p.movable && "movable")} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }}
            {...(p.movable && { tabIndex: 0, role: "slider", "aria-label": "What part of the picture shows", "aria-orientation": wide ? "horizontal" : "vertical",
              "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(at * 100), onKeyDown: nudge })}>
            <CoverArt src={p.cover} title={p.title} author={p.author} className="edit-cover" pos={p.pos}/>
          </div>
        ) : (
          <button type="button" className="cover-empty" onClick={browse}>
            <Icon name="plus" size={18}/>
            <span>Drop a cover here</span>
          </button>
        )}
        {p.cover && (
          <button type="button" className="cover-remove" title="Remove the cover" aria-label="Remove the cover" onClick={() => p.choose(null)}><Icon name="x"/></button>
        )}
      </div>
      <div className="cover-actions">
        {coverApi() && <button type="button" className="btn btn-sm" onClick={p.find} disabled={p.finding}>{p.finding ? <Spinner/> : <Icon name="search"/>}Find a cover</button>}
        <button type="button" className="btn btn-sm" onClick={browse} disabled={busy}>{busy ? <Spinner/> : <Icon name="upload"/>}Choose an image</button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { p.takeFile(e.target.files?.[0]); e.target.value = ""; }}/>
    </div>
  );
}

/** Under both columns: the covers Open Library found, to pick one from. */
function CoverPicks({ picker: p }) {
  if (!p.found) return null;
  if (!p.found.covers.length) return <p className="small muted">{p.found.error || `No covers found for “${p.found.query}”.`}</p>;
  return (
    <div className="cover-picks" role="listbox" aria-label="Covers from Open Library">
      {p.found.covers.map((c, i) => (
        <button key={c.id} type="button" role="option" aria-selected={p.picking === c.id} className="cover-pick"
          style={{ "--i": i }} onClick={() => p.pick(c)} disabled={Boolean(p.picking)} title={[c.title, c.author, c.year].filter(Boolean).join(", ")}>
          <img src={c.thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.closest(".cover-pick").hidden = true; }}/>
          {p.picking === c.id && <span className="cover-pick-busy"><Spinner/></span>}
          {c.year && <span className="cover-pick-year">{c.year}</span>}
        </button>
      ))}
    </div>
  );
}

export default function ShelfForm({ entry, startKind, onClose, onSaved }) {
  const { act } = useStore();
  const item = entry?.item || null;
  // Tenax courses are on the shelf by themselves; editing one keeps it linked.
  const course = entry?.course || null;
  const [kind, setKind] = useState(entry?.kind || startKind);
  const [title, setTitle] = useState(entry?.title || "");
  const [author, setAuthor] = useState(entry?.author || "");
  const [cover, setCover] = useState(entry?.cover || null);
  const [coverPos, setCoverPos] = useState(null); // where you dragged the picture to, or null: where it has the most detail
  const [status, setStatus] = useState(entry ? (entry.want ? "want" : entry.finished ? "finished" : "active") : "active");
  const [unitLabel, setUnitLabel] = useState(capitalize(entry && entry.category === "study" ? entry.unit : SHELF_KINDS[kind].unit));
  const [unitTouched, setUnitTouched] = useState(Boolean(entry && entry.category === "study"));
  const [total, setTotal] = useState(item?.total || "");
  const [done, setDone] = useState(entry?.done ?? 0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reading = kind === "reading";
  // Books are counted in pages, unless one of yours was already counted another way.
  const readingUnit = entry?.category === "reading" && entry.unit ? entry.unit : "pages";
  const statuses = SHELF_STATUS[categoryOf(kind)];
  const shownStatus = statuses[status] ? status : "active";
  // A Tenax course is a textbook or a course; anything else can be any kind.
  const kinds = Object.keys(SHELF_KINDS).filter(k => !course || categoryOf(k) === "study");
  const picker = useCoverPicker({
    cover, setCover, pos: coverPos, setPos: setCoverPos, title: title.trim() || course?.name || "", author: reading ? author.trim() : "", setError, setBusy,
  });

  const pickKind = (k) => {
    setKind(k);
    if (k !== "reading" && !unitTouched) setUnitLabel(capitalize(SHELF_KINDS[k].unit));
  };

  const save = async () => {
    const t = title.trim() || course?.name || "";
    if (!t) return setError("Give it a title.");
    const tot = Math.max(0, parseInt(total, 10) || 0);
    const doneCount = parseInt(done, 10) || 0;
    const unit = unitLabel.trim();
    // Saved as it looks here: cut to a book's shape.
    setBusy(true);
    const fitted = cover ? await cutToBook(cover, coverPos).catch(() => cover) : null;
    setBusy(false);
    const fields = {
      kind, cover: fitted, author: reading ? author.trim() : "",
      title: course && t === course.name ? "" : t, // follows the course's name unless you changed it
      // Shown capitalized here; cards read "4 / 12 chapters".
      unitLabel: reading ? readingUnit : /^(chapters|modules)$/i.test(unit) ? unit.toLowerCase() : unit || SHELF_KINDS[kind].unit,
      total: tot,
      done: shownStatus === "want" ? 0 : Math.max(0, tot ? Math.min(tot, doneCount) : doneCount),
      courseId: course?.id ?? null,
      ...(course ? {} : { status: shownStatus }),
    };
    if (item) { act("shelf/update", { id: item.id, patch: fields }); onSaved({ ...item, ...fields }, false); return; }
    const created = makeShelfItem(fields);
    act("shelf/add", { item: created });
    onSaved(created, true);
  };

  return (
    <Modal title={entry ? `Edit ${SHELF_KINDS[kind].label.toLowerCase()}` : "Add to your shelf"} size="xl" onClose={onClose}
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{entry ? "Save changes" : "Add to shelf"}</button>
      </>}>
      <div className="shelf-form">
        <CoverSide picker={picker} busy={busy}/>
        <div className="form">
          {kinds.length > 1 && (
            <Field label="Type">
              <Segmented fill label="Type" options={kinds.map(k => [k, SHELF_KINDS[k].label])} value={kind} onChange={pickKind}/>
            </Field>
          )}
          <div className="form-row">
            <Field label="Title" htmlFor="shelf-title">
              <input id="shelf-title" className="input" value={title} autoFocus={!entry} onChange={e => setTitle(e.target.value)}/>
            </Field>
            {reading && (
              <Field label="Author" htmlFor="shelf-author">
                <input id="shelf-author" className="input" value={author} onChange={e => setAuthor(e.target.value)}/>
              </Field>
            )}
          </div>
          {!course && (
            <Field label="Status">
              <Segmented fill label="Status" options={Object.entries(statuses)} value={shownStatus} onChange={setStatus}/>
            </Field>
          )}
          <div className="form-row">
            {!reading && (
              <Field label="Counted in" htmlFor="shelf-unit">
                <input id="shelf-unit" className="input" value={unitLabel} onChange={e => { setUnitLabel(e.target.value); setUnitTouched(true); }}/>
              </Field>
            )}
            <Field label={reading ? capitalize(readingUnit) : "Total"} htmlFor="shelf-total">
              <input id="shelf-total" className="input" type="number" min="0" value={total} onChange={e => setTotal(e.target.value)}/>
            </Field>
            {shownStatus !== "want" && (
              <Field label={reading ? "Read so far" : "Done so far"} htmlFor="shelf-done">
                <input id="shelf-done" className="input" type="number" min="0" value={done} onChange={e => setDone(e.target.value)}/>
              </Field>
            )}
          </div>
        </div>
      </div>
      {picker.movable && <p className="help">The picture is cut to fit the cover. Drag it to choose what shows.</p>}
      <CoverPicks picker={picker}/>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}

// Add something to the shelf, or edit it: what kind it is, its title, author
// and cover (chosen, dropped, or found on Open Library), its status and how
// far along you are.

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
 * The cover: a preview you can drop a picture on, with ways to choose one. A
 * picture that isn't a book's shape is cut to fit, and can be dragged to
 * choose what shows (`pos`). `busy` is true while a picture is being shrunk.
 */
function CoverField({ cover, setCover, pos, setPos, title, author, setError, busy, setBusy }) {
  const [over, setOver] = useState(false);
  const [found, setFound] = useState(null); // null | { query, covers, error }
  const [finding, setFinding] = useState(false);
  const [picking, setPicking] = useState(null);
  const fileRef = useRef(null);
  const drag = useRef(null);
  const info = useCoverInfo(cover);
  const movable = Boolean(info && !bookShaped(info.aspect));
  const wide = info?.aspect > 2 / 3;
  const at = pos ?? info?.pos ?? 0.5;

  const choose = (src) => { setCover(src); setPos(null); setError(""); };
  const takeFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try { choose(await shrinkImage(file)); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  // Dragging moves the picture under the cover: the part that shows follows the pointer.
  const startDrag = (e) => {
    if (!movable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const room = wide ? r.height * info.aspect - r.width : r.width / info.aspect - r.height;
    drag.current = { from: wide ? e.clientX : e.clientY, at, room };
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    setPos(Math.min(1, Math.max(0, d.at - ((wide ? e.clientX : e.clientY) - d.from) / d.room)));
  };
  const nudge = (e) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!movable || !step) return;
    e.preventDefault();
    setPos(p => Math.min(1, Math.max(0, (p ?? info.pos) + step * 0.05)));
  };
  // Covers from Open Library: searched by the title (or an ISBN typed as the title) and author.
  const findCovers = async () => {
    const q = { title: title.trim(), author: author.trim() };
    if (!q.title) return setError("Give it a title first.");
    setFinding(true); setError("");
    const res = await coverApi().search(q).catch(() => ({ ok: false, error: "Couldn't reach Open Library" }));
    setFinding(false);
    setFound({ query: q.title, covers: res.ok ? res.covers : [], error: res.ok ? "" : res.error });
  };
  const pickCover = async (c) => {
    setPicking(c.id);
    const res = await coverApi().fetch(c.id).catch(() => ({ ok: false, error: "Couldn't download the cover" }));
    if (res.ok) {
      try { choose(await shrinkImage(res.dataUrl)); setFound(null); } catch (err) { setError(err.message); }
    } else setError(res.error);
    setPicking(null);
  };

  return (
    <Field label="Cover">
      <div className={cx("cover-field", over && "over")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); takeFile(e.dataTransfer.files?.[0]); }}>
        <div className={cx("cover-adjust", movable && "movable")} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }}
          {...(movable && { tabIndex: 0, role: "slider", "aria-label": "What part of the picture shows", "aria-orientation": wide ? "horizontal" : "vertical",
            "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(at * 100), onKeyDown: nudge })}>
          <CoverArt src={cover} title={title} author={author} className="edit-cover" pos={pos}/>
        </div>
        <div className="stack gap-3">
          <div className="row wrap">
            {coverApi() && <button type="button" className="btn btn-sm" onClick={findCovers} disabled={finding}>{finding ? <Spinner/> : <Icon name="search"/>}Find a cover</button>}
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <Spinner/> : <Icon name="upload"/>}Choose an image</button>
            {cover && <button type="button" className="btn btn-sm btn-quiet" onClick={() => choose(null)}><Icon name="x"/>Remove</button>}
          </div>
          {movable && <p className="small muted">Cut to fit the cover. Drag the picture to choose what shows.</p>}
        </div>
      </div>
      {found && (found.covers.length > 0 ? (
        <div className="cover-picks" role="listbox" aria-label="Covers from Open Library">
          {found.covers.map((c, i) => (
            <button key={c.id} type="button" role="option" aria-selected={picking === c.id} className="cover-pick"
              style={{ "--i": i }} onClick={() => pickCover(c)} disabled={Boolean(picking)} title={[c.title, c.author, c.year].filter(Boolean).join(", ")}>
              <img src={c.thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.closest(".cover-pick").hidden = true; }}/>
              {picking === c.id && <span className="cover-pick-busy"><Spinner/></span>}
              {c.year && <span className="cover-pick-year">{c.year}</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="small muted">{found.error || `No covers found for “${found.query}”.`}</p>
      ))}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { takeFile(e.target.files?.[0]); e.target.value = ""; }}/>
    </Field>
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
    <Modal title={entry ? "Edit" : "Add to your shelf"} size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{entry ? "Save changes" : "Add to shelf"}</button>
      </>}>
      {kinds.length > 1 && (
        <Field label="Type">
          <Segmented label="Type" options={kinds.map(k => [k, SHELF_KINDS[k].label])} value={kind} onChange={pickKind}/>
        </Field>
      )}
      <div className={reading ? "form-row" : undefined}>
        <Field label="Title" htmlFor="shelf-title">
          <input id="shelf-title" className="input" value={title} autoFocus={!entry} onChange={e => setTitle(e.target.value)}/>
        </Field>
        {reading && (
          <Field label="Author" htmlFor="shelf-author">
            <input id="shelf-author" className="input" value={author} onChange={e => setAuthor(e.target.value)}/>
          </Field>
        )}
      </div>
      <CoverField cover={cover} setCover={setCover} pos={coverPos} setPos={setCoverPos} title={title.trim() || course?.name || ""} author={reading ? author.trim() : ""}
        setError={setError} busy={busy} setBusy={setBusy}/>
      {!course && (
        <Field label="Status">
          <Segmented label="Status" options={Object.entries(statuses)} value={shownStatus} onChange={setStatus}/>
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
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}

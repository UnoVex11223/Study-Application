// The shelf: books you read for their own sake, textbooks and courses, each
// with its own tab (Tenax courses are on it automatically, see lib/shelf.js).
// Reading books also keep notes in your own words, a rating, and a recall now
// and then: say what you remember, then compare with your notes (see
// lib/recall.js).
//
// Everything stands on shelves as a book: a cover with real thickness (from
// its length), page edges and a spine, drawn in CSS 3D. Books are set down on
// the shelf when the page opens, turn toward you and follow the pointer when
// you point at one, open their cover when you log a chapter, and a book due
// for a recall has a bookmark sticking out of the top. The shelf's edge
// catches the light under the pointer. With reduced motion, all of it stands
// still. Covers are shaped by lib/cover.js.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "../state/store.jsx";
import { useNav, pct } from "../ui/nav.js";
import { Drawer, Modal, Spinner } from "../ui/ui.jsx";
import Icon from "../ui/Icon.jsx";
import { shelfEntries, SHELF_FILTERS, SHELF_KINDS, categoryOf, makeShelfItem, itemFinished } from "../lib/shelf.js";
import { dueForRecall, recallWhen, hasNotes, RECALL_RATINGS } from "../lib/recall.js";
import { shrinkImage } from "../lib/image.js";
import { analyzeCover, peekCover, subscribeCovers, clothFor, bookThickness } from "../lib/cover.js";

const longDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const monthYear = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", year: "numeric" });

// "Want to read" is for books only.
const STATUS = {
  reading: { active: "Reading", finished: "Finished", want: "Want to read" },
  study: { active: "In progress", finished: "Finished" },
};
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Shelf geometry: the narrowest a book column gets, and the space between books.
const BOOK_MIN = 150;
const BOOK_GAP = 40;

const stillMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

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

/** What lib/cover.js has worked out about a picture (null until it's looked at it). */
function useCoverInfo(src) {
  const info = useSyncExternalStore(subscribeCovers, () => (src ? peekCover(src) : null));
  useEffect(() => { if (src) analyzeCover(src); }, [src]);
  return info;
}

/** A book cover, 2:3: the picture (margins cropped, odd shapes set on a plate), or plain cloth with the title. */
function CoverArt({ src, title, author, className = "" }) {
  const info = useCoverInfo(src);
  if (!src) {
    const cloth = clothFor(title);
    return (
      <div className={`cover-art cloth ${className}`} style={{ "--cloth": cloth.bg, "--cloth-ink": cloth.ink }}>
        <div className="cloth-title">{title || "Untitled"}</div>
        {author && <div className="cloth-author">{author}</div>}
      </div>
    );
  }
  if (!info) return <div className={`cover-art loading ${className}`}/>;
  if (info.fit === "fill") return <div className={`cover-art ${className}`}><img className="cover-fill" src={info.src} alt="" draggable={false}/></div>;
  return (
    <div className={`cover-art framed ${className}`}>
      <img className="cover-haze" src={info.src} alt="" draggable={false}/>
      <img className="cover-plate" src={info.src} alt="" draggable={false}/>
    </div>
  );
}

/** The browser's pointer, smoothed to one update a frame, as CSS variables on an element. */
function usePointerVars(onMove, onLeave) {
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return {
    onPointerMove: (ev) => {
      const { currentTarget: el, clientX, clientY } = ev;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => onMove(el, clientX, clientY));
    },
    onPointerLeave: (ev) => {
      const el = ev.currentTarget;
      cancelAnimationFrame(frame.current);
      onLeave(el);
    },
  };
}

const TILT_VARS = ["--ry", "--rx", "--gx", "--gy"];

/** One book standing on the shelf, in 3D. */
function Book({ entry: e, opening, onOpen, actions }) {
  const info = useCoverInfo(e.cover);
  const cloth = e.cover ? null : clothFor(e.title);
  const spine = cloth ? cloth.bg : info?.spine || "#24262B";
  const tilt = usePointerVars(
    (el, x, y) => {
      el.classList.add("lifted");
      if (stillMotion()) return;
      const r = el.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (x - r.left) / r.width)), fy = Math.min(1, Math.max(0, (y - r.top) / r.height));
      el.style.setProperty("--ry", `${((fx - 0.5) * 24).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${((0.5 - fy) * 14).toFixed(2)}deg`);
      el.style.setProperty("--gx", `${(fx * 100).toFixed(1)}%`);
      el.style.setProperty("--gy", `${(fy * 100).toFixed(1)}%`);
    },
    (el) => { el.classList.remove("lifted"); for (const v of TILT_VARS) el.style.removeProperty(v); },
  );
  return (
    <div className={`book-hold${e.category === "reading" ? " slim" : ""}${e.want ? " want" : ""}${opening ? ` open-${opening % 2}` : ""}`}
      style={{ "--t": `${bookThickness(e)}px`, "--spine": spine }} {...tilt}>
      <div className="book" role="button" tabIndex={0} aria-label={`Open ${e.title}`} onClick={onOpen}
        onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen(); } }}>
        <div className="book-face book-back"/>
        <div className="book-face book-pages"/>
        <div className="book-face book-top"/>
        <div className="book-face book-spine"/>
        <div className="book-face book-leaf"/>
        {e.recallDue && <span className="book-mark" title="Due for a recall"/>}
        <div className="book-face book-front">
          <CoverArt src={e.cover} title={e.title} author={e.category === "reading" ? e.author : ""}/>
          <span className="book-hinge"/>
          <span className="book-glare"/>
        </div>
      </div>
      {actions}
    </div>
  );
}

/** The plank a row of books stands on; each card brings its own length of it. */
const Ledge = () => <div className="ledge" aria-hidden="true"/>;

export default function Shelf({ recall: startRecall = false }) {
  const { state, act } = useStore();
  const nav = useNav();
  const [filter, setFilter] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState(null); // null | { entry } (entry null = new)
  const [openId, setOpenId] = useState(null);
  const [recallQueue, setRecallQueue] = useState(() => (startRecall ? dueForRecall(state.shelf, Date.now()).map(it => it.id) : null));
  const [cols, setCols] = useState(5);
  const shelfRef = useRef(null);
  const tabsRef = useRef(null);
  const inkRef = useRef(null);

  const entries = useMemo(() => shelfEntries(state, nav.now), [state, nav.now]);
  const due = dueForRecall(state.shelf, nav.now);
  const tab = SHELF_FILTERS.find(f => f.id === filter);
  const visible = entries.filter(e => !e.hidden);
  const shown = visible.filter(tab.test);
  const hidden = entries.filter(e => e.hidden);
  const counts = Object.fromEntries(SHELF_FILTERS.map(f => [f.id, visible.filter(f.test).length]));
  const open = state.shelf.find(it => it.id === openId && it.kind === "reading" && !it.courseId) || null;
  const add = () => setEditing({ entry: null });
  const addLabel = tab.kind ? `Add a ${SHELF_KINDS[tab.kind].label.toLowerCase()}` : "Add to shelf";
  const countKey = SHELF_FILTERS.map(f => counts[f.id]).join(",");

  // How many books fit across, so the last row's shelf can run the full width.
  useEffect(() => {
    const el = shelfRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => {
      setCols(Math.max(1, Math.floor((entry.contentRect.width + BOOK_GAP) / (BOOK_MIN + BOOK_GAP))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The line under the tabs slides to the one that's picked.
  const placeInk = useCallback(() => {
    const on = tabsRef.current?.querySelector('[aria-selected="true"]');
    const ink = inkRef.current;
    if (!on || !ink) return;
    ink.style.width = `${on.offsetWidth}px`;
    ink.style.transform = `translateX(${on.offsetLeft}px)`;
  }, []);
  useLayoutEffect(() => { placeInk(); }, [placeInk, filter, countKey]);
  useEffect(() => {
    const ink = inkRef.current;
    const ready = requestAnimationFrame(() => ink?.classList.add("ready"));
    window.addEventListener("resize", placeInk);
    document.fonts?.ready.then(placeInk);
    return () => { cancelAnimationFrame(ready); window.removeEventListener("resize", placeInk); };
  }, [placeInk]);

  // The shelf edge catches the light under the pointer.
  const lamp = usePointerVars(
    (el, x, y) => { el.style.setProperty("--lamp-x", `${x}px`); el.style.setProperty("--lamp-y", `${y}px`); },
    (el) => { el.style.removeProperty("--lamp-x"); el.style.removeProperty("--lamp-y"); },
  );

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

  const withAdd = filter === "all" || Boolean(tab.kind);
  const filler = (n, at) => Array.from({ length: n }, (_, i) => (
    <div key={`gap${i}`} className="book-card filler" aria-hidden="true" style={{ "--i": at + i }}>
      <div className="book-slot"/><Ledge/>
    </div>
  ));
  const fill = (cells) => (cells === 0 ? cols : (cols - (cells % cols)) % cols);
  const geometry = { "--book-min": `${BOOK_MIN}px`, "--gap": `${BOOK_GAP}px` };

  return (
    <div className="page shelf-page">
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

      <div className="shelf-tabs" role="tablist" aria-label="Show" ref={tabsRef}>
        {SHELF_FILTERS.map(f => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
            {f.label}<span className="tab-count">{counts[f.id]}</span>
          </button>
        ))}
        <span className="tab-ink" ref={inkRef} aria-hidden="true"/>
      </div>

      <div className="shelf" ref={shelfRef} style={geometry} {...lamp}>
        <div className="shelf-grid" key={filter}>
          {shown.map((e, i) => (
            <BookCard key={e.key} entry={e} index={i}
              onOpen={() => openEntry(e)}
              onEdit={() => setEditing({ entry: e })}
              onBump={(d) => bump(e, d)}
              onHide={() => setHidden(e, true)}
              onRemove={() => act("shelf/remove", { id: e.item.id })}/>
          ))}
          {withAdd && (
            <button className="book-card add" onClick={add} style={{ "--i": shown.length }}>
              <div className="book-slot">
                <div className="book-hold">
                  <div className="book-ghost"><Icon name="plus" size={20}/></div>
                </div>
              </div>
              <Ledge/>
              <div className="book-info"><span className="book-add-label">{addLabel}</span></div>
            </button>
          )}
          {filler(fill(shown.length + (withAdd ? 1 : 0)), shown.length + 1)}
        </div>
        {shown.length === 0 && !withAdd && <p className="shelf-none">Nothing here yet.</p>}
      </div>

      {hidden.length > 0 && (
        <div className="shelf-hidden">
          <button className="btn btn-quiet btn-sm" onClick={() => setShowHidden(v => !v)}>
            {showHidden ? "Done" : `Hidden from the shelf (${hidden.length})`}
          </button>
          {showHidden && (
            <div className="shelf" style={geometry} {...lamp}>
              <div className="shelf-grid">
                {hidden.map((e, i) => (
                  <BookCard key={e.key} entry={e} index={i} dim
                    onOpen={() => setHidden(e, false)} onEdit={() => setEditing({ entry: e })}
                    onBump={() => {}} onHide={() => setHidden(e, false)}/>
                ))}
                {filler(fill(hidden.length), hidden.length)}
              </div>
            </div>
          )}
        </div>
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

/** The ⋯ on a book: edit, and hide or remove. Closes on a click elsewhere or Escape. */
function BookMenu({ open, onToggle, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (ev) => { if (!ref.current?.contains(ev.target)) onClose(); };
    const esc = (ev) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open, onClose]);
  return (
    <div className={`book-menu${open ? " open" : ""}`} ref={ref}>
      <button className="book-more" aria-label={`More for ${title}`} aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>
      </button>
      {open && <div className="book-menu-list" role="menu">{children}</div>}
    </div>
  );
}

function BookCard({ entry: e, index, dim, onOpen, onEdit, onBump, onHide, onRemove }) {
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState(0); // bumped to swing the cover open once
  const [menu, setMenu] = useState(false);
  const reading = e.category === "reading";
  const status = STATUS[e.category];
  const progress = e.total
    ? `${e.done} / ${e.total} ${e.unit}`
    : e.finished ? (e.finishedAt ? monthYear(e.finishedAt) : "Done")
    : e.want ? status.want
    : e.done ? `${e.done} ${e.unit} ${reading ? "read" : "done"}` : "Not started";
  const one = e.unit.replace(/s$/, "");
  const more = () => { onBump(1); setOpening(n => n + 1); };

  const close = useCallback(() => setMenu(false), []);
  const actions = (
    <BookMenu open={menu} onToggle={() => setMenu(v => !v)} onClose={close} title={e.title}>
      <button role="menuitem" onClick={() => { close(); onEdit(); }}><Icon name="edit" size={14}/>Edit</button>
      {dim ? (
        <button role="menuitem" onClick={() => { close(); onHide(); }}><Icon name="undo" size={14}/>Put back on the shelf</button>
      ) : e.linked ? (
        <button role="menuitem" onClick={() => { close(); onHide(); }}><Icon name="x" size={14}/>Hide from the shelf</button>
      ) : (
        <button role="menuitem" className="danger" onClick={() => { close(); setConfirming(true); }}><Icon name="trash" size={14}/>Remove</button>
      )}
    </BookMenu>
  );

  return (
    <article className={`book-card${dim ? " dim" : ""}${menu ? " menu-open" : ""}`} style={{ "--i": index }}>
      <div className="book-slot">
        <Book entry={e} opening={opening} onOpen={onOpen} actions={actions}/>
      </div>
      <Ledge/>
      <div className="book-info">
        <button className="book-title" onClick={onOpen} tabIndex={-1}>{e.title}</button>
        <div className="book-sub">
          {reading ? (
            <>
              {e.author && <span className="ell">{e.author}</span>}
              {e.rating > 0 && <Stars value={e.rating} size={10}/>}
            </>
          ) : e.linked ? (
            <span className="book-linked" title="Chapters read and mastery in Tenax">
              <Icon name="link" size={11}/>{e.read > 0 && e.mastery != null ? `${pct(e.mastery)} mastered` : "In Tenax"}
            </span>
          ) : (
            <span>{SHELF_KINDS[e.kind]?.label}</span>
          )}
          {e.recallDue && !dim && <span className="book-due">Recall</span>}
        </div>
        <div className="book-prog">
          <span className="ell">{progress}</span>
          <span className="book-end">
            <span className="book-pct">
              {e.finished ? <Icon name="check" size={13}/>
                : e.total > 0 ? pct(e.pct)
                : !dim && !e.want && <button className="shelf-link" onClick={onEdit}>Set total</button>}
            </span>
            {!reading && !dim && (
              <span className="book-step">
                <button disabled={e.done <= e.read} onClick={() => onBump(-1)} aria-label={`One ${one} less`}>−</button>
                <button disabled={e.total > 0 && e.done >= e.total} onClick={more} aria-label={`One more ${one}`}>+</button>
              </span>
            )}
          </span>
        </div>
        <div className={`book-bar${e.finished ? " good" : ""}`}><span style={{ "--p": Math.max(0, Math.min(1, e.pct || 0)) }}/></div>
      </div>
      {confirming && (
        <div className="book-confirm">
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
        <CoverArt src={item.cover} title={item.title} author={item.author} className="panel-cover"/>
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
            <CoverArt src={cover} title={title} author={reading ? author : ""} className="edit-cover"/>
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
        <CoverArt src={item.cover} title={item.title} className="recall-cover"/>
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

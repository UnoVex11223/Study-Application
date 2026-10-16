// Two other ways to look at the shelf:
//   SpineShelf  the books standing spine-out in a bookcase, packed close, each
//               spine coloured from its cover (or its cloth), as thick as the
//               book is long, with the whole title running down it (on more
//               lines or in smaller type when it's long, never cut short)
//   YearView    a year on the shelf: what you finished, as a pile of books
//               that grows as they land, with the months they fall in

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Icon from "../ui/Icon.jsx";
import { Figures, Figure } from "../ui/ui.jsx";
import { useCoverInfo } from "../ui/Cover.jsx";
import { clothFor, bookThickness, inkFor, spineHeight, fitTitle } from "../lib/cover.js";
import { yearOnShelf } from "../lib/shelf.js";
import { seeded } from "../lib/orbits.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const lastName = (author) => String(author || "").split(/,|&| and /)[0].trim().split(/\s+/).pop() || "";

// Titles are measured in the fonts they're set in, so the layouts are redone once the fonts have loaded.
let fontsLoaded = 0;
const fontListeners = new Set();
if (typeof document !== "undefined" && document.fonts) {
  const bump = () => { fontsLoaded += 1; for (const fn of fontListeners) fn(); };
  document.fonts.ready.then(bump);
  document.fonts.addEventListener?.("loadingdone", bump);
}
const useFonts = () => useSyncExternalStore((fn) => { fontListeners.add(fn); return () => fontListeners.delete(fn); }, () => fontsLoaded);

let ctx = null;
/** Width in px of text in this font (CSS shorthand without the size), at this size. */
function measureWith(font, spacing = 0) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  return (text, size) => {
    ctx.font = font.replace("{size}", `${size}px`);
    return ctx.measureText(text).width + spacing * size * text.length;
  };
}
const cssVar = (name, fallback) => (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

/** A spine's colours: from the cover's left edge, or the cloth for a book without a picture. */
function useSpineColors(e) {
  const info = useCoverInfo(e.cover);
  const cloth = e.cover ? null : clothFor(e.title);
  const bg = cloth ? cloth.bg : info?.spine || "#2A2C31";
  return { bg, ink: cloth ? cloth.ink : inkFor(bg) };
}

/**
 * How a spine is set: the title down it at the largest size that fits on one
 * to three lines, the author's last name at the foot; a spine too thin for its
 * title is drawn a little thicker rather than cutting the title short.
 */
function useSpineType(e, h, w) {
  const fonts = useFonts();
  const author = e.category === "reading" && e.author ? lastName(e.author) : "";
  return useMemo(() => {
    const serif = measureWith(`500 {size} ${cssVar("--serif", "serif")}`, 0.01);
    const mono = measureWith(`500 {size} ${cssVar("--mono", "monospace")}`, 0.06);
    let authorSize = 0, authorLen = 0;
    if (author) {
      const name = author.toUpperCase();
      authorSize = Math.max(6, Math.min(8.5, (8.5 * 46) / Math.max(1, mono(name, 8.5))));
      authorLen = mono(name, authorSize);
    }
    const length = h - 15 - 12 - (author ? authorLen + 10 : 0) - 2;
    const fit = fitTitle(e.title, { length, across: w - 10, max: 13, min: 7.5, measure: serif });
    return { ...fit, width: Math.max(w, fit.across + 10), author, authorSize };
  }, [e.title, author, h, w, fonts]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Spine({ entry: e, index, onOpen, onMenu }) {
  const { bg, ink } = useSpineColors(e);
  const h = spineHeight(e);
  const type = useSpineType(e, h, Math.max(22, Math.round(bookThickness(e) * 1.9)));
  const progress = e.total ? `${e.done} / ${e.total} ${e.unit}` : e.finished ? "Finished" : e.want ? "Want to read" : "";
  return (
    <button className={`spine${e.want ? " want" : ""}`} style={{ "--w": `${type.width}px`, "--h": `${h}px`, "--spine": bg, "--spine-ink": ink, "--i": index }}
      onClick={(ev) => onOpen(ev.currentTarget)} onContextMenu={(ev) => { ev.preventDefault(); onMenu(ev); }}
      title={[e.title, e.category === "reading" ? e.author : "", progress].filter(Boolean).join(" · ")} aria-label={`Open ${e.title}`}>
      <span className="spine-title" style={{ "--fs": `${type.size}px` }}>{type.lines.map((l, i) => <span key={i}>{l}</span>)}</span>
      {type.author && <span className="spine-author" style={{ "--fs": `${type.authorSize}px` }}>{type.author}</span>}
      {e.recallDue && <span className="spine-mark" aria-hidden="true"/>}
    </button>
  );
}

/** A small menu where you right-clicked: edit, hide or remove. */
function SpineMenu({ at, entry, onClose, onEdit, onHide, onRemove }) {
  const ref = useRef(null);
  useEffect(() => {
    const away = (ev) => { if (!ref.current?.contains(ev.target)) onClose(); };
    const esc = (ev) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    ref.current?.querySelector("button")?.focus();
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const left = Math.min(at.x, window.innerWidth - 200), top = Math.min(at.y, window.innerHeight - 120);
  return (
    <div className="book-menu-list spine-menu" role="menu" ref={ref} style={{ left, top }}>
      <button role="menuitem" onClick={() => { onClose(); onEdit(entry); }}><Icon name="edit" size={14}/>Edit</button>
      {entry.linked
        ? <button role="menuitem" onClick={() => { onClose(); onHide(entry); }}><Icon name="x" size={14}/>Hide from the shelf</button>
        : <button role="menuitem" className="danger" onClick={() => { onClose(); onRemove(entry); }}><Icon name="trash" size={14}/>Remove</button>}
    </div>
  );
}

export function SpineShelf({ entries, onOpen, onEdit, onHide, onRemove, onAdd, addLabel }) {
  const [menu, setMenu] = useState(null); // { entry, at }
  return (
    <div className="spine-shelf">
      {entries.map((e, i) => (
        <div key={e.key} className="spine-slot">
          <Spine entry={e} index={i} onOpen={(el) => onOpen(e, el)} onMenu={(ev) => setMenu({ entry: e, at: { x: ev.clientX, y: ev.clientY } })}/>
        </div>
      ))}
      {onAdd && (
        <div className="spine-slot">
          <button className="spine spine-add" style={{ "--w": "34px", "--h": "168px", "--i": entries.length }} onClick={onAdd} aria-label={addLabel} title={addLabel}>
            <Icon name="plus" size={16}/>
          </button>
        </div>
      )}
      {menu && <SpineMenu at={menu.at} entry={menu.entry} onClose={() => setMenu(null)} onEdit={onEdit} onHide={onHide} onRemove={onRemove}/>}
    </div>
  );
}

/** One finished book lying in the pile, its whole title along the spine. */
function Slab({ entry: e, index, onOpen }) {
  const { bg, ink } = useSpineColors(e);
  const fonts = useFonts();
  const r = (k) => seeded(e.key, k);
  const share = 0.62 + r(1) * 0.3; // of the pile's width
  const t = Math.max(20, Math.round(bookThickness(e) * 1.35));
  const author = e.category === "reading" && e.author ? lastName(e.author) : "";
  const type = useMemo(() => {
    const serif = measureWith(`500 {size} ${cssVar("--serif", "serif")}`);
    const mono = measureWith(`500 {size} ${cssVar("--mono", "monospace")}`, 0.06);
    const room = 420 * share - 28 - 8 - (author ? mono(author.toUpperCase(), 9.5) + 18 : 0);
    return fitTitle(e.title, { length: room, across: t - 6, max: Math.min(14, t * 0.62), min: 8, leading: 1.08, measure: serif });
  }, [e.title, author, share, t, fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button className="slab" onClick={() => onOpen(e)} title={e.title}
      style={{ "--w": `${share * 100}%`, "--t": `${Math.max(t, type.across + 6)}px`, "--x": `${(r(2) - 0.5) * 22}px`,
        "--r": `${(r(3) - 0.5) * 2.4}deg`, "--spine": bg, "--spine-ink": ink, "--i": index }}>
      <span className="slab-title" style={{ "--fs": `${type.size}px` }}>{type.lines.map((l, i) => <span key={i}>{l}</span>)}</span>
      {author && <span className="slab-author">{author}</span>}
    </button>
  );
}

export function YearView({ entries, year, onYear, onBack, onOpen }) {
  const y = yearOnShelf(entries, year);
  const fmt = (n) => n.toLocaleString();
  return (
    <div className="year" key={year}>
      <button className="crumb" onClick={onBack}><Icon name="back" size={14}/>Shelf</button>
      <div className="year-head">
        <div>
          <h1 className="year-title">{year}</h1>
          <div className="year-sub">on your shelf</div>
        </div>
        {y.years.length > 1 && (
          <div className="seg" role="group" aria-label="Year">
            {y.years.slice(0, 6).map(yr => <button key={yr} className={yr === year ? "on" : ""} onClick={() => onYear(yr)}>{yr}</button>)}
          </div>
        )}
      </div>

      <Figures>
        <Figure value={y.books} label={y.books === 1 ? "book finished" : "books finished"}/>
        <Figure value={y.pages ? fmt(y.pages) : "–"} label="pages read"/>
        <Figure value={y.study} label={y.study === 1 ? "textbook or course finished" : "textbooks and courses finished"}/>
        <Figure value={y.rating == null ? "–" : y.rating.toFixed(1)} label="average rating"/>
      </Figures>

      <div className="year-body">
        <div className="year-pile">
          <div className="year-stack">
            {y.finished.map((e, i) => <Slab key={e.key} entry={e} index={i} onOpen={onOpen}/>)}
          </div>
          <div className="year-plank" aria-hidden="true"/>
          {y.finished.length === 0 && <p className="muted small year-none">Nothing finished in {year} yet.</p>}
        </div>
        <ol className="year-months">
          {MONTHS.map((m, i) => (
            <li key={m} className={y.byMonth[i].length ? "" : "empty"}>
              <span className="year-month">{m.slice(0, 3)}</span>
              <span className="year-month-books">
                {y.byMonth[i].map(e => <button key={e.key} className="year-book" onClick={() => onOpen(e)}>{e.title}</button>)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

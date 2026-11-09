// A book standing on the shelf, in CSS 3D (a cover with real thickness, page
// edges and a spine), and under it only how far along it is (the title is on
// the cover; author, rating and the rest are in its panel or form). Pointing at a book lifts it and turns it
// toward you; logging a chapter swings its cover open. See styles/shelf.css.

import { useEffect, useRef, useState } from "react";
import Icon from "../../ui/Icon.jsx";
import { Menu, MenuItem } from "../../ui/overlays.jsx";
import { CoverArt, useCoverInfo } from "../../ui/Cover.jsx";
import { stillMotion } from "../../ui/motion.js";
import { play } from "../../ui/sound.js";
import { cx } from "../../ui/cx.js";
import { clothFor, bookThickness } from "../../lib/cover.js";
import { SHELF_STATUS } from "../../lib/shelf.js";
import { pct, monthYear } from "../../lib/format.js";

const TILT_VARS = ["--ry", "--rx", "--gx", "--gy"];

/** The pointer over an element, smoothed to one update a frame. */
function usePointer(onMove, onLeave) {
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

/** The book itself, in 3D. `opening` swings the cover open each time it changes. */
function Book({ entry: e, opening, onOpen, menu }) {
  const info = useCoverInfo(e.cover);
  const spine = e.cover ? info?.spine || "#24262B" : clothFor(e.title).bg;
  const tilt = usePointer(
    (el, x, y) => {
      el.classList.add("lifted");
      if (stillMotion()) return;
      const r = el.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (x - r.left) / r.width)), fy = Math.min(1, Math.max(0, (y - r.top) / r.height));
      el.style.setProperty("--ry", `${((fx - 0.5) * 12).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${((0.5 - fy) * 6).toFixed(2)}deg`);
      el.style.setProperty("--gx", `${(fx * 100).toFixed(1)}%`);
      el.style.setProperty("--gy", `${(fy * 100).toFixed(1)}%`);
    },
    (el) => { el.classList.remove("lifted"); for (const v of TILT_VARS) el.style.removeProperty(v); },
  );
  const open = (ev) => onOpen(ev.currentTarget);
  return (
    <div className={cx("book-hold", e.want && "want", opening > 0 && `open-${opening % 2}`)}
      style={{ "--t": `${bookThickness(e)}px`, "--spine": spine }} {...tilt}>
      <div className="book" role="button" tabIndex={0} aria-label={`Open ${e.title}`} onClick={open}
        onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(ev); } }}>
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
      {menu}
    </div>
  );
}

/** The plank a row of books stands on; each card brings its own length of it. */
export const Ledge = () => <div className="ledge" aria-hidden="true"/>;

/** How far along, in words: "212 / 480 pages", "Oct 2026", "4 chapters done"… */
function progressText(e) {
  const reading = e.category === "reading";
  if (e.want) return SHELF_STATUS.reading.want;
  if (e.total) return `${e.done} / ${e.total} ${e.unit}`;
  if (e.finished) return e.finishedAt ? monthYear(e.finishedAt) : "Done";
  if (e.done) return `${e.done} ${e.unit} ${reading ? "read" : "done"}`;
  return "Not started";
}

/**
 * A book with its progress under it. Its parts are rows of the shelf's grid
 * (subgrid), so the progress lines up across a row.
 * `hidden`: shown among the books hidden from the shelf (dimmed, to put back).
 */
export function BookCard({ entry: e, index, hidden = false, onOpen, onEdit, onBump, onHide, onRemove }) {
  const [opening, setOpening] = useState(0); // bumped to swing the cover open once
  const [menuOpen, setMenuOpen] = useState(false);
  const reading = e.category === "reading";
  const one = e.unit.replace(/s$/, "");
  const more = () => { onBump(1); setOpening(n => n + 1); play("page"); };

  const menu = (
    <Menu label={`More for ${e.title}`} trigger="book-more" onOpenChange={setMenuOpen}>
      <MenuItem icon="edit" onClick={onEdit}>Edit</MenuItem>
      {hidden ? <MenuItem icon="undo" onClick={onHide}>Put back on the shelf</MenuItem>
        : e.linked ? <MenuItem icon="x" onClick={onHide}>Hide from the shelf</MenuItem>
        : <MenuItem icon="trash" danger onClick={onRemove}>Remove</MenuItem>}
    </Menu>
  );

  return (
    <article className={cx("book-card", hidden && "dim", menuOpen && "menu-open")} style={{ "--i": index }}>
      <div className="book-slot"><Book entry={e} opening={opening} onOpen={onOpen} menu={menu}/></div>
      <Ledge/>
      <div className="book-progress">
        <div className="book-prog">
          <span className="ell">{progressText(e)}</span>
          <span className="book-end">
            <span className="book-pct">
              {e.finished ? <Icon name="check" size={13}/>
                : e.want ? null
                : e.total > 0 ? <span className="num">{pct(e.pct)}</span>
                : !hidden && <button className="link small" onClick={onEdit}>Set total</button>}
            </span>
            {!reading && !hidden && (
              <span className="book-step">
                <button disabled={e.done <= e.read} onClick={() => onBump(-1)} aria-label={`One ${one} less`}>−</button>
                <button disabled={e.total > 0 && e.done >= e.total} onClick={more} aria-label={`One more ${one}`}>+</button>
              </span>
            )}
          </span>
        </div>
        <div className={cx("book-bar", e.finished && "good")}><span style={{ "--p": Math.max(0, Math.min(1, e.pct || 0)) }}/></div>
      </div>
    </article>
  );
}

/** The empty place at the start of the shelf, to add the next book. */
export function AddCard({ label, index, onAdd }) {
  return (
    <button className="book-card add" onClick={onAdd} style={{ "--i": index }} aria-label={label} title={label}>
      <div className="book-slot"><div className="book-hold"><div className="book-ghost"><Icon name="plus" size={20}/></div></div></div>
      <Ledge/>
    </button>
  );
}

/** Empty places that carry the plank to the end of the last row. */
export function Fillers({ count, from }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={`gap${i}`} className="book-card filler" aria-hidden="true" style={{ "--i": from + i }}>
      <div className="book-slot"/><Ledge/>
    </div>
  ));
}

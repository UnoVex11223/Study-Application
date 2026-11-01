// The shelf seen spine-out, like a real bookcase: packed close, each spine
// coloured from its cover (or its cloth), as thick as the book is long, with
// the whole title running down it (on more lines or in smaller type when it's
// long, never cut short). Right-click a spine for Edit, Hide or Remove.

import { useMemo, useState } from "react";
import Icon from "../../ui/Icon.jsx";
import { PointerMenu, MenuItem } from "../../ui/overlays.jsx";
import { cx } from "../../ui/cx.js";
import { bookThickness, spineHeight, fitTitle } from "../../lib/cover.js";
import { lastName, useFonts, measureWith, useSpineColors } from "./typeset.js";

/**
 * How a spine is set: the title down it at the largest size that fits on one
 * to three lines, the author's last name at the foot; a spine too thin for its
 * title is drawn a little thicker rather than cutting the title short.
 */
function useSpineType(e, h, w) {
  const fonts = useFonts();
  const author = e.category === "reading" && e.author ? lastName(e.author) : "";
  return useMemo(() => {
    const serif = measureWith("serif", 500, 0.01);
    const sans = measureWith("sans", 700, 0.03);
    let authorSize = 0, authorLen = 0;
    if (author) {
      authorSize = Math.max(6.5, Math.min(9.5, (9.5 * 46) / Math.max(1, sans(author, 9.5))));
      authorLen = sans(author, authorSize);
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
    <button className={cx("spine", e.want && "want")} style={{ "--w": `${type.width}px`, "--h": `${h}px`, "--spine": bg, "--spine-ink": ink, "--i": index }}
      onClick={(ev) => onOpen(ev.currentTarget)} onContextMenu={(ev) => { ev.preventDefault(); onMenu(ev); }}
      title={[e.title, e.category === "reading" ? e.author : "", progress].filter(Boolean).join(", ")} aria-label={`Open ${e.title}`}>
      <span className="spine-title" style={{ "--fs": `${type.size}px` }}>{type.lines.map((l, i) => <span key={i}>{l}</span>)}</span>
      {type.author && <span className="spine-author" style={{ "--fs": `${type.authorSize}px` }}>{type.author}</span>}
      {e.recallDue && <span className="spine-mark" aria-hidden="true"/>}
    </button>
  );
}

export default function SpineShelf({ entries, onOpen, onEdit, onHide, onRemove, onAdd, addLabel }) {
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
          <button className="spine spine-add" style={{ "--i": entries.length }} onClick={onAdd} aria-label={addLabel} title={addLabel}>
            <Icon name="plus"/>
          </button>
        </div>
      )}
      {menu && (
        <PointerMenu at={menu.at} onClose={() => setMenu(null)}>
          <MenuItem icon="edit" onClick={() => onEdit(menu.entry)}>Edit</MenuItem>
          {menu.entry.linked
            ? <MenuItem icon="x" onClick={() => onHide(menu.entry)}>Hide from the shelf</MenuItem>
            : <MenuItem icon="trash" danger onClick={() => onRemove(menu.entry)}>Remove</MenuItem>}
        </PointerMenu>
      )}
    </div>
  );
}

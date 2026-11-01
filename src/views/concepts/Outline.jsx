// An outline: sections (or topics) that open to show their concepts. Used by a
// course page (its chapters) and Notes (its topics).
//
//   <Outline>
//     <OutlineItem title="Pointers" meta={<span>12 concepts</span>} side={…} open={…} onToggle={…}>
//       <ConceptRow concept={c} status="mastered" tags={…} onOpen={…}/>
//       <OutlineActions>…buttons…</OutlineActions>
//     </OutlineItem>
//   </Outline>

import Icon from "../../ui/Icon.jsx";
import { StatusDot } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";

export const Outline = ({ children }) => <div className="list outline">{children}</div>;

/**
 * One section. With `onToggle` its row opens and closes it; without, `lead`
 * (a spinner, a lock) takes the chevron's place. `side` sits at the right:
 * how far along it is, or a button.
 */
export function OutlineItem({ id, title, titleIcon, meta, side, open = false, onToggle, lead, waiting = false, children }) {
  const text = (
    <span className="outline-text">
      <span className="outline-title">{titleIcon && <Icon name={titleIcon} size={14}/>}<span className="ell">{title}</span></span>
      {meta && <span className="meta">{meta}</span>}
    </span>
  );
  return (
    <div id={id} className={cx("outline-item", open && "open", waiting && "waiting")}>
      <div className="outline-head">
        {onToggle ? (
          <button className="outline-toggle" onClick={onToggle} aria-expanded={open}>
            <Icon name="chevron" className="chev"/>{text}
          </button>
        ) : (
          <div className="outline-toggle">{lead ?? <span/>}{text}</div>
        )}
        <div className="outline-side">{side}</div>
      </div>
      {open && <div className="outline-body">{children}</div>}
    </div>
  );
}

/** A concept in an open section: how well it's known, its name, and tags at the right. */
export function ConceptRow({ concept, status, tags, onOpen }) {
  return (
    <button className={cx("concept-row", concept.suspended && "suspended")} onClick={() => onOpen(concept.id)}>
      <StatusDot status={status}/>
      <span className="ell">{concept.name}</span>
      <span className="row gap-1">{tags}</span>
    </button>
  );
}

/** The actions under an open section's concepts. */
export const OutlineActions = ({ children }) => <div className="outline-actions">{children}</div>;

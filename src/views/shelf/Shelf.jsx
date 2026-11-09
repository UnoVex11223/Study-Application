// The shelf: books you read for their own sake, textbooks and courses, each
// with its own tab (Tenax courses are on it automatically, see lib/shelf.js).
// They stand on shelves as books, covers out (BookCard.jsx); the year
// (YearView.jsx) opens from search.
// Reading books also keep notes, a rating and recalls (BookPanel.jsx,
// RecallSession.jsx). Covers are shaped by lib/cover.js.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, PageHeader } from "../../ui/layout.jsx";
import { ConfirmDialog } from "../../ui/overlays.jsx";
import { transition } from "../../ui/motion.js";
import { shelfEntries, SHELF_FILTERS, SHELF_KINDS, makeShelfItem } from "../../lib/shelf.js";
import { dueForRecall } from "../../lib/recall.js";
import { BookCard, AddCard, Fillers } from "./BookCard.jsx";
import BookPanel from "./BookPanel.jsx";
import ShelfForm from "./ShelfForm.jsx";
import RecallSession from "./RecallSession.jsx";
import YearView from "./YearView.jsx";

// Shelf geometry: the narrowest a book column gets, and the space between books (also in shelf.css).
const BOOK_MIN = 132;
const BOOK_GAP = 36;

/** How many books fit across the shelf, so the last row's plank can run the full width. */
function useColumns(ref) {
  const [cols, setCols] = useState(5);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => setCols(Math.max(1, Math.floor((entry.contentRect.width + BOOK_GAP) / (BOOK_MIN + BOOK_GAP)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

/** Tabs with a line under the chosen one that slides to the next. */
function Tabs({ tabs, value, onChange, counts }) {
  const listRef = useRef(null);
  const inkRef = useRef(null);
  const placeInk = useCallback(() => {
    const on = listRef.current?.querySelector('[aria-selected="true"]');
    if (!on || !inkRef.current) return;
    inkRef.current.style.width = `${on.offsetWidth}px`;
    inkRef.current.style.transform = `translateX(${on.offsetLeft}px)`;
  }, []);
  const countKey = tabs.map(t => counts[t.id]).join(",");
  useLayoutEffect(() => { placeInk(); }, [placeInk, value, countKey]);
  useEffect(() => {
    const ink = inkRef.current;
    const ready = requestAnimationFrame(() => ink?.classList.add("ready"));
    window.addEventListener("resize", placeInk);
    document.fonts?.ready.then(placeInk);
    return () => { cancelAnimationFrame(ready); window.removeEventListener("resize", placeInk); };
  }, [placeInk]);
  return (
    <div className="shelf-tabs" role="tablist" aria-label="Show" ref={listRef}>
      {tabs.map(f => (
        <button key={f.id} role="tab" aria-selected={value === f.id} onClick={() => onChange(f.id)}>
          {f.label}
        </button>
      ))}
      <span className="tab-ink" ref={inkRef} aria-hidden="true"/>
    </div>
  );
}

export default function Shelf({ recall: startRecall = false, openItem = null, adding = false, year: startYear = null }) {
  const { state, act } = useStore();
  const nav = useNav();
  const entries = useMemo(() => shelfEntries(state, nav.now), [state, nav.now]);
  // Opened from the palette: a book's panel, a textbook or course's edit form, or a new item.
  const startItem = openItem ? state.shelf.find(it => it.id === openItem) : null;
  // Opens on the first tab with something in it.
  const [filter, setFilter] = useState(() => (SHELF_FILTERS.find(f => entries.some(e => !e.hidden && f.test(e))) ?? SHELF_FILTERS[0]).id);
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState(() => (adding ? { entry: null }
    : startItem && startItem.kind !== "reading" ? { entry: entries.find(e => e.item?.id === startItem.id) || null } : null)); // null | { entry } (entry null = new)
  const [openId, setOpenId] = useState(() => (startItem?.kind === "reading" ? startItem.id : null));
  const [recallQueue, setRecallQueue] = useState(() => (startRecall ? dueForRecall(state.shelf, Date.now()).map(it => it.id) : null));
  const [year, setYear] = useState(startYear); // the year view, or null for the shelf
  const [removing, setRemoving] = useState(null); // an entry to confirm removing
  const shelfRef = useRef(null);
  const cols = useColumns(shelfRef);

  const due = dueForRecall(state.shelf, nav.now);
  const tab = SHELF_FILTERS.find(f => f.id === filter);
  const visible = entries.filter(e => !e.hidden);
  const shown = visible.filter(tab.test);
  const hidden = entries.filter(e => e.hidden);
  const counts = Object.fromEntries(SHELF_FILTERS.map(f => [f.id, visible.filter(f.test).length]));
  const open = state.shelf.find(it => it.id === openId && it.kind === "reading" && !it.courseId) || null;
  const addLabel = `Add a ${SHELF_KINDS[tab.kind].label.toLowerCase()}`;
  const add = () => setEditing({ entry: null });
  const edit = (e) => setEditing({ entry: e });
  // Empty places that carry the last row's plank to the end of the row.
  const fill = (cells) => (cells === 0 ? cols : (cols - (cells % cols)) % cols);

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
  // A Tenax course's book (or spine) flies off the shelf into the course page's header (a "book" view transition).
  const openEntry = (e, from) => {
    if (e.course) {
      const hold = from?.closest?.(".book-card")?.querySelector(".book-hold") ?? from?.closest?.(".spine");
      if (hold) { hold.style.viewTransitionName = "book"; hold.classList.add("flying"); }
      nav.go("course", { courseId: e.course.id }, { type: "book" });
    } else if (e.kind === "reading") setOpenId(e.item.id);
    else edit(e);
  };

  const showYear = (y) => transition(() => { setYear(y); document.querySelector(".main")?.scrollTo(0, 0); });

  // Panels, forms and dialogs, shown over the shelf or the year view.
  const overlays = (
    <>
      {open && <BookPanel key={open.id} item={open} now={nav.now} onClose={() => setOpenId(null)}
        onEdit={() => edit(entries.find(e => e.item?.id === open.id))} onRecall={() => setRecallQueue([open.id])}/>}
      {editing && <ShelfForm entry={editing.entry} startKind={tab.kind} onClose={() => setEditing(null)}
        onSaved={(item, created) => {
          setEditing(null);
          if (item.kind !== "reading") setOpenId(null);
          else if (created) setOpenId(item.id);
        }}/>}
      {recallQueue && <RecallSession queue={recallQueue} onClose={() => setRecallQueue(null)}/>}
      {removing && (
        <ConfirmDialog title="Remove from your shelf?" action="Remove" onConfirm={() => act("shelf/remove", { id: removing.item.id })} onClose={() => setRemoving(null)}>
          “{removing.title}”{removing.category === "reading" ? " and its notes" : ""} will be taken off the shelf.
        </ConfirmDialog>
      )}
    </>
  );

  if (year != null) {
    return (
      <YearView entries={entries} year={year} onYear={showYear} onBack={() => showYear(null)}
        onOpen={(e) => (e.course ? nav.go("course", { courseId: e.course.id }) : e.kind === "reading" ? setOpenId(e.item.id) : edit(e))}>
        {overlays}
      </YearView>
    );
  }

  const card = (e, i, isHidden = false) => (
    <BookCard key={e.key} entry={e} index={i} hidden={isHidden}
      onOpen={isHidden ? () => setHidden(e, false) : (from) => openEntry(e, from)}
      onEdit={() => edit(e)} onBump={(d) => bump(e, d)}
      onHide={() => setHidden(e, !isHidden)} onRemove={() => setRemoving(e)}/>
  );

  return (
    <Page className="shelf-page">
      <PageHeader title="Shelf" actions={<>
        {due.length > 0 && <button className="btn" onClick={() => setRecallQueue(due.map(it => it.id))}><Icon name="play"/>Recall {due.length}</button>}
        <button className="btn btn-primary" onClick={add}><Icon name="plus"/>Add to shelf</button>
      </>}/>

      <div className="shelf-bar">
        <Tabs tabs={SHELF_FILTERS} value={filter} onChange={setFilter} counts={counts}/>
      </div>

      <div className="shelf" ref={shelfRef}>
        <div className="shelf-grid" key={filter}>
          {shown.map((e, i) => card(e, i))}
          <AddCard label={addLabel} index={shown.length} onAdd={add}/>
          <Fillers count={fill(shown.length + 1)} from={shown.length + 1}/>
        </div>
      </div>

      {hidden.length > 0 && (
        <div className="shelf-hidden">
          <button className="btn btn-quiet btn-sm" onClick={() => setShowHidden(v => !v)}>
            {showHidden ? "Done" : `Hidden from the shelf (${hidden.length})`}
          </button>
          {showHidden && (
            <div className="shelf">
              <div className="shelf-grid">
                {hidden.map((e, i) => card(e, i, true))}
                <Fillers count={fill(hidden.length)} from={hidden.length}/>
              </div>
            </div>
          )}
        </div>
      )}

      {overlays}
    </Page>
  );
}

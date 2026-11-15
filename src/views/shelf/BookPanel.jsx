// A book you read for its own sake: its status, pages, rating, three short
// notes in your own words (they save as you type), and its next recall.
//
// Two blocks, each one shape: the cover beside its facts (the two start and
// end together), then one card for the notes, with the recall along its foot.

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import Icon from "../../ui/Icon.jsx";
import { Drawer } from "../../ui/overlays.jsx";
import { Field, Segmented, Confirm } from "../../ui/controls.jsx";
import { Stars } from "../../ui/display.jsx";
import { CoverArt } from "../../ui/Cover.jsx";
import { itemFinished, SHELF_STATUS } from "../../lib/shelf.js";
import { recallWhen, hasNotes } from "../../lib/recall.js";
import { plural, longDate } from "../../lib/format.js";

const STATUS_OPTIONS = Object.entries(SHELF_STATUS.reading);
const NOTES = [
  ["description", "What it's about"],
  ["thoughts", "What I thought"],
  ["ideas", "Ideas worth keeping"],
];
const SAVE_AFTER = 600; // ms of quiet typing before notes are saved
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Notes save as you type (after a short pause) and when the panel closes. */
function useDraft(item, act) {
  const [draft, setDraft] = useState(() => Object.fromEntries(NOTES.map(([k]) => [k, item[k] || ""])));
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
    timer.current = setTimeout(flush, SAVE_AFTER);
  };
  return [draft, change];
}

export default function BookPanel({ item, now, onClose, onEdit, onRecall }) {
  const { act } = useStore();
  const [draft, change] = useDraft(item, act);
  const [confirm, setConfirm] = useState(false);
  const patch = (p) => act("shelf/update", { id: item.id, patch: p });
  const finished = itemFinished(item);
  const status = item.status === "want" && !finished ? "want" : finished ? "finished" : "active";
  const unit = item.unitLabel || "pages";
  const count = (field) => (e) => patch({ [field]: Math.max(0, parseInt(e.target.value, 10) || 0) });

  return (
    <Drawer onClose={onClose} title={item.title} context={item.author || undefined}
      actions={<button className="btn btn-sm btn-quiet" onClick={onEdit}><Icon name="edit"/>Edit</button>}>
      <div className="book-head">
        <CoverArt src={item.cover} title={item.title} author={item.author} className="panel-cover"/>
        <div className="book-facts">
          <Segmented fill label="Status" options={STATUS_OPTIONS} value={status} onChange={(k) => patch({ status: k })}/>
          <div className="form-row">
            <Field label={capitalize(unit)} htmlFor="it-total">
              <input id="it-total" className="input" type="number" min="0" value={item.total || ""} onChange={count("total")}/>
            </Field>
            {status !== "want" && (
              <Field label="Read so far" htmlFor="it-done">
                <input id="it-done" className="input" type="number" min="0" value={item.done || ""} onChange={count("done")}/>
              </Field>
            )}
          </div>
          <div className="book-dates">
            <div className="meta">
              {item.startedAt && <span>Started {longDate(item.startedAt)}</span>}
              {item.finishedAt && <span>Finished {longDate(item.finishedAt)}</span>}
              {!item.startedAt && !item.finishedAt && <span>Not started</span>}
            </div>
            {finished && <Stars value={item.rating || 0} onChange={(n) => patch({ rating: n })} size={18}/>}
          </div>
        </div>
      </div>

      <div className="book-notes">
        {NOTES.map(([field, label]) => (
          <div key={field} className="book-note">
            <label htmlFor={`it-${field}`}>{label}</label>
            <textarea id={`it-${field}`} className="book-note-text" rows={2} value={draft[field]} placeholder="A few lines, in your own words"
              onChange={e => change(field, e.target.value)}/>
          </div>
        ))}
        {hasNotes({ ...item, ...draft }) && (
          <div className="book-notes-foot">
            <span className="grow small">
              {item.recall
                ? <>Next recall {recallWhen(item.recall, now)}{item.recall.count ? <span className="muted">, recalled {plural(item.recall.count, "time")}</span> : null}</>
                : "First recall in 3 days"}
            </span>
            <button className="btn btn-sm" onClick={onRecall}><Icon name="play"/>Recall now</button>
          </div>
        )}
      </div>

      <div className="rule-top">
        {confirm ? (
          <Confirm action="Remove" onCancel={() => setConfirm(false)} onConfirm={() => { act("shelf/remove", { id: item.id }); onClose(); }}>
            Remove “{item.title}” and its notes?
          </Confirm>
        ) : (
          <button className="btn btn-sm btn-danger" onClick={() => setConfirm(true)}><Icon name="trash"/>Remove from shelf</button>
        )}
      </div>
    </Drawer>
  );
}

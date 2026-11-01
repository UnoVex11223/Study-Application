// A book you read for its own sake: its status, pages, rating, three short
// notes in your own words (they save as you type), and its next recall.

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
      <div className="book-panel-top">
        <CoverArt src={item.cover} title={item.title} author={item.author} className="panel-cover"/>
        <div className="stack">
          <Segmented label="Status" options={STATUS_OPTIONS} value={status} onChange={(k) => patch({ status: k })}/>
          {status !== "want" && (
            <div className="row">
              <input className="input count-input" type="number" min="0" aria-label={`${unit} done`} value={item.done || ""} onChange={count("done")}/>
              <span className="muted small">of</span>
              <input className="input count-input" type="number" min="0" aria-label={`Total ${unit}`} value={item.total || ""} onChange={count("total")}/>
              <span className="muted small">{unit}</span>
            </div>
          )}
          {finished && <Stars value={item.rating || 0} onChange={(n) => patch({ rating: n })} size={18}/>}
          <div className="meta">
            {item.startedAt && <span>Started {longDate(item.startedAt)}</span>}
            {item.finishedAt && <span>Finished {longDate(item.finishedAt)}</span>}
          </div>
        </div>
      </div>

      <div className="form">
        {NOTES.map(([field, label]) => (
          <Field key={field} label={label} htmlFor={`it-${field}`}>
            <textarea id={`it-${field}`} className="textarea short" value={draft[field]} onChange={e => change(field, e.target.value)}/>
          </Field>
        ))}
      </div>

      {hasNotes({ ...item, ...draft }) && (
        <div className="book-recall-row">
          <span className="grow small">
            {item.recall
              ? <>Next recall {recallWhen(item.recall, now)}{item.recall.count ? <span className="muted">, recalled {plural(item.recall.count, "time")}</span> : null}</>
              : "First recall in 3 days"}
          </span>
          <button className="btn btn-sm" onClick={onRecall}><Icon name="play"/>Recall now</button>
        </div>
      )}

      <div className="rule-top">
        {confirm ? (
          <Confirm action="Remove" onCancel={() => setConfirm(false)} onConfirm={() => { act("shelf/remove", { id: item.id }); onClose(); }}>
            Remove “{item.title}” and its notes?
          </Confirm>
        ) : (
          <button className="btn btn-sm btn-quiet" onClick={() => setConfirm(true)}><Icon name="trash"/>Remove from shelf</button>
        )}
      </div>
    </Drawer>
  );
}

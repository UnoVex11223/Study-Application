// Recalling books, one at a time: say what you remember, then compare with
// your notes and say how it went (lib/recall.js schedules the next one).

import { useState } from "react";
import { useStore } from "../../state/store.jsx";
import { Modal } from "../../ui/overlays.jsx";
import { Field } from "../../ui/controls.jsx";
import { CoverArt } from "../../ui/Cover.jsx";
import { RECALL_RATINGS } from "../../lib/recall.js";
import { plural } from "../../lib/format.js";

const NOTES = [["description", "What it's about"], ["thoughts", "What I thought"], ["ideas", "Ideas worth keeping"]];

export default function RecallSession({ queue, onClose }) {
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
      <Modal title="Recall" size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
        <p>{done ? `${plural(done, "book")} recalled.` : "Nothing to recall right now."}</p>
      </Modal>
    );
  }

  return (
    <Modal title="Recall" size="lg" onClose={onClose}
      footer={!shown && <button className="btn btn-primary" onClick={() => setShown(true)}>Show my notes</button>}>
      <div className="recall-head">
        <CoverArt src={item.cover} title={item.title} className="recall-cover"/>
        <div className="stack gap-1">
          <div className="muted small num">{at + 1} of {queue.length}</div>
          <div className="recall-title">{item.title}</div>
          {item.author && <div className="muted">{item.author}</div>}
        </div>
      </div>
      <Field label="What do you remember?" htmlFor="rc-text">
        <textarea id="rc-text" className="textarea" value={text} autoFocus onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !shown) { e.preventDefault(); setShown(true); } }}/>
      </Field>
      {shown && (
        <>
          <div className="recall-notes">
            {NOTES.filter(([k]) => item[k]?.trim()).map(([k, label]) => (
              <div key={k} className="stack gap-1"><div className="caption">{label}</div><p>{item[k]}</p></div>
            ))}
          </div>
          {text.trim() && (
            <label className="check-label">
              <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)}/>Add what I wrote to my notes
            </label>
          )}
          <div className="recall-ratings">
            {RECALL_RATINGS.map(r => <button key={r.rating} className="btn" onClick={() => rate(r.rating)}>{r.label}</button>)}
          </div>
        </>
      )}
    </Modal>
  );
}

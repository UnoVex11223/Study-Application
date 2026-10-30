// Go deeper: after you answer, an interviewer's follow-ups, one level deeper
// each time, until an answer breaks (or you hold up through four). Where you
// broke is the gap; it can go to your Notes inbox, where processing turns it
// into a concept or extra questions like any other note.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import Markdown from "../ui/Markdown.jsx";
import Icon from "../ui/Icon.jsx";
import { Spinner, Notice } from "../ui/ui.jsx";
import { probeWithAI } from "../lib/ai.js";
import { newNotes } from "../lib/notes.js";

export const MAX_DEPTH = 4;

export default function GoDeeper({ item, concept, course, answer, onResult }) {
  const { state, act } = useStore();
  const [turns, setTurns] = useState([]); // { question, answer, verdict, feedback }
  const [question, setQuestion] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [end, setEnd] = useState(null); // { gap, feedback } | { held: true }
  const [saved, setSaved] = useState(false);
  const inputRef = useRef(null);

  /** Take the interviewer's reply to the follow-ups so far. */
  const take = (res, sofar, last) => {
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    let graded = sofar;
    if (sofar.length) {
      graded = sofar.map((t, i) => (i === sofar.length - 1 ? { ...t, verdict: res.lastVerdict, feedback: res.lastFeedback } : t));
      setTurns(graded);
    }
    if (!sofar.length && !res.next) { setError("Couldn't come up with a follow-up for this one."); return; }
    const held = res.lastVerdict === "correct" || res.lastVerdict === "none";
    if (!held) setEnd({ gap: res.gap, feedback: res.lastFeedback });
    else if (last || !res.next) setEnd({ held: true });
    else { setQuestion(res.next); setInput(""); setTimeout(() => inputRef.current?.focus(), 0); }
    onResult?.({ depth: graded.filter(t => t.verdict === "correct").length, broke: !held });
  };
  const ask = (sofar, last = false) => probeWithAI({ item, concept, answer, turns: sofar, last }).then(res => take(res, sofar, last));

  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; ask([]); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (text = input) => {
    if (busy || !text.trim()) return;
    const next = [...turns, { question, answer: text.trim() }];
    setTurns(next); setQuestion(""); setBusy(true); setError("");
    ask(next, next.length >= MAX_DEPTH);
  };

  const saveGap = () => {
    const { notes } = newNotes(state, [{ text: end.gap, context: [course?.name, concept.name].filter(Boolean).join(" › ") }], { source: "Go deeper" });
    if (notes.length) act("notes/add", { notes });
    setSaved(true);
  };

  return (
    <div className="deeper enter" aria-label="Go deeper">
      <div className="sub-label">Go deeper</div>
      {turns.map((t, i) => (
        <div key={i} className="deeper-turn">
          <div className="deeper-q"><Markdown>{t.question}</Markdown></div>
          <div className="deeper-a">
            {t.verdict && <span className={`check-mark ${t.verdict === "correct" ? "yes" : "no"}`}><Icon name={t.verdict === "correct" ? "check" : "x"} size={11} stroke={2.6}/></span>}
            <span className="grow">{t.answer}</span>
          </div>
        </div>
      ))}
      {question && !end && (
        <div className="deeper-turn">
          <div className="deeper-q"><Markdown>{question}</Markdown></div>
          <textarea ref={inputRef} className="answer-box deeper-input" value={input} onChange={e => setInput(e.target.value)} aria-label="Your answer to the follow-up"
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); } }}/>
          <div className="row">
            <button className="btn btn-sm btn-primary" disabled={busy || !input.trim()} onClick={() => submit()}>Answer <span className="kbd">Ctrl ↵</span></button>
            <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => submit("I don't know")}>I don't know</button>
            <span className="grow"/>
            <span className="small muted num">{turns.length + 1} of {MAX_DEPTH}</span>
          </div>
        </div>
      )}
      {busy && <div className="small muted row"><Spinner/>{turns.length ? "Checking…" : "Thinking of a follow-up…"}</div>}
      {error && <Notice tone="warn" icon="alert">{error}</Notice>}
      {end?.held && (
        <div className="small">Held up through all {turns.length} follow-up{turns.length === 1 ? "" : "s"}.</div>
      )}
      {end && !end.held && (
        <div className="deeper-gap">
          {end.feedback && <div>{end.feedback}</div>}
          {end.gap && (
            <div className="row" style={{ marginTop: 10, alignItems: "flex-start" }}>
              <div className="grow small"><strong>The gap:</strong> {end.gap}</div>
              {saved
                ? <span className="small muted" style={{ whiteSpace: "nowrap" }}><Icon name="check" size={12}/> In your Notes inbox</span>
                : <button className="btn btn-sm" onClick={saveGap}><Icon name="note" size={13}/>Save to Notes</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

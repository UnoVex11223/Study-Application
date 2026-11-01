// Checking your own answer, when there's no automatic grading (no API key, or
// grading failed): tick the key points you covered and any misconception you
// said; the verdict follows from those, as it would from the grader.

import { useState } from "react";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Notice } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { verdictFromChecks } from "../../lib/grade.js";

/** A list of statements, each with a box to tick (tone "bad" for misconceptions). */
function TickList({ items, ticked, onToggle, tone }) {
  return (
    <div className="checks">
      {items.map((text, i) => (
        <label key={i} className="check tickable">
          <button type="button" className={cx("tick", ticked[i] && (tone === "bad" ? "on-bad" : "on"))} aria-pressed={ticked[i]} onClick={() => onToggle(i)}>
            {ticked[i] && <Icon name={tone === "bad" ? "x" : "check"} size={12} stroke={3}/>}
          </button>
          <Markdown>{text}</Markdown>
        </label>
      ))}
    </div>
  );
}

const flip = (list, i) => list.map((v, j) => (j === i ? !v : v));

export default function SelfCheck({ item, points, error, onSave }) {
  const misconceptions = item.misconceptions || [];
  const [met, setMet] = useState(() => points.map(() => false));
  const [said, setSaid] = useState(() => misconceptions.map(() => false));

  const save = () => {
    const found = misconceptions.filter((_, i) => said[i]);
    onSave({
      verdict: verdictFromChecks(met, found.length), source: "self",
      points: points.map((text, i) => ({ text, met: met[i] })), misconceptionsFound: found, feedback: "",
    });
  };

  return (
    <div className="feedback enter">
      <div className="feedback-body">
        {error && <Notice tone="warn" icon="alert">{error}</Notice>}
        <div className="stack gap-2">
          <div className="caption">Model answer</div>
          <div className="quote"><Markdown>{item.answer}</Markdown></div>
        </div>
        <div className="stack gap-2">
          <div className="caption">Tick each key point your answer covered</div>
          <TickList items={points} ticked={met} onToggle={(i) => setMet(m => flip(m, i))}/>
        </div>
        {misconceptions.length > 0 && (
          <div className="stack gap-2">
            <div className="caption">Tick any of these you said</div>
            <TickList items={misconceptions} ticked={said} tone="bad" onToggle={(i) => setSaid(s => flip(s, i))}/>
          </div>
        )}
        <div><button className="btn btn-primary" onClick={save}>Save check</button></div>
      </div>
    </div>
  );
}

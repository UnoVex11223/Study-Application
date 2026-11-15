// A question waiting to be kept or left out, after Claude wrote and reviewed
// it (adding material, processing notes). It's one line: a tick to keep it,
// its step, and the question. Opening it shows the whole question, its kind
// and quality score, why it was filtered out, and its answer.

import { useState } from "react";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import Diagram from "../../ui/Diagram.jsx";
import { cx } from "../../ui/cx.js";
import { DIMENSIONS } from "../../lib/quality.js";
import { abilityLabel, levelLabel, levelOf } from "../../lib/model.js";

// The question on one line: code blocks named rather than shown, the rest as written.
const oneLine = (md) => String(md || "").replace(/```[\s\S]*?```/g, " [code] ").replace(/`/g, "").replace(/\s+/g, " ").trim();

export default function QuestionRow({ q, onToggle, dropped = false }) {
  const [open, setOpen] = useState(false);
  const dimText = q.dims ? Object.entries(q.dims).map(([k, v]) => `${DIMENSIONS[k]}: ${v}/5`).join("\n") : "Checked by rules only";
  const facts = [abilityLabel(q.ability), q.score != null && `Quality ${q.score.toFixed(1)}`, q.revised && "Improved by the reviewer"].filter(Boolean).join(", ");
  return (
    <div className={cx("rq", !q.selected && "off", open && "open")}>
      <input type="checkbox" checked={q.selected} onChange={onToggle} aria-label={q.selected ? "Leave this question out" : "Keep this question"}/>
      <div className="rq-main">
        <button type="button" className="rq-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className="rq-step">Step {levelOf(q)} · {levelLabel(q)}</span>
          {open ? <span className="rq-facts" title={dimText}>{facts}</span> : <span className="rq-text">{oneLine(q.prompt)}</span>}
          <Icon name="chevron" className="rq-chevron"/>
        </button>
        {dropped && q.reasons?.[0] && <div className="rq-why error-text">{q.reasons[0]}</div>}
        {open && (
          <div className="rq-more">
            <Markdown>{q.prompt}</Markdown>
            {q.diagram && <Diagram spec={q.diagram} className="small"/>}
            {!dropped && q.warnings?.length > 0 && <div className="small muted">{q.warnings.join(" ")}</div>}
            <div className="rq-answer">
              <div className="caption">Answer</div>
              <Markdown>{q.answer}</Markdown>
              {q.points?.length > 0 && <ul className="bullets">{q.points.map((p, i) => <li key={i}><Markdown>{p}</Markdown></li>)}</ul>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

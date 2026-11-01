// A question waiting to be kept or left out, after Claude wrote and reviewed
// it (adding material, processing notes): tick to keep it, see its quality
// score, why it was filtered out, and its answer.

import Markdown from "../../ui/Markdown.jsx";
import { cx } from "../../ui/cx.js";
import { DIMENSIONS } from "../../lib/quality.js";
import { abilityLabel } from "../../lib/model.js";

export default function QuestionRow({ q, onToggle, dropped = false }) {
  const dimText = q.dims ? Object.entries(q.dims).map(([k, v]) => `${DIMENSIONS[k]}: ${v}/5`).join("\n") : "Checked by rules only";
  return (
    <div className={cx("review-q", !q.selected && "off")}>
      <input type="checkbox" checked={q.selected} onChange={onToggle} aria-label={q.selected ? "Leave this question out" : "Keep this question"}/>
      <div className="stack gap-2">
        <div className="row small">
          <strong>{abilityLabel(q.ability)}</strong>
          {q.revised && <span className="tag sky">Improved by the reviewer</span>}
          {q.score != null && <span className="muted" title={dimText}>Quality {q.score.toFixed(1)}</span>}
        </div>
        <Markdown>{q.prompt}</Markdown>
        {dropped && q.reasons?.[0] && <div className="error-text">{q.reasons[0]}</div>}
        {!dropped && q.warnings?.length > 0 && <div className="small muted">{q.warnings.join(" ")}</div>}
        <details className="disclosure">
          <summary>Answer and key points</summary>
          <div className="stack gap-2 small">
            <Markdown>{q.answer}</Markdown>
            {q.points?.length > 0 && <ul className="bullets">{q.points.map((p, i) => <li key={i}><Markdown>{p}</Markdown></li>)}</ul>}
          </div>
        </details>
      </div>
    </div>
  );
}

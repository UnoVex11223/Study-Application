// The question being asked: what kind of task it is, the question itself, and
// the flag for reporting a bad question (or, on a fresh version, going back to
// the original).

import { useState } from "react";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { CourseDot } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { abilityLabel } from "../../lib/model.js";
import { FLAG_REASONS } from "../../lib/quality.js";
import { CODE_LANGS } from "../../lib/code.js";

const KIND_LABEL = {
  new: "New concept",
  learning: "Relearning",
  review: "Review",
  foundation: "Foundation check",
  practice: "Practice",
  requeue: "One more try",
  pretest: "Pretest",
};
const REPORT_REASONS = ["unclear", "wrong", "trivial", "other"];

export default function QuestionCard({ task, item, concept, course, section, fresh, code, canUseOriginal, onUseOriginal, onReport }) {
  const [reporting, setReporting] = useState(false);
  return (
    <div className="stack gap-3">
      <div className="session-kind">
        <span>{KIND_LABEL[task.kind] ?? "Review"}</span>
        {concept.importance === "core" && <span className="tag sky">Core</span>}
        {fresh && <span className="tag" title="A new example of a question you've answered before, written for today">Fresh version</span>}
      </div>

      <article className="q-card">
        <div className="q-head">
          <span className="tag sky">{abilityLabel(item.ability)}</span>
          <CourseDot color={course?.color}/>
          <span className="grow ell">{course?.name}{section ? ` / ${section.title}` : ""}</span>
          <button className={cx("btn btn-quiet btn-sm btn-icon", reporting && "on")} onClick={() => setReporting(r => !r)}
            title="Report this question" aria-label="Report this question" aria-expanded={reporting}>
            <Icon name="flag"/>
          </button>
        </div>
        <div className="q-prompt"><Markdown>{item.prompt}</Markdown></div>
        {code && <div className="small muted">{CODE_LANGS[code.lang].label}, checked by running its tests</div>}
        {reporting && (
          <div className="report-box stack gap-2 enter">
            {fresh ? (
              <>
                <div className="small">This is a fresh version written for today, so it won't come back.</div>
                <div className="row wrap">
                  {canUseOriginal && <button className="btn btn-sm" onClick={() => { onUseOriginal(); setReporting(false); }}>Use the original question</button>}
                  <button className="btn btn-sm btn-quiet" onClick={() => setReporting(false)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="small">What's wrong with this question? It will be taken out of your sessions until you fix or restore it.</div>
                <div className="row wrap">
                  {REPORT_REASONS.map(r => <button key={r} className="btn btn-sm" onClick={() => onReport(r)}>{FLAG_REASONS[r]}</button>)}
                  <button className="btn btn-sm btn-quiet" onClick={() => setReporting(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

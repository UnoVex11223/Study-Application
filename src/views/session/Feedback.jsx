// After you answer, kept bare: whether you got it, a line on what was missing
// (when you didn't), the model answer, and the rating buttons (Again / Hard /
// Good / Easy, the suggested one preselected: Enter accepts it). A quiet link
// lets you overrule the grade.

import Markdown from "../../ui/Markdown.jsx";
import { Notice } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { VERDICT } from "../../lib/grade.js";
import { RATING_LABEL } from "../../lib/fsrs.js";

export default function Feedback({ grade, verdict, override, onOverride, item, pretest, suggested, onRate, onNext }) {
  const missed = verdict !== "correct";
  return (
    <div className="feedback enter">
      <div className="feedback-body">
        <span className={`verdict ${VERDICT[verdict].tone}`}>{VERDICT[verdict].label}</span>
        {grade.note && <Notice tone="warn" icon="alert">{grade.note}</Notice>}
        {missed && grade.feedback && !override && <p className="muted">{grade.feedback}</p>}
        {grade.source === "tests" && grade.run.output && !grade.run.passed && <pre className="run-output">{grade.run.output}</pre>}
        <div className="quote"><Markdown>{item.answer}</Markdown></div>
        {pretest ? (
          <div><button className="btn btn-primary" onClick={onNext} autoFocus>Next <span className="kbd">↵</span></button></div>
        ) : (
          <div className="rate-row" role="group" aria-label="Rate how well you knew it">
            {[1, 2, 3, 4].map(r => (
              <button key={r} className={cx("rate-btn", r === suggested && "suggested")} onClick={() => onRate(r)}>{RATING_LABEL[r]}</button>
            ))}
          </div>
        )}
        {!pretest && grade.source !== "reveal" && !override && (
          <div className="feedback-links">
            {grade.verdict !== "correct"
              ? <button className="link small" onClick={() => onOverride("correct")}>I was right</button>
              : <button className="link small" onClick={() => onOverride("incorrect")}>Actually, I got this wrong</button>}
          </div>
        )}
      </div>
    </div>
  );
}

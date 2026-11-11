// After you answer: the result, in line under your answer. One row: a small
// status icon and word (never colour alone) with the XP on the left, and
// Continue (Enter) on the right, where Check was. When you missed, the right
// answer follows under a hairline. Tenax grades your answer itself, so it
// schedules the review from the grade too: no rating buttons. A quiet link
// overrules a wrong grade.

import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Notice } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { VERDICT } from "../../lib/grade.js";

const LABEL = { correct: "Correct", partial: "Almost", incorrect: "Not quite", ungraded: "Ungraded" };

export default function Feedback({ grade, verdict, override, onOverride, item, pretest, onContinue, xp = 0 }) {
  const right = verdict === "correct";
  const overrule = !pretest && grade.source !== "reveal" && !override;
  return (
    <div className={cx("result enter", VERDICT[verdict].tone)} role="region" aria-label="How you did">
      <div className="result-head">
        <span className="result-icon" aria-hidden="true"><Icon name={right ? "check" : "x"}/></span>
        <span className="result-verdict">{LABEL[verdict]}</span>
        {xp > 0 && <span className="result-xp num" key={xp}>+{xp} XP</span>}
        <button className="btn btn-primary result-continue" onClick={onContinue} autoFocus>Continue</button>
      </div>
      {grade.note && <Notice tone="warn" icon="alert">{grade.note}</Notice>}
      {grade.source === "tests" && grade.run.output && !grade.run.passed && <pre className="run-output">{grade.run.output}</pre>}
      {!right && (
        <div className="result-answer">
          <div className="result-label">Answer</div>
          <Markdown>{item.answer}</Markdown>
        </div>
      )}
      {overrule && (
        right
          ? <button className="link result-overrule" onClick={() => onOverride("incorrect")}>Actually, I got this wrong</button>
          : <button className="link result-overrule" onClick={() => onOverride("correct")}>I was right</button>
      )}
    </div>
  );
}

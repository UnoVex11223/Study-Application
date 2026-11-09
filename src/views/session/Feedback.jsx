// After you answer: a panel along the bottom of the screen, laid out the way
// well-made quiz apps do it. On the left, a status icon and word (never colour
// alone), and when you missed, the right answer; on the right, one Continue
// button (Enter). Tenax grades your answer itself, so it schedules the review
// from the grade too: no rating buttons. A quiet link overrules a wrong grade.
// The question and your answer stay in view above it; the panel is drawn into
// the session itself (a portal) so the animated column can't carry it along,
// and the session leaves room for it (styles/session.css, --sheet-h).

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Notice } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { VERDICT } from "../../lib/grade.js";

const LABEL = { correct: "Correct", partial: "Almost", incorrect: "Not quite", ungraded: "Ungraded" };

export default function Feedback({ grade, verdict, override, onOverride, item, pretest, onContinue, xp = 0 }) {
  const right = verdict === "correct";
  const tone = VERDICT[verdict].tone;
  const ref = useRef(null);
  const host = typeof document !== "undefined" ? document.querySelector(".session") : null;

  // Tell the session how tall the panel is, so what's above it stays in view.
  useLayoutEffect(() => {
    const el = ref.current, session = el?.closest(".session");
    if (!el || !session) return undefined;
    const set = () => session.style.setProperty("--sheet-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); session.style.removeProperty("--sheet-h"); };
  }, []);

  const overrule = !pretest && grade.source !== "reveal" && !override;
  const sheet = (
    <div className={cx("feedback-sheet", tone)} ref={ref} role="region" aria-label="How you did">
      <div className="feedback-sheet-inner">
        <span className="feedback-icon" aria-hidden="true"><Icon name={right ? "check" : "x"}/></span>
        <div className="feedback-text">
          <div className="feedback-verdict">
            {LABEL[verdict]}
            {xp > 0 && <span className="xp-gain num" key={xp}>+{xp} XP</span>}
          </div>
          {grade.note && <Notice tone="warn" icon="alert">{grade.note}</Notice>}
          {grade.source === "tests" && grade.run.output && !grade.run.passed && <pre className="run-output">{grade.run.output}</pre>}
          {!right && <div className="feedback-answer"><Markdown>{item.answer}</Markdown></div>}
          {overrule && (
            right
              ? <button className="link feedback-overrule" onClick={() => onOverride("incorrect")}>Actually, I got this wrong</button>
              : <button className="link feedback-overrule" onClick={() => onOverride("correct")}>I was right</button>
          )}
        </div>
        <button className="btn btn-primary btn-lg feedback-continue" onClick={onContinue} autoFocus>Continue</button>
      </div>
    </div>
  );
  return host ? createPortal(sheet, host) : sheet;
}

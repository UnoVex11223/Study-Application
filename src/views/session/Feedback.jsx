// After you answer: a panel that slides up from the bottom of the screen,
// tinted by how it went, so the question and your answer stay where they
// were above it. Inside: the verdict (and the XP it earned), a line on what
// was missing when you missed it, the answer, and the four ratings with the
// suggested one in gold (Enter accepts it). A quiet link overrules the grade.
// It is drawn into the session itself (a portal), since the animated column
// it belongs to would otherwise carry it along; the session leaves room for
// it (styles/session.css, --sheet-h).

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Markdown from "../../ui/Markdown.jsx";
import { Notice } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { VERDICT } from "../../lib/grade.js";
import { RATING_LABEL } from "../../lib/fsrs.js";

export default function Feedback({ grade, verdict, override, onOverride, item, pretest, suggested, onRate, onNext, xp = 0 }) {
  const missed = verdict !== "correct";
  const tone = VERDICT[verdict].tone;
  const ref = useRef(null);
  const host = typeof document !== "undefined" ? document.querySelector(".session") : null;

  // Tell the session how tall the panel is, so what's above it stays in view.
  useLayoutEffect(() => {
    const el = ref.current, host = el?.closest(".session");
    if (!el || !host) return undefined;
    const set = () => host.style.setProperty("--sheet-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); host.style.removeProperty("--sheet-h"); };
  }, []);

  const sheet = (
    <div className={cx("feedback-sheet", tone)} ref={ref} role="region" aria-label="How you did">
      <div className="feedback-sheet-inner">
        <div className="verdict-row">
          <span className={`verdict ${tone}`}>{VERDICT[verdict].label}</span>
          {xp > 0 && <span className="xp-gain num" key={xp}>+{xp} XP</span>}
          <span className="grow"/>
          {!pretest && grade.source !== "reveal" && !override && (
            grade.verdict !== "correct"
              ? <button className="link small" onClick={() => onOverride("correct")}>I was right</button>
              : <button className="link small" onClick={() => onOverride("incorrect")}>Actually, I got this wrong</button>
          )}
        </div>
        {grade.note && <Notice tone="warn" icon="alert">{grade.note}</Notice>}
        {missed && grade.feedback && !override && <p className="feedback-why">{grade.feedback}</p>}
        {grade.source === "tests" && grade.run.output && !grade.run.passed && <pre className="run-output">{grade.run.output}</pre>}
        <div className="feedback-answer">
          <div className="feedback-caption">Answer</div>
          <Markdown>{item.answer}</Markdown>
        </div>
        {pretest ? (
          <div><button className="btn btn-primary" onClick={onNext} autoFocus>Next</button></div>
        ) : (
          <div className="rate-row" role="group" aria-label="Rate how well you knew it">
            {[1, 2, 3, 4].map(r => (
              <button key={r} className={cx("rate-btn", r === suggested && "suggested")} onClick={() => onRate(r)}>{RATING_LABEL[r]}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  return host ? createPortal(sheet, host) : sheet;
}

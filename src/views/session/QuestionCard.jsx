// The question being asked, and nothing else: the question itself (with its
// diagram), and a flag for reporting a bad question that only shows when you
// point at the card (on a fresh version, it offers the original instead; in
// the mastery test there's no flag).

import { useState } from "react";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import Diagram from "../../ui/Diagram.jsx";
import { cx } from "../../ui/cx.js";
import { FLAG_REASONS } from "../../lib/quality.js";

const REPORT_REASONS = ["unclear", "wrong", "trivial", "other"];

export default function QuestionCard({ item, fresh, canUseOriginal, onUseOriginal, onReport, flag = true }) {
  const [reporting, setReporting] = useState(false);
  return (
    <article className="q-card">
      {flag && <button className={cx("btn btn-quiet btn-sm btn-icon q-flag", reporting && "on")} onClick={() => setReporting(r => !r)}
        title="Report this question" aria-label="Report this question" aria-expanded={reporting}>
        <Icon name="flag"/>
      </button>}
      <div className="q-prompt"><Markdown>{item.prompt}</Markdown></div>
      {item.diagram && <Diagram spec={item.diagram}/>}
      {reporting && (
        <div className="report-box stack gap-2 enter">
          {fresh ? (
            <div className="row wrap">
              {canUseOriginal && <button className="btn btn-sm" onClick={() => { onUseOriginal(); setReporting(false); }}>Use the original question</button>}
              <button className="btn btn-sm btn-quiet" onClick={() => setReporting(false)}>Cancel</button>
            </div>
          ) : (
            <div className="row wrap">
              {REPORT_REASONS.map(r => <button key={r} className="btn btn-sm" onClick={() => onReport(r)}>{FLAG_REASONS[r]}</button>)}
              <button className="btn btn-sm btn-quiet" onClick={() => setReporting(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

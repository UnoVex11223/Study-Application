// What a finished session (or pretest) did, in a line, and the button to finish.

import { plural } from "../../lib/format.js";

export function PretestSummary({ summary, onDone }) {
  return (
    <div className="stack gap-6 enter session-done">
      <h2 className="session-done-title">Pretest done</h2>
      <p className="muted">{summary.unaided} of {summary.count} right before studying. Nothing was scheduled.</p>
      <div className="row"><button className="btn btn-primary btn-lg" onClick={onDone} autoFocus>Done</button></div>
    </div>
  );
}

export function SessionSummary({ summary, more, onDone, onMore }) {
  const s = summary;
  return (
    <div className="stack gap-6 enter session-done">
      <h2 className="session-done-title">Done</h2>
      <p className="muted">
        {s.count ? `${s.unaided} of ${plural(s.count, "question")} right` : "Nothing was answered this time"}
        {s.steps > 0 ? `, ${plural(s.steps, "step")} climbed.` : "."}
      </p>
      <div className="row">
        <button className="btn btn-primary btn-lg" onClick={onDone} autoFocus>Close</button>
        {more > 0 && <button className="btn btn-quiet btn-lg" onClick={onMore}>{more} more</button>}
      </div>
    </div>
  );
}

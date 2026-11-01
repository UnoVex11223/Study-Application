// What a finished session (or pretest) did: the numbers, what's coming back,
// what you got back, and the button to finish.

import { Figures, Figure } from "../../ui/display.jsx";
import { MISS_REASONS } from "../../lib/training.js";
import { plural, pct } from "../../lib/format.js";

const names = (concepts) => concepts.map(c => c.name).join(", ");

export function PretestSummary({ summary, onDone }) {
  return (
    <div className="stack gap-6 enter">
      <article className="result">
        <div className="result-label">Pretest done</div>
        <p className="result-text">
          {summary.unaided} of {summary.count} right before studying. Getting them wrong is fine: trying first makes the material stick better when you read it.
        </p>
        <p className="muted small">Nothing was scheduled. These ideas come up in your sessions once you've added or read the chapter, like any new material.</p>
      </article>
      <div className="row"><button className="btn btn-primary btn-lg" onClick={onDone} autoFocus>Done</button></div>
    </div>
  );
}

export function SessionSummary({ summary, more, onDone, onMore }) {
  const s = summary;
  const deepest = s.deeper.length ? Math.max(...s.deeper.map(r => r.probe.depth)) : 0;
  return (
    <div className="stack gap-6 enter">
      <article className="result">
        <div className="result-label">Session complete</div>
        <Figures three>
          <Figure value={s.count} label="questions"/>
          <Figure value={s.count ? pct(s.unaided / s.count) : "0%"} label="right first time, no help"/>
          <Figure value={s.started.length} label="new concepts started"/>
        </Figures>
        <div className="stack gap-2">
          {s.recovered.length > 0 && <p><strong>Recovered:</strong> {names(s.recovered)}. These had slipped before and you got them back.</p>}
          {s.missed.length > 0 && <p><strong>Coming back soon:</strong> {names(s.missed)}.</p>}
          {s.sureMissed.length > 0 && <p><strong>You were sure about:</strong> {names(s.sureMissed)}. Confident mistakes are worth a second look.</p>}
          {s.strengthened.length > 0 && <p className="muted">Also reviewed along the way: {names(s.strengthened)}, through answers that built on them.</p>}
          {Object.keys(s.reasons).length > 0 && (
            <p className="muted small">Why you missed: {Object.entries(s.reasons).map(([k, n]) => `${n} ${MISS_REASONS[k]?.label.toLowerCase() ?? k}`).join(", ")}.</p>
          )}
          {s.deeper.length > 0 && <p className="muted small">Went deeper {plural(s.deeper.length, "time")}: held up through {plural(deepest, "follow-up")} at most.</p>}
          {s.reported > 0 && <p className="muted">{plural(s.reported, "reported question is", "reported questions are")} waiting on Today to be fixed or restored.</p>}
          {s.count === 0 && !s.reported && <p className="muted">Nothing was answered this time.</p>}
        </div>
      </article>
      <div className="row">
        <button className="btn btn-primary btn-lg" onClick={onDone} autoFocus>Done</button>
        {more > 0 && <button className="btn btn-lg" onClick={onMore}>{more} more</button>}
      </div>
    </div>
  );
}

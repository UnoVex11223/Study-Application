// After you answer: the verdict, which key points you made, the model answer
// and the source, why you missed it (optional), Go deeper, and the rating
// buttons (Again / Hard / Good / Easy, the suggested one preselected).

import Markdown from "../../ui/Markdown.jsx";
import { Segmented } from "../../ui/controls.jsx";
import { Notice, CheckMark } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { VERDICT } from "../../lib/grade.js";
import { RATING_LABEL } from "../../lib/fsrs.js";
import { MISS_REASONS } from "../../lib/training.js";
import { plural } from "../../lib/format.js";
import GoDeeper from "./GoDeeper.jsx";

const REASON_OPTIONS = Object.entries(MISS_REASONS).map(([k, r]) => [k, r.label, r.blurb]);

/** How the answer was checked, said at the right of the verdict. */
function gradedBy(grade) {
  if (grade.source === "ai") return `Graded against ${plural(grade.points.length, "key point")}`;
  if (grade.source === "exact") return "Matched an accepted answer";
  if (grade.source === "tests") return grade.run.passed ? "All tests passed" : grade.run.timedOut ? "Timed out" : grade.run.stage === "build" ? "Didn't compile" : "A test failed";
  return "";
}

export default function Feedback({
  grade, verdict, override, onOverride, aided, slow, sure, item, concept, course, answer, pretest,
  reason, onReason, suggested, intervals, onRate, onNext, canDeeper, deeper, onDeeper, onProbe,
}) {
  const missed = verdict !== "correct";
  const confidentMiss = sure && missed;
  const showPoints = grade.source !== "exact" && grade.source !== "reveal" && grade.source !== "tests";
  return (
    <div className="feedback enter">
      <div className="feedback-head">
        <span className={`verdict ${VERDICT[verdict].tone}`}>{VERDICT[verdict].label}</span>
        {aided && verdict === "correct" && <span className="tag">With help</span>}
        {slow && <span className="tag" title="Right, but much slower than you usually are on this kind of question. It isn't automatic yet, so Hard is suggested.">Slow</span>}
        {confidentMiss && <span className="tag warn">You were sure</span>}
        {override && <span className="tag">{override === "correct" ? "Marked correct by you" : "Marked wrong by you"}</span>}
        <span className="grow"/>
        <span className="muted small">{gradedBy(grade)}</span>
      </div>

      <div className="feedback-body">
        {grade.note && <Notice tone="warn" icon="alert">{grade.note}</Notice>}
        {pretest && <p className="small muted">A pretest: getting it wrong is the point. Trying first makes the chapter stick better when you read it.</p>}
        {confidentMiss && <p className="small">You were sure, so read the model answer closely. A mistake you were confident about tends to stick once it's corrected.</p>}
        {grade.feedback && missed && <p>{grade.feedback}</p>}

        {grade.source === "tests" && grade.run.output && (
          <div className="stack gap-2">
            <div className="caption">{grade.run.passed ? "Output" : grade.run.stage === "build" ? "Compiler output" : "What the tests reported"}</div>
            <pre className="run-output">{grade.run.output}</pre>
          </div>
        )}
        {showPoints && (
          <div className="checks">
            {grade.points.map((p, i) => {
              const met = p.met || override === "correct";
              return (
                <div key={i} className="check">
                  <CheckMark tone={met ? "yes" : "no"}/>
                  <div className="grow">
                    <Markdown>{p.text}</Markdown>
                    {p.evidence && p.met && <div className="check-evidence">You wrote: “{p.evidence}”</div>}
                    {p.corrected && <div className="check-evidence">{p.corrected}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {override !== "correct" && grade.misconceptionsFound.map((m, i) => (
          <div key={i} className="misconception"><strong>Misconception:</strong> {m}</div>
        ))}

        <div className="stack gap-2">
          <div className="caption">{verdict === "correct" ? "Model answer, for comparison" : "Model answer"}</div>
          <div className="quote"><Markdown>{item.answer}</Markdown></div>
        </div>
        {concept.source?.excerpt && (
          <div className="stack gap-2">
            <div className="caption">From your source{concept.source.location ? `, ${concept.source.location}` : ""}</div>
            <div className="quote source">{concept.source.excerpt}</div>
          </div>
        )}

        {missed && !pretest && (
          <div className="stack gap-2">
            <div className="caption">Why did you miss it? <span className="muted">Optional</span></div>
            <Segmented label="Why you missed it" size="sm" options={REASON_OPTIONS} value={reason} onChange={(k) => onReason(reason === k ? null : k)}/>
            {reason === "unlearned" && concept.summary && (
              <div className="relearn stack gap-2 small">
                <div className="caption">The idea</div>
                <Markdown>{concept.summary}</Markdown>
                <div className="muted">Reviewing can't fix something you never learned. Go back to the source for this one; it comes back shortly to check.</div>
              </div>
            )}
          </div>
        )}

        {deeper && <GoDeeper item={item} concept={concept} course={course} answer={answer} onResult={onProbe}/>}

        {pretest ? (
          <div><button className="btn btn-primary" onClick={onNext} autoFocus>Next <span className="kbd">↵</span></button></div>
        ) : (
          <div className="rate-row" role="group" aria-label="Rate how well you knew it">
            {[1, 2, 3, 4].map(r => (
              <button key={r} className={cx("rate-btn", r === suggested && "suggested")} onClick={() => onRate(r)}>
                {RATING_LABEL[r]}<span className="ivl">{intervals[r]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!pretest && (
        <div className="feedback-foot">
          {canDeeper && !deeper && (
            <button className="link small" onClick={onDeeper} title="Follow-up questions, one level deeper each time, until an answer breaks">Go deeper</button>
          )}
          <span className="grow"/>
          {grade.verdict !== "correct" && grade.source !== "reveal" && !override && <button className="link small" onClick={() => onOverride("correct")}>I was right</button>}
          {grade.verdict === "correct" && !override && <button className="link small" onClick={() => onOverride("incorrect")}>Actually, I got this wrong</button>}
        </div>
      )}
    </div>
  );
}

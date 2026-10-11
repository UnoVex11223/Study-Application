// One practice task: answer from memory → graded against the rubric → rate.

import { useEffect, useRef, useState } from "react";
import Markdown from "../ui/Markdown.jsx";
import Icon from "../ui/Icon.jsx";
import { Spinner, Notice } from "../ui/ui.jsx";
import { useKey, isTyping, abilityLabel, useNav } from "../ui/nav.js";
import { matchesAccepted, verdictFromChecks, suggestedRating, VERDICT } from "../lib/grade.js";
import { gradeWithAI, rubricFor } from "../lib/ai.js";
import { previewIntervals, RATING_LABEL } from "../lib/fsrs.js";
import { FLAG_REASONS } from "../lib/quality.js";
import { play } from "../ui/sound.js";

const KIND_LABEL = {
  new: "New concept",
  learning: "Relearning",
  review: "Review",
  foundation: "Foundation check",
  practice: "Practice",
  requeue: "One more try",
};

export default function TaskView({ task, item, concept, section, course, aiReady, retention, onDone, onReport }) {
  const [phase, setPhase] = useState("answer"); // answer | grading | followup | selfcheck | feedback
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [grade, setGrade] = useState(null);
  const [followUp, setFollowUp] = useState({ question: "", answer: "" });
  const [checks, setChecks] = useState({ points: [], misc: [] });
  const [error, setError] = useState("");
  const [override, setOverride] = useState(null); // you can overrule the grade either way: "correct" | "incorrect"
  const [reporting, setReporting] = useState(false);
  const started = useRef(0);
  const finished = useRef(false);
  const answerRef = useRef(null);
  const { now } = useNav();

  useEffect(() => { started.current = Date.now(); answerRef.current?.focus(); }, []);

  const points = rubricFor(item);
  const aided = hint || gaveUp;

  const finishWith = (g) => { setGrade(g); setPhase("feedback"); if (g.verdict === "correct") play("correct"); };

  const selfCheck = (reason = "") => {
    setChecks({ points: points.map(() => false), misc: (item.misconceptions || []).map(() => false) });
    setError(reason);
    setPhase("selfcheck");
  };

  const submit = async (fu = null) => {
    if (phase !== "answer" && phase !== "followup") return;
    if (!answer.trim()) return;
    if (!fu && item.accept?.length && matchesAccepted(answer, item.accept)) {
      return finishWith({ verdict: "correct", source: "exact", points: points.map(text => ({ text, met: true })), misconceptionsFound: [], feedback: "" });
    }
    if (!aiReady) return selfCheck();
    setPhase("grading");
    const res = await gradeWithAI(item, concept, answer, fu);
    if (!res.ok) return selfCheck(`Automatic grading failed (${res.error}). Check your answer yourself.`);
    if (res.uncertain && res.followUp) {
      setFollowUp({ question: res.followUp, answer: "" });
      setPhase("followup");
      return;
    }
    const verdict = verdictFromChecks(res.points.map(p => p.met), res.misconceptionsFound.length);
    finishWith({ verdict, source: "ai", points: res.points, misconceptionsFound: res.misconceptionsFound, feedback: res.feedback });
  };

  const giveUp = () => {
    setGaveUp(true);
    finishWith({ verdict: "incorrect", source: "reveal", points: points.map(text => ({ text, met: false })), misconceptionsFound: [], feedback: "" });
  };

  const saveSelfCheck = () => {
    const found = (item.misconceptions || []).filter((_, i) => checks.misc[i]);
    finishWith({
      verdict: verdictFromChecks(checks.points, found.length), source: "self",
      points: points.map((text, i) => ({ text, met: checks.points[i] })), misconceptionsFound: found, feedback: "",
    });
  };

  const verdict = grade ? (override ?? grade.verdict) : null;
  const suggested = verdict ? suggestedRating(verdict, { aided }) : null;
  const ivls = previewIntervals(concept.srs, now, { retention });

  const rate = (rating) => {
    if (finished.current) return; // Enter on a focused button must not rate twice
    finished.current = true;
    onDone({
      verdict, rating, aided, overridden: Boolean(override),
      ms: Date.now() - started.current,
      misconceptions: override === "correct" ? [] : grade.misconceptionsFound,
    });
  };

  useKey((e) => {
    if (phase === "answer" && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
    else if (phase === "followup" && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (followUp.answer.trim()) submit(followUp); }
    else if (phase === "feedback" && !isTyping(e) && e.target?.tagName !== "BUTTON") {
      if (e.key === "Enter") { e.preventDefault(); rate(suggested); }
      else if (["1", "2", "3", "4"].includes(e.key)) rate(Number(e.key));
    }
  }, [phase, answer, followUp, suggested, grade, override, aided]);

  const kind = task.kind === "requeue" ? "requeue" : task.kind;

  return (
    <div className="enter">
      <div className="session-kind">
        <span>{KIND_LABEL[kind] ?? "Review"}</span>
        {concept.importance === "core" && <span className="tag tag-core">Core</span>}
      </div>

      <article className="q-card">
        <div className="q-head">
          <span className="q-ability">{abilityLabel(item.ability)}</span>
          <span className="dot" style={{ background: course?.color }}/>
          <span className="q-context grow">{course?.name}{section ? ` / ${section.title}` : ""}</span>
          <button className={`q-flag${reporting ? " on" : ""}`} onClick={() => setReporting(r => !r)} title="Report this question" aria-label="Report this question" aria-expanded={reporting}>
            <Icon name="flag" size={15}/>
          </button>
        </div>
        <div className="q-prompt"><Markdown>{item.prompt}</Markdown></div>
        {reporting && (
          <div className="report-box enter">
            <div className="small" style={{ marginBottom: 8 }}>What's wrong with this question? It will be taken out of your sessions until you fix or restore it.</div>
            <div className="row-wrap">
              {["unclear", "wrong", "trivial", "other"].map(r => (
                <button key={r} className="btn btn-sm" onClick={() => onReport(r)}>{FLAG_REASONS[r]}</button>
              ))}
              <button className="btn btn-sm btn-quiet" onClick={() => setReporting(false)}>Cancel</button>
            </div>
          </div>
        )}
      </article>

      <div className="answer-area">
        <textarea
          ref={answerRef} className="answer-box" value={answer} onChange={e => setAnswer(e.target.value)}
          disabled={phase !== "answer"} aria-label="Your answer"
        />
        {hint && item.hint && <div className="hint-box"><Markdown>{item.hint}</Markdown></div>}
        {phase === "answer" && (
          <div className="answer-actions">
            <button className="btn btn-primary" onClick={() => submit()} disabled={!answer.trim()}>
              Check answer <span className="kbd">Ctrl ↵</span>
            </button>
            <div className="grow"/>
            {item.hint && !hint && <button className="btn btn-quiet" onClick={() => setHint(true)}><Icon name="bulb" size={16}/>Hint</button>}
            <button className="btn btn-quiet" onClick={giveUp}>I don't know</button>
          </div>
        )}
        {phase === "grading" && <div className="answer-actions muted"><Spinner/>Checking against the key points…</div>}
      </div>

      {phase === "followup" && (
        <div className="feedback enter">
          <div className="feedback-body">
            <div className="sub-label">One quick follow-up to be sure</div>
            <Markdown>{followUp.question}</Markdown>
            <textarea className="answer-box" style={{ minHeight: 80 }} autoFocus value={followUp.answer}
              onChange={e => setFollowUp(f => ({ ...f, answer: e.target.value }))} aria-label="Follow-up answer"/>
            <div className="row">
              <button className="btn btn-primary" disabled={!followUp.answer.trim()} onClick={() => submit(followUp)}>Submit <span className="kbd">Ctrl ↵</span></button>
              <button className="btn btn-quiet" onClick={() => selfCheck()}>Check it myself instead</button>
            </div>
          </div>
        </div>
      )}

      {phase === "selfcheck" && (
        <div className="feedback enter">
          <div className="feedback-body">
            {error && <Notice tone="warn" icon="alert">{error}</Notice>}
            <div>
              <div className="sub-label">Model answer</div>
              <div className="model-answer"><Markdown>{item.answer}</Markdown></div>
            </div>
            <div>
              <div className="sub-label">Tick each key point your answer covered</div>
              <div className="checks">
                {points.map((p, i) => (
                  <label key={i} className="check selfcheck-row">
                    <button type="button" className={`check-mark box${checks.points[i] ? " on" : ""}`} aria-pressed={checks.points[i]}
                      onClick={() => setChecks(c => ({ ...c, points: c.points.map((v, j) => (j === i ? !v : v)) }))}>
                      {checks.points[i] && <Icon name="check" size={12} stroke={3}/>}
                    </button>
                    <Markdown>{p}</Markdown>
                  </label>
                ))}
              </div>
            </div>
            {item.misconceptions?.length > 0 && (
              <div>
                <div className="sub-label">Tick any of these you said</div>
                <div className="checks">
                  {item.misconceptions.map((m, i) => (
                    <label key={i} className="check selfcheck-row">
                      <button type="button" className={`check-mark box${checks.misc[i] ? " on-bad" : ""}`} aria-pressed={checks.misc[i]}
                        onClick={() => setChecks(c => ({ ...c, misc: c.misc.map((v, j) => (j === i ? !v : v)) }))}>
                        {checks.misc[i] && <Icon name="x" size={12} stroke={3}/>}
                      </button>
                      <Markdown>{m}</Markdown>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div><button className="btn btn-primary" onClick={saveSelfCheck}>Save check</button></div>
          </div>
        </div>
      )}

      {phase === "feedback" && grade && (
        <div className="feedback enter">
          <div className="feedback-head">
            <span className={`verdict verdict-${VERDICT[verdict].tone}`}>{VERDICT[verdict].label}</span>
            {aided && verdict === "correct" && <span className="tag">With help</span>}
            {override && <span className="tag">{override === "correct" ? "Marked correct by you" : "Marked wrong by you"}</span>}
            <div className="grow"/>
            {grade.source === "ai" && <span className="muted small">Graded against {grade.points.length} key point{grade.points.length === 1 ? "" : "s"}</span>}
            {grade.source === "exact" && <span className="muted small">Matched an accepted answer</span>}
          </div>
          <div className="feedback-body">
            {grade.feedback && verdict !== "correct" && <div>{grade.feedback}</div>}
            {grade.source !== "exact" && grade.source !== "reveal" && (
              <div className="checks">
                {grade.points.map((p, i) => (
                  <div key={i} className="check">
                    <span className={`check-mark ${p.met || override === "correct" ? "yes" : "no"}`}><Icon name={p.met || override === "correct" ? "check" : "x"} size={12} stroke={2.6}/></span>
                    <div className="grow">
                      <Markdown>{p.text}</Markdown>
                      {p.evidence && p.met && <div className="check-evidence">You wrote: “{p.evidence}”</div>}
                      {p.corrected && <div className="check-evidence">{p.corrected}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {override !== "correct" && grade.misconceptionsFound.map((m, i) => (
              <div key={i} className="misconception"><strong>Misconception:</strong> {m}</div>
            ))}
            <div>
              <div className="sub-label">{verdict === "correct" ? "Model answer, for comparison" : "Model answer"}</div>
              <div className="model-answer"><Markdown>{item.answer}</Markdown></div>
            </div>
            {concept.source?.excerpt && (
              <div>
                <div className="sub-label">From your source{concept.source.location ? `, ${concept.source.location}` : ""}</div>
                <div className="source-quote">{concept.source.excerpt}</div>
              </div>
            )}
            <div className="rate-row" role="group" aria-label="Rate how well you knew it">
              {[1, 2, 3, 4].map(r => (
                <button key={r} className={`rate-btn${r === suggested ? " suggested" : ""}`} onClick={() => rate(r)}>
                  {RATING_LABEL[r]}<span className="ivl">{ivls[r]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="feedback-foot small muted">
            <span className="grow"/>
            {grade.verdict !== "correct" && grade.source !== "reveal" && !override && (
              <button className="link small" onClick={() => setOverride("correct")}>I was right</button>
            )}
            {grade.verdict === "correct" && !override && (
              <button className="link small" onClick={() => setOverride("incorrect")}>Actually, I got this wrong</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

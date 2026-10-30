// One practice task: answer from memory → graded against the rubric (or by
// running its tests) → rate.
//
// Around that core, a few things that make practice harder in the useful way:
//  - "I'm sure": say so before checking; a confident miss gets flagged, since
//    correcting a mistake you were sure of is when it sticks best.
//  - Pace: a right answer that took far longer than usual isn't fluent yet, so
//    Hard is suggested instead of Good.
//  - Why you missed it: optional, and each reason has its own fix.
//  - Go deeper: an interviewer's follow-ups until an answer breaks.
//  - Fresh versions: an apply question you've seen comes back with a new example.

import { useEffect, useRef, useState } from "react";
import Markdown from "../ui/Markdown.jsx";
import Icon from "../ui/Icon.jsx";
import { Spinner, Notice } from "../ui/ui.jsx";
import { useKey, isTyping, abilityLabel, useNav } from "../ui/nav.js";
import { matchesAccepted, verdictFromChecks, suggestedRating, VERDICT } from "../lib/grade.js";
import { gradeWithAI, rubricFor } from "../lib/ai.js";
import { previewIntervals, RATING_LABEL } from "../lib/fsrs.js";
import { FLAG_REASONS } from "../lib/quality.js";
import { isSlow, MISS_REASONS } from "../lib/training.js";
import { hasTests, runCode, CODE_LANGS } from "../lib/code.js";
import { play } from "../ui/sound.js";
import { courseInk } from "../lib/model.js";
import GoDeeper from "./GoDeeper.jsx";

const KIND_LABEL = {
  new: "New concept",
  learning: "Relearning",
  review: "Review",
  foundation: "Foundation check",
  practice: "Practice",
  requeue: "One more try",
  pretest: "Pretest",
};

export default function TaskView({ task, item: stored, concept, section, course, aiReady, retention, pace = null, variant = null, pretest = false, onDone, onReport }) {
  const [phase, setPhase] = useState("answer"); // answer | grading | running | followup | selfcheck | feedback
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [sure, setSure] = useState(false);
  const [grade, setGrade] = useState(null);
  const [followUp, setFollowUp] = useState({ question: "", answer: "" });
  const [checks, setChecks] = useState({ points: [], misc: [] });
  const [error, setError] = useState("");
  const [override, setOverride] = useState(null); // you can overrule the grade either way: "correct" | "incorrect"
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState(null); // why you missed it
  const [deeper, setDeeper] = useState(false);
  const [probe, setProbe] = useState(null);
  // A fresh version is decided when the question appears and never swapped mid-answer.
  const [fresh, setFresh] = useState(variant);
  const started = useRef(0);
  const [took, setTook] = useState(0); // time to your answer, before any grading
  const finished = useRef(false);
  const answerRef = useRef(null);
  const { now } = useNav();

  useEffect(() => { started.current = Date.now(); answerRef.current?.focus(); }, []);

  const item = fresh ? { ...stored, ...fresh, accept: [] } : stored;
  const points = rubricFor(item);
  const aided = hint || gaveUp;
  const code = hasTests(stored) ? stored.tests : null;

  const stamp = () => { const t = Date.now() - started.current; setTook(v => v || t); };
  const finishWith = (g) => {
    setGrade(g); setPhase("feedback");
    if (g.verdict === "correct") play("correct");
    else if (g.misconceptionsFound?.length) setReason("misconception");
  };

  const selfCheck = (why = "") => {
    setChecks({ points: points.map(() => false), misc: (item.misconceptions || []).map(() => false) });
    setError(why);
    setPhase("selfcheck");
  };

  const grader = async (fu, note = "") => {
    if (!aiReady) return selfCheck(note);
    setPhase("grading");
    const res = await gradeWithAI(item, concept, answer, fu);
    if (!res.ok) return selfCheck(`Automatic grading failed (${res.error}). Check your answer yourself.`);
    if (res.uncertain && res.followUp) {
      setFollowUp({ question: res.followUp, answer: "" });
      setPhase("followup");
      return;
    }
    const verdict = verdictFromChecks(res.points.map(p => p.met), res.misconceptionsFound.length);
    finishWith({ verdict, source: "ai", points: res.points, misconceptionsFound: res.misconceptionsFound, feedback: res.feedback, note });
  };

  const submit = async (fu = null) => {
    if (phase !== "answer" && phase !== "followup") return;
    if (!answer.trim()) return;
    stamp();
    let note = "";
    if (!fu && code) {
      setPhase("running");
      const run = await runCode({ lang: code.lang, solution: answer, tests: code.code });
      if (run.ok) {
        return finishWith({ verdict: run.passed ? "correct" : "incorrect", source: "tests", points: [], misconceptionsFound: [], feedback: "", run });
      }
      // Can't run here (no Python or compiler): grade against the key points instead.
      note = `Couldn't run the tests: ${run.error} Graded against the key points instead.`;
    }
    if (!fu && item.accept?.length && matchesAccepted(answer, item.accept)) {
      return finishWith({ verdict: "correct", source: "exact", points: points.map(text => ({ text, met: true })), misconceptionsFound: [], feedback: "" });
    }
    return grader(fu, note);
  };

  const giveUp = () => {
    stamp();
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
  const missed = verdict != null && verdict !== "correct";
  const slow = verdict === "correct" && !aided && !override && isSlow(took, stored.ability, pace);
  const suggested = verdict ? suggestedRating(verdict, { aided, slow, reason: missed ? reason : null }) : null;
  const ivls = previewIntervals(concept.srs, now, { retention });

  const rate = (rating) => {
    if (finished.current) return; // Enter on a focused button must not rate twice
    finished.current = true;
    onDone({
      verdict, rating, aided, overridden: Boolean(override),
      ms: Date.now() - started.current, answerMs: took,
      misconceptions: override === "correct" ? [] : grade.misconceptionsFound,
      sure, slow, reason: missed ? reason : null, variant: Boolean(fresh),
      tests: grade.source === "tests" ? (grade.run.passed ? "passed" : "failed") : null,
      probe,
    });
  };
  // A pretest isn't rated: it's asked before you've studied the material.
  const next = () => {
    if (finished.current) return;
    finished.current = true;
    onDone({ verdict, rating: null, aided, sure, ms: Date.now() - started.current, answerMs: took });
  };

  useKey((e) => {
    if (phase === "answer" && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) setSure(true);
      submit();
    }
    else if (phase === "followup" && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (followUp.answer.trim()) submit(followUp); }
    else if (phase === "feedback" && !isTyping(e) && e.target?.tagName !== "BUTTON") {
      if (e.key === "Enter") { e.preventDefault(); if (pretest) next(); else rate(suggested); }
      else if (!pretest && ["1", "2", "3", "4"].includes(e.key)) rate(Number(e.key));
    }
  }, [phase, answer, followUp, suggested, grade, override, aided, sure, reason, probe, pretest, took]);

  const kind = task.kind === "requeue" ? "requeue" : task.kind;
  const confidentMiss = sure && missed;
  const canDeeper = aiReady && !pretest && (verdict === "correct" || verdict === "partial");

  return (
    <div className="enter">
      <div className="session-kind">
        <span>{KIND_LABEL[kind] ?? "Review"}</span>
        {concept.importance === "core" && <span className="tag tag-core">Core</span>}
        {fresh && <span className="tag" title="A new example of a question you've answered before, written for today">Fresh version</span>}
      </div>

      <article className="q-card">
        <div className="q-head">
          <span className="q-ability">{abilityLabel(item.ability)}</span>
          <span className="dot" style={{ background: courseInk(course?.color) }}/>
          <span className="q-context grow">{course?.name}{section ? ` / ${section.title}` : ""}</span>
          <button className={`q-flag${reporting ? " on" : ""}`} onClick={() => setReporting(r => !r)} title="Report this question" aria-label="Report this question" aria-expanded={reporting}>
            <Icon name="flag" size={15}/>
          </button>
        </div>
        <div className="q-prompt"><Markdown>{item.prompt}</Markdown></div>
        {code && <div className="small muted" style={{ marginTop: 10 }}>{CODE_LANGS[code.lang].label} · checked by running its tests</div>}
        {reporting && (
          <div className="report-box enter">
            {fresh ? (
              <>
                <div className="small" style={{ marginBottom: 8 }}>This is a fresh version written for today, so it won't come back.</div>
                <div className="row-wrap">
                  {phase === "answer" && <button className="btn btn-sm" onClick={() => { setFresh(null); setReporting(false); }}>Use the original question</button>}
                  <button className="btn btn-sm btn-quiet" onClick={() => setReporting(false)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="small" style={{ marginBottom: 8 }}>What's wrong with this question? It will be taken out of your sessions until you fix or restore it.</div>
                <div className="row-wrap">
                  {["unclear", "wrong", "trivial", "other"].map(r => (
                    <button key={r} className="btn btn-sm" onClick={() => onReport(r)}>{FLAG_REASONS[r]}</button>
                  ))}
                  <button className="btn btn-sm btn-quiet" onClick={() => setReporting(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}
      </article>

      <div className="answer-area">
        <textarea
          ref={answerRef} className={`answer-box${code ? " answer-code" : ""}`} value={answer} onChange={e => setAnswer(e.target.value)}
          disabled={phase !== "answer"} aria-label="Your answer" spellCheck={!code}
          onKeyDown={code ? (e) => {
            // Tab indents in a code answer instead of leaving the box.
            if (e.key !== "Tab" || e.shiftKey) return;
            e.preventDefault();
            const el = e.currentTarget, at = el.selectionStart;
            setAnswer(v => `${v.slice(0, at)}    ${v.slice(el.selectionEnd)}`);
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = at + 4; });
          } : undefined}
        />
        {hint && item.hint && <div className="hint-box"><Markdown>{item.hint}</Markdown></div>}
        {phase === "answer" && (
          <div className="answer-actions">
            <button className="btn btn-primary" onClick={() => submit()} disabled={!answer.trim()}>
              {code ? "Run tests" : "Check answer"} <span className="kbd">Ctrl ↵</span>
            </button>
            {!pretest && (
              <button className={`btn btn-quiet sure-toggle${sure ? " on" : ""}`} aria-pressed={sure} onClick={() => setSure(v => !v)}
                title="Say so before checking when you're confident. A confident miss is the most useful kind to catch. (Ctrl+Shift+Enter checks as sure.)">
                <span className="sure-box">{sure && <Icon name="check" size={11} stroke={3}/>}</span>I'm sure
              </button>
            )}
            <div className="grow"/>
            {item.hint && !hint && <button className="btn btn-quiet" onClick={() => setHint(true)}><Icon name="bulb" size={16}/>Hint</button>}
            <button className="btn btn-quiet" onClick={giveUp}>I don't know</button>
          </div>
        )}
        {phase === "grading" && <div className="answer-actions muted"><Spinner/>Checking against the key points…</div>}
        {phase === "running" && <div className="answer-actions muted"><Spinner/>Running the tests…</div>}
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
            {slow && <span className="tag" title="Right, but much slower than you usually are on this kind of question. It isn't automatic yet, so Hard is suggested.">Slow</span>}
            {confidentMiss && <span className="tag tag-warn">You were sure</span>}
            {override && <span className="tag">{override === "correct" ? "Marked correct by you" : "Marked wrong by you"}</span>}
            <div className="grow"/>
            {grade.source === "ai" && <span className="muted small">Graded against {grade.points.length} key point{grade.points.length === 1 ? "" : "s"}</span>}
            {grade.source === "exact" && <span className="muted small">Matched an accepted answer</span>}
            {grade.source === "tests" && <span className="muted small">{grade.run.passed ? "All tests passed" : grade.run.timedOut ? "Timed out" : grade.run.stage === "build" ? "Didn't compile" : "A test failed"}</span>}
          </div>
          <div className="feedback-body">
            {grade.note && <Notice tone="warn" icon="alert">{grade.note}</Notice>}
            {pretest && <div className="small muted">A pretest: getting it wrong is the point. Trying first makes the chapter stick better when you read it.</div>}
            {confidentMiss && <div className="small">You were sure, so read the model answer closely. A mistake you were confident about tends to stick once it's corrected.</div>}
            {grade.feedback && verdict !== "correct" && <div>{grade.feedback}</div>}
            {grade.source === "tests" && grade.run.output && (
              <div>
                <div className="sub-label">{grade.run.passed ? "Output" : grade.run.stage === "build" ? "Compiler output" : "What the tests reported"}</div>
                <pre className="run-output">{grade.run.output}</pre>
              </div>
            )}
            {grade.source !== "exact" && grade.source !== "reveal" && grade.source !== "tests" && (
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
            {missed && !pretest && (
              <div>
                <div className="sub-label">Why did you miss it? <span className="muted" style={{ fontWeight: 400 }}>Optional</span></div>
                <div className="seg seg-sm" role="group" aria-label="Why you missed it">
                  {Object.entries(MISS_REASONS).map(([k, r]) => (
                    <button key={k} className={reason === k ? "on" : ""} title={r.blurb} onClick={() => setReason(v => (v === k ? null : k))}>{r.label}</button>
                  ))}
                </div>
                {reason === "unlearned" && concept.summary && (
                  <div className="relearn small">
                    <div className="sub-label">The idea</div>
                    <Markdown>{concept.summary}</Markdown>
                    <div className="muted" style={{ marginTop: 6 }}>Reviewing can't fix something you never learned. Go back to the source for this one; it comes back shortly to check.</div>
                  </div>
                )}
              </div>
            )}
            {deeper && <GoDeeper item={item} concept={concept} course={course} answer={answer} onResult={setProbe}/>}
            {pretest ? (
              <div><button className="btn btn-primary" onClick={next} autoFocus>Next <span className="kbd">↵</span></button></div>
            ) : (
              <div className="rate-row" role="group" aria-label="Rate how well you knew it">
                {[1, 2, 3, 4].map(r => (
                  <button key={r} className={`rate-btn${r === suggested ? " suggested" : ""}`} onClick={() => rate(r)}>
                    {RATING_LABEL[r]}<span className="ivl">{ivls[r]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!pretest && (
            <div className="feedback-foot small muted">
              {canDeeper && !deeper && (
                <button className="link small" onClick={() => setDeeper(true)} title="Follow-up questions, one level deeper each time, until an answer breaks">Go deeper</button>
              )}
              <span className="grow"/>
              {grade.verdict !== "correct" && grade.source !== "reveal" && !override && (
                <button className="link small" onClick={() => setOverride("correct")}>I was right</button>
              )}
              {grade.verdict === "correct" && !override && (
                <button className="link small" onClick={() => setOverride("incorrect")}>Actually, I got this wrong</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

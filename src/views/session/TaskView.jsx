// One practice task: answer from memory → graded against the rubric (or by
// running its tests) → rate.
//
//   answer → grading | running → feedback          (the usual path)
//                              → followup → …       (the grader wants one more detail)
//                              → selfcheck → feedback (no API key, or grading failed)
//
// The screen stays bare: the question in the middle, an empty answer box
// under it (no hint about the answer's form), Check, and I don't know. Behind it:
//  - Pace: a right answer that took far longer than usual isn't fluent yet, so
//    Hard is suggested instead of Good. (Ctrl+Shift+Enter checks as "I'm sure":
//    a confident miss comes back a little sooner.)
//  - Fresh versions: an apply question you've seen comes back with a new example.
//  - Short answers (a term, a value, what it prints) are checked instantly
//    against the accepted answers, and Enter checks them.

import { useEffect, useRef, useState } from "react";
import { useKey, isTyping } from "../../ui/hooks.js";
import Markdown from "../../ui/Markdown.jsx";
import { Spinner } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { matchesAccepted, plainlyWrong, verdictFromChecks, suggestedRating } from "../../lib/grade.js";
import { gradeWithAI, rubricFor } from "../../lib/ai.js";
import { isSlow } from "../../lib/training.js";
import { hasTests, runCode } from "../../lib/code.js";
import { play } from "../../ui/sound.js";
import QuestionCard from "./QuestionCard.jsx";
import SelfCheck from "./SelfCheck.jsx";
import Feedback from "./Feedback.jsx";

const ctrlEnter = (e) => (e.ctrlKey || e.metaKey) && e.key === "Enter";

/** In a code answer, Tab indents instead of leaving the box. */
function indentOnTab(e, setAnswer) {
  if (e.key !== "Tab" || e.shiftKey) return;
  e.preventDefault();
  const el = e.currentTarget, at = el.selectionStart;
  setAnswer(v => `${v.slice(0, at)}    ${v.slice(el.selectionEnd)}`);
  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = at + 4; });
}

export default function TaskView({ item: stored, concept, aiReady, pace = null, variant = null, pretest = false, onDone, onReport }) {
  const [phase, setPhase] = useState("answer"); // answer | grading | running | followup | selfcheck | feedback
  const [answer, setAnswer] = useState("");
  const [gaveUp, setGaveUp] = useState(false);
  const [sure, setSure] = useState(false);
  const [grade, setGrade] = useState(null);
  const [followUp, setFollowUp] = useState({ question: "", answer: "" });
  const [error, setError] = useState("");
  const [override, setOverride] = useState(null); // you can overrule the grade either way: "correct" | "incorrect"
  const [reason, setReason] = useState(null); // a wrong belief the grader found (makes Again the suggestion)
  // A fresh version is decided when the question appears and never swapped mid-answer.
  const [fresh, setFresh] = useState(variant);
  const [took, setTook] = useState(0); // time to your answer, before any grading
  const started = useRef(0);
  const finished = useRef(false);
  const answerRef = useRef(null);

  useEffect(() => { started.current = Date.now(); answerRef.current?.focus(); }, []);

  const item = fresh ? { ...stored, ...fresh, accept: fresh.accept ?? [] } : stored;
  const points = rubricFor(item);
  const aided = gaveUp;
  const code = hasTests(stored) ? stored.tests : null;
  // A short exact answer: a smaller box, and Enter checks it.
  const quick = !code && item.accept?.length > 0;

  const stamp = () => { const t = Date.now() - started.current; setTook(v => v || t); };
  const finishWith = (g) => {
    setGrade(g); setPhase("feedback");
    if (g.verdict === "correct") play("correct");
    else if (g.misconceptionsFound?.length) setReason("misconception");
  };
  const selfCheck = (why = "") => { setError(why); setPhase("selfcheck"); };

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
    if ((phase !== "answer" && phase !== "followup") || !answer.trim()) return;
    stamp();
    let note = "";
    if (!fu && code) {
      setPhase("running");
      const run = await runCode({ lang: code.lang, solution: answer, tests: code.code });
      if (run.ok) return finishWith({ verdict: run.passed ? "correct" : "incorrect", source: "tests", points: [], misconceptionsFound: [], feedback: "", run });
      // Can't run here (no Python or compiler): grade against the key points instead.
      note = `Couldn't run the tests: ${run.error} Graded against the key points instead.`;
    }
    if (!fu && item.accept?.length && matchesAccepted(answer, item.accept)) {
      return finishWith({ verdict: "correct", source: "exact", points: points.map(text => ({ text, met: true })), misconceptionsFound: [], feedback: "" });
    }
    if (!fu && item.accept?.length && plainlyWrong(answer, item.accept)) {
      return finishWith({ verdict: "incorrect", source: "exact", points: points.map(text => ({ text, met: false })), misconceptionsFound: [], feedback: "" });
    }
    return grader(fu, note);
  };

  const giveUp = () => {
    stamp();
    setGaveUp(true);
    finishWith({ verdict: "incorrect", source: "reveal", points: points.map(text => ({ text, met: false })), misconceptionsFound: [], feedback: "" });
  };

  const verdict = grade ? (override ?? grade.verdict) : null;
  const missed = verdict != null && verdict !== "correct";
  const slow = verdict === "correct" && !aided && !override && isSlow(took, stored.ability, pace);
  const suggested = verdict ? suggestedRating(verdict, { aided, slow, reason: missed ? reason : null }) : null;

  const rate = (rating) => {
    if (finished.current) return; // Enter on a focused button must not rate twice
    finished.current = true;
    onDone({
      verdict, rating, aided, overridden: Boolean(override),
      ms: Date.now() - started.current, answerMs: took,
      misconceptions: override === "correct" ? [] : grade.misconceptionsFound,
      sure, slow, reason: missed ? reason : null, variant: Boolean(fresh),
      tests: grade.source === "tests" ? (grade.run.passed ? "passed" : "failed") : null,
    });
  };
  // A pretest isn't rated: it's asked before you've studied the material.
  const next = () => {
    if (finished.current) return;
    finished.current = true;
    onDone({ verdict, rating: null, aided, sure, ms: Date.now() - started.current, answerMs: took });
  };

  useKey((e) => {
    if (phase === "answer" && ctrlEnter(e)) {
      e.preventDefault();
      if (e.shiftKey) setSure(true);
      submit();
    } else if (phase === "followup" && ctrlEnter(e)) {
      e.preventDefault();
      if (followUp.answer.trim()) submit(followUp);
    } else if (phase === "feedback" && !isTyping(e) && e.target?.tagName !== "BUTTON") {
      if (e.key === "Enter") { e.preventDefault(); if (pretest) next(); else rate(suggested); }
      else if (!pretest && ["1", "2", "3", "4"].includes(e.key)) rate(Number(e.key));
    }
  }, [phase, answer, followUp, suggested, grade, override, aided, sure, reason, pretest, took]);

  return (
    <div className="task enter">
      <QuestionCard item={item} fresh={fresh} canUseOriginal={phase === "answer"} onUseOriginal={() => setFresh(null)} onReport={onReport}/>

      <div className="stack gap-3">
        <textarea
          ref={answerRef} className={cx("answer-box", code && "code", quick && "short")} value={answer} onChange={e => setAnswer(e.target.value)}
          disabled={phase !== "answer"} aria-label="Your answer" spellCheck={!code && !quick}
          onKeyDown={code ? (e) => indentOnTab(e, setAnswer) : quick ? (e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); submit(); }
          } : undefined}
        />
        {phase === "answer" && (
          <div className="row">
            <button className="btn btn-primary" onClick={() => submit()} disabled={!answer.trim()}>
              {code ? "Run tests" : "Check"}<span className="kbd">{quick ? "↵" : "Ctrl ↵"}</span>
            </button>
            <span className="grow"/>
            <button className="btn btn-quiet" onClick={giveUp}>I don't know</button>
          </div>
        )}
        {(phase === "grading" || phase === "running") && <div className="busy small"><Spinner/>Checking…</div>}
      </div>

      {phase === "followup" && (
        <div className="feedback enter">
          <div className="feedback-body">
            <div className="caption">One quick follow-up to be sure</div>
            <Markdown>{followUp.question}</Markdown>
            <textarea className="answer-box short" autoFocus value={followUp.answer} aria-label="Follow-up answer"
              onChange={e => setFollowUp(f => ({ ...f, answer: e.target.value }))}/>
            <div className="row">
              <button className="btn btn-primary" disabled={!followUp.answer.trim()} onClick={() => submit(followUp)}>Submit<span className="kbd">Ctrl ↵</span></button>
              <button className="btn btn-quiet" onClick={() => selfCheck()}>Check it myself instead</button>
            </div>
          </div>
        </div>
      )}

      {phase === "selfcheck" && <SelfCheck item={item} points={points} error={error} onSave={finishWith}/>}

      {phase === "feedback" && grade && (
        <Feedback grade={grade} verdict={verdict} override={override} onOverride={setOverride}
          item={item} pretest={pretest} suggested={suggested} onRate={rate} onNext={next}/>
      )}
    </div>
  );
}

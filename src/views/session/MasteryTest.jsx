// The mastery test (lib/masteryTest.js): twenty questions with nothing to
// lean on. No lesson, no hint, no feedback after each answer: you answer,
// it's marked quietly in the background, and the next question comes. At the
// end you see how you did, which concepts are now mastered, and what each
// missed question was looking for.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import { useKey, isTyping } from "../../ui/hooks.js";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Spinner, Notice } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { index } from "../../lib/model.js";
import { matchesAccepted, plainlyWrong, verdictFromChecks } from "../../lib/grade.js";
import { aiAvailable, gradeWithAI } from "../../lib/ai.js";
import { testRating } from "../../lib/masteryTest.js";
import { xpFor, totalXp } from "../../lib/xp.js";
import { plural } from "../../lib/format.js";
import { play } from "../../ui/sound.js";
import QuestionCard from "./QuestionCard.jsx";
import { RankLine } from "../../ui/Rank.jsx";

const ctrlEnter = (e) => (e.ctrlKey || e.metaKey) && e.key === "Enter";

/** Mark one answer: exactly against its accepted answers when it has them, otherwise by Claude. */
async function mark(item, concept, answer) {
  if (!answer.trim()) return { verdict: "incorrect" };
  if (item.accept?.length && matchesAccepted(answer, item.accept)) return { verdict: "correct" };
  if (item.accept?.length && plainlyWrong(answer, item.accept)) return { verdict: "incorrect" };
  const res = await gradeWithAI(item, concept, answer, null).catch(err => ({ ok: false, error: err?.message }));
  if (!res.ok) return { verdict: null, error: res.error || "Couldn't mark this answer." };
  // No follow-up questions in a test: what was written is what's marked.
  return { verdict: verdictFromChecks(res.points.map(p => p.met), res.misconceptionsFound.length), feedback: res.feedback };
}

export default function MasteryTest({ tasks }) {
  const { state, act } = useStore();
  const nav = useNav();
  const ix = index(state);
  const [phase, setPhase] = useState("intro"); // intro | answer | marking | results
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [marks, setMarks] = useState({}); // index → { verdict, feedback, error }
  const [aiReady, setAiReady] = useState(null);
  const [answers, setAnswers] = useState([]); // index → { task, answer, ms }
  const [xpBefore] = useState(() => totalXp(state.attempts));
  const started = useRef(0);
  const recorded = useRef(false);
  const boxRef = useRef(null);

  useEffect(() => { aiAvailable().then(setAiReady); }, []);
  const exit = () => nav.endSession();
  useKey((e) => { if (e.key === "Escape" && !document.querySelector(".modal")) exit(); }, []);

  const task = tasks[idx];
  const item = task && ix.item[task.itemId];
  const quick = Boolean(item?.accept?.length);

  const begin = () => { setPhase("answer"); started.current = Date.now(); };
  const markAt = (i, a = answers[i]) => {
    const it = ix.item[a.task.itemId], c = it && ix.concept[it.conceptId];
    setMarks(m => ({ ...m, [i]: { pending: true } }));
    (it ? mark(it, c, a.answer) : Promise.resolve({ verdict: null, error: "This question was deleted." }))
      .then(r => setMarks(m => ({ ...m, [i]: r })));
  };
  const next = (text = answer) => {
    if (phase !== "answer") return;
    const entry = { task, answer: text, ms: Date.now() - started.current };
    setAnswers(list => { const out = [...list]; out[idx] = entry; return out; });
    markAt(idx, entry);
    setAnswer("");
    started.current = Date.now();
    if (idx + 1 < tasks.length) { setIdx(idx + 1); requestAnimationFrame(() => boxRef.current?.focus()); }
    else setPhase("marking");
  };

  // Every answer marked: record them all (once) and show the results.
  const allMarked = phase === "marking" && tasks.every((_, i) => marks[i] && !marks[i].pending);
  const unmarked = tasks.filter((_, i) => marks[i] && !marks[i].pending && marks[i].verdict == null).length;
  useEffect(() => {
    if (!allMarked || unmarked || recorded.current) return;
    recorded.current = true;
    const now = Date.now();
    tasks.forEach((t, i) => {
      const r = marks[i];
      act("attempt", { itemId: t.itemId, verdict: r.verdict, rating: testRating(r.verdict), mode: "test", ms: answers[i]?.ms ?? 0, now: now + i });
    });
    setPhase("results");
    play(tasks.some((_, i) => marks[i].verdict === "correct") ? "mastered" : "chime");
  }, [allMarked, unmarked, marks, tasks, act, answers]);

  useKey((e) => {
    if (phase === "intro" && e.key === "Enter" && !isTyping(e) && e.target?.tagName !== "BUTTON") { e.preventDefault(); begin(); }
    else if (phase === "answer" && ctrlEnter(e)) { e.preventDefault(); if (answer.trim()) next(); }
  }, [phase, answer, idx]);

  const right = tasks.filter((_, i) => marks[i]?.verdict === "correct");
  const missed = tasks.map((t, i) => ({ t, i })).filter(({ i }) => phase === "results" && marks[i]?.verdict !== "correct");
  const gained = tasks.reduce((n, _, i) => n + xpFor({ verdict: marks[i]?.verdict, mode: "test" }), 0);

  return (
    <div className="session" role="dialog" aria-label="Mastery test">
      <div className="session-top">
        <button className="btn btn-quiet btn-icon" onClick={exit} aria-label={phase === "results" ? "Close" : "Leave the test"} title={phase === "results" ? "Close" : "Leave the test"}><Icon name="x"/></button>
        <span/>
        <span/>
      </div>
      <div className="session-body">
        <div className="session-inner">
          {phase === "intro" && (
            <div className="task enter test-intro">
              <h2 className="test-title">Mastery test</h2>
              <p className="test-lead">{plural(tasks.length, "question")}, one for each concept that's ready. No hints, and no answers until the end. A right answer masters the concept.</p>
              {aiReady === false && <Notice tone="warn" icon="alert">Marking the test needs your Anthropic API key (Settings).</Notice>}
              <div className="row"><button className="btn btn-primary btn-lg" onClick={begin} disabled={aiReady === false} autoFocus>Begin</button></div>
            </div>
          )}

          {phase === "answer" && item && (
            <div className="task enter" key={idx}>
              <QuestionCard item={item} flag={false}/>
              <div className="composer">
                <textarea ref={boxRef} className={cx("answer-box", quick && "short")} value={answer} autoFocus placeholder="Your answer"
                  onChange={e => setAnswer(e.target.value)} aria-label="Your answer" spellCheck={!quick}
                  onKeyDown={quick ? (e) => { if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (answer.trim()) next(); } } : undefined}/>
                <div className="answer-actions">
                  <button className="btn btn-quiet" onClick={() => next("")}>Skip</button>
                  <button className="btn btn-primary" onClick={() => next()} disabled={!answer.trim()}>
                    {idx + 1 < tasks.length ? "Next" : "Finish"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === "marking" && (
            <div className="task enter test-intro">
              {unmarked && allMarked ? (
                <>
                  <p className="test-lead">{plural(unmarked, "answer")} couldn't be marked. {Object.values(marks).find(m => m.error)?.error}</p>
                  <div className="row"><button className="btn btn-primary" onClick={() => tasks.forEach((_, i) => { if (marks[i]?.verdict == null) markAt(i); })}>Try again</button></div>
                </>
              ) : <div className="busy"><Spinner/>Marking your test…</div>}
            </div>
          )}

          {phase === "results" && (
            <div className="task enter test-results">
              <div className="test-score">
                <span className="test-score-n num">{right.length}</span>
                <span className="test-score-of">of {tasks.length}</span>
              </div>
              <p className="test-lead">{right.length ? `${plural(right.length, "concept")} mastered.` : "Nothing mastered this time."}{missed.length > 0 && " The rest go back into your reviews."}</p>
              <RankLine xp={xpBefore + gained} gained={gained}/>
              {right.length > 0 && (
                <details className="disclosure">
                  <summary>Mastered</summary>
                  <ul className="test-list">{right.map(t => <li key={t.conceptId}>{ix.concept[t.conceptId]?.name}</li>)}</ul>
                </details>
              )}
              {missed.length > 0 && (
                <div className="test-missed">
                  {missed.map(({ t, i }) => {
                    const it = ix.item[t.itemId];
                    if (!it) return null;
                    return (
                      <details key={t.itemId} className="test-miss">
                        <summary>{ix.concept[t.conceptId]?.name}</summary>
                        <div className="stack gap-3">
                          <Markdown>{it.prompt}</Markdown>
                          <div className="small muted">Your answer: {answers[i]?.answer?.trim() || "skipped"}</div>
                          <div className="quote"><Markdown>{it.answer}</Markdown></div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
              <div className="row"><button className="btn btn-primary btn-lg" onClick={exit} autoFocus>Done</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

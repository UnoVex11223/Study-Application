import { useEffect, useRef, useState } from "react";
import { useApp } from "./context.js";
import { Screen, RateButtons, ResultScreen } from "./shared.jsx";
import { RATING } from "../lib/fsrs.js";
import { cardPromptText, cardAnswer } from "../lib/cards.js";
import { playCorrect, playWrong } from "../lib/audio.js";
import { XP_SESSION_DONE } from "../lib/xp.js";

const TIMER_SECONDS = 30;

// Offline fallback: crude keyword-overlap check.
function wordMatch(user, correct) {
  const clean = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const uw = clean(user).split(/\s+/).filter(w => w.length > 3);
  const cw = clean(correct).split(/\s+/).filter(w => w.length > 3);
  if (!uw.length) return false;
  if (!cw.length) return true;
  return uw.filter(u => cw.some(c => c.includes(u) || u.includes(c))).length / cw.length >= 0.35;
}

const VERDICT_LABEL = { correct: "Correct!", partial: "Partially correct", incorrect: "Not quite" };
const SUGGESTED = { partial: RATING.HARD, incorrect: RATING.AGAIN };

// One card attempt: type → grade → rate. Remounted (via key) for each card.
function Round({ card, position, total, onRate }) {
  const [answer, setAnswer] = useState("");
  const [timer, setTimer] = useState(TIMER_SECONDS);
  const [phase, setPhase] = useState("typing"); // typing | grading | graded
  const [grade, setGrade] = useState(null);
  const timerRef = useRef(null);
  const stateRef = useRef({ answer: "", timer: TIMER_SECONDS, phase: "typing" });
  useEffect(() => { stateRef.current = { answer, timer, phase }; }, [answer, timer, phase]);

  const submit = async () => {
    const { answer: ans, timer: t, phase: ph } = stateRef.current;
    if (ph !== "typing") return;
    clearInterval(timerRef.current);
    setPhase("grading");
    const correctAnswer = cardAnswer(card);
    const question = cardPromptText(card);
    const ai = window.aeroflash?.ai;
    if (ai && ans.trim()) {
      const res = await ai.gradeAnswer({ question, correctAnswer, userAnswer: ans });
      if (res.ok) {
        const suggested = res.data.verdict === "correct"
          ? (t > 15 ? RATING.EASY : RATING.GOOD)
          : SUGGESTED[res.data.verdict];
        setGrade({ ...res.data, suggested, ai: true });
        setPhase("graded");
        return;
      }
    }
    const ok = ans.trim() ? wordMatch(ans, correctAnswer) : false;
    setGrade({
      verdict: ok ? "correct" : "incorrect",
      missing: [], feedback: "",
      suggested: ok ? RATING.GOOD : RATING.AGAIN,
      ai: false,
    });
    setPhase("graded");
  };
  const submitRef = useRef(null);
  useEffect(() => { submitRef.current = submit; });

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimer(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setTimeout(() => submitRef.current(), 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="psub">Q {position} of {total}</span>
        <span className="psub" style={{ color: timer <= 10 ? "#ff9090" : timer <= 20 ? "#ffd200" : "rgba(255,255,255,.75)" }}>⏱ {timer}s</span>
      </div>
      <div className="timer-bg">
        <div className={`timer-fill ${timer > 20 ? "t-ok" : timer > 10 ? "t-warn" : "t-danger"}`} style={{ width: `${(timer / TIMER_SECONDS) * 100}%` }}/>
      </div>
      <div className="glass" style={{ padding: "26px 24px", marginBottom: 20, textAlign: "center" }}>
        <div className="clbl">{card.type === "cloze" ? "Fill the blank" : "Question"}</div>
        <div className="ctxt" style={{ fontSize: 18 }}>{cardPromptText(card)}</div>
      </div>
      <div className="lbl">Your answer:</div>
      <textarea className="typed-inp" value={answer} onChange={e => setAnswer(e.target.value)} disabled={phase !== "typing"}
        onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) submit(); }}/>
      <div style={{ color: "rgba(255,255,255,.4)", fontSize: 12, fontWeight: 600, marginTop: 6, marginBottom: 16 }}>Ctrl+Enter to submit early</div>

      {phase === "typing" && (
        <button className="ab og md" onClick={submit} disabled={!answer.trim()} style={{ width: "100%" }}>Submit Answer →</button>
      )}
      {phase === "grading" && (
        <div style={{ color: "rgba(255,255,255,.7)", fontWeight: 700, textAlign: "center", padding: 14 }}>Grading your answer…</div>
      )}
      {phase === "graded" && grade && (
        <>
          <div className={grade.verdict === "correct" ? "tr-cor" : grade.verdict === "partial" ? "tr-part" : "tr-wrn"}>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
              {VERDICT_LABEL[grade.verdict]}{grade.ai ? "" : " (offline check)"}
            </div>
            <div style={{ color: "rgba(255,255,255,.9)", fontWeight: 600, fontSize: 14, lineHeight: 1.5 }}>{cardAnswer(card)}</div>
            {grade.missing?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ color: "#ffd200", fontWeight: 800, fontSize: 12, marginBottom: 4 }}>You missed:</div>
                {grade.missing.map((m, i) => (
                  <div key={i} style={{ color: "rgba(255,255,255,.85)", fontSize: 13, fontWeight: 600 }}>• {m}</div>
                ))}
              </div>
            )}
            {grade.feedback && <div style={{ color: "rgba(255,255,255,.7)", fontSize: 13, fontWeight: 600, marginTop: 8, fontStyle: "italic" }}>{grade.feedback}</div>}
          </div>
          <div style={{ color: "rgba(255,255,255,.7)", fontSize: 13, fontWeight: 700, textAlign: "center", margin: "16px 0 10px" }}>
            {grade.ai ? `AI suggests: ${["", "Again", "Hard", "Good", "Easy"][grade.suggested]} — you decide` : "How did you actually do?"}
          </div>
          <RateButtons srs={card.srs} onRate={onRate}/>
        </>
      )}
    </>
  );
}

export default function TypedQuiz() {
  const { topics, topicId, applyRating, addXp, setView } = useApp();
  const topic = topics.find(t => t.id === topicId);
  const [cards] = useState(() => [...(topic?.cards || [])].sort(() => Math.random() - 0.5));
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState({ c: 0, t: 0 });
  const [sessionDone, setSessionDone] = useState(false);

  const card = cards[idx];

  const handleRate = (rating) => {
    applyRating({ ...card, topicId }, rating, "typed");
    if (rating >= RATING.GOOD) playCorrect(); else if (rating === RATING.AGAIN) playWrong();
    setScore(s => ({ c: s.c + (rating >= RATING.GOOD ? 1 : 0), t: s.t + 1 }));
    if (idx + 1 >= cards.length) { addXp(XP_SESSION_DONE); setSessionDone(true); return; }
    setIdx(i => i + 1);
  };

  const restart = () => { setIdx(0); setScore({ c: 0, t: 0 }); setSessionDone(false); };

  if (!card && !sessionDone) { setView("topic"); return null; }

  return (
    <Screen>
      <button className="bk" onClick={() => setView("topic")} style={{ marginBottom: 24 }}>← {topic?.name}</button>
      {sessionDone
        ? <ResultScreen label="TYPE MODE COMPLETE" score={score} startFn={restart} btnClass="og" onBack={() => setView("topic")}/>
        : <Round key={`${card.id}-${score.t}`} card={card} position={idx + 1} total={cards.length} onRate={handleRate}/>}
    </Screen>
  );
}

import { useState } from "react";
import { useApp } from "./context.js";
import { Screen, ResultScreen } from "./shared.jsx";
import { RATING } from "../lib/fsrs.js";
import { isQuizzable } from "../lib/cards.js";
import { playCorrect, playWrong } from "../lib/audio.js";
import { XP_QUIZ_CORRECT, XP_SESSION_DONE } from "../lib/xp.js";

function buildQuestion(card, pool) {
  let wrongs = card.wrong?.length >= 3 ? card.wrong.slice(0, 3)
    : pool.filter(o => o.id !== card.id).sort(() => Math.random() - 0.5).slice(0, 3).map(o => o.back);
  while (wrongs.length < 3) wrongs.push("None of the above");
  return { card, question: card.front, answer: card.back, choices: [...wrongs.slice(0, 3), card.back].sort(() => Math.random() - 0.5) };
}

export default function Quiz() {
  const { topics, topicId, applyRating, addXp, setView } = useApp();
  const topic = topics.find(t => t.id === topicId);
  const [pool] = useState(() => (topic?.cards || []).filter(isQuizzable).sort(() => Math.random() - 0.5));
  const [idx, setIdx] = useState(0);
  const [question, setQuestion] = useState(() => pool.length ? buildQuestion(pool[0], pool) : null);
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState({ c: 0, t: 0 });
  const [quizDone, setQuizDone] = useState(false);

  const restart = () => {
    setIdx(0); setScore({ c: 0, t: 0 }); setQuizDone(false); setSelected(null);
    setQuestion(buildQuestion(pool[0], pool));
  };

  const handleAnswer = (ch) => {
    if (selected !== null) return;
    const correct = ch === question.answer;
    setSelected(ch);
    setScore(s => ({ c: s.c + (correct ? 1 : 0), t: s.t + 1 }));
    applyRating({ ...question.card, topicId }, correct ? RATING.GOOD : RATING.AGAIN, "quiz");
    if (correct) { playCorrect(); addXp(XP_QUIZ_CORRECT); }
    else playWrong();
  };

  const nextQuiz = () => {
    if (idx + 1 >= pool.length) { addXp(XP_SESSION_DONE); setQuizDone(true); return; }
    const next = idx + 1;
    setIdx(next); setQuestion(buildQuestion(pool[next], pool)); setSelected(null);
  };

  return (
    <Screen>
      <button className="bk" onClick={() => setView("topic")} style={{ marginBottom: 24 }}>← {topic?.name}</button>
      {quizDone ? <ResultScreen label="QUIZ COMPLETE" score={score} startFn={restart} btnClass="aq" onBack={() => setView("topic")}/> : question && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span className="psub">Q {idx + 1} of {pool.length}</span>
            <span className="psub">{score.c}/{score.t} correct</span>
          </div>
          <div className="prog-bg" style={{ marginBottom: 28 }}>
            <div className="prog-fill" style={{ width: `${((idx + 1) / pool.length) * 100}%` }}/>
          </div>
          <div className="glass" style={{ padding: "26px 24px", marginBottom: 20, textAlign: "center" }}>
            <div className="clbl">Question</div>
            <div className="ctxt" style={{ fontSize: 18 }}>{question.question}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {question.choices.map((ch, i) => {
              let cls = "qch";
              if (selected !== null) { if (ch === question.answer) cls += " qcor"; else if (ch === selected) cls += " qwrn"; }
              return <button key={i} className={cls} disabled={selected !== null} onClick={() => handleAnswer(ch)}>{ch}</button>;
            })}
          </div>
          {selected !== null && (
            <div style={{ textAlign: "center" }}>
              <div style={{ color: selected === question.answer ? "#6effc8" : "#ff9090", fontWeight: 800, fontSize: 16, marginBottom: 16 }}>
                {selected === question.answer ? `Correct! +${XP_QUIZ_CORRECT} XP` : "Incorrect — correct answer highlighted"}
              </div>
              <button className="ab aq md" onClick={nextQuiz}>
                {idx + 1 >= pool.length ? "See Results" : "Next Question →"}
              </button>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}

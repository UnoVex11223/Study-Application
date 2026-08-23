import { useEffect, useRef, useState } from "react";
import { useApp } from "./context.js";
import { Screen } from "./shared.jsx";
import { RATING } from "../lib/fsrs.js";
import { isQuizzable } from "../lib/cards.js";
import { saveStats } from "../lib/storage.js";

const TOTAL_TIME = 1500; // 25 minutes

function buildSimQuestions(topics, n = 20) {
  const all = topics.flatMap(t => t.cards.filter(isQuizzable).map(c => ({ ...c, topicId: t.id, topicName: t.name })));
  const shuffled = [...all].sort(() => Math.random() - 0.5).slice(0, n);
  return shuffled.map(c => {
    let wrongs = c.wrong?.length >= 3 ? c.wrong.slice(0, 3)
      : all.filter(o => o.id !== c.id).sort(() => Math.random() - 0.5).slice(0, 3).map(o => o.back);
    while (wrongs.length < 3) wrongs.push("None of the above");
    return { card: c, topicName: c.topicName, question: c.front, answer: c.back, choices: [...wrongs.slice(0, 3), c.back].sort(() => Math.random() - 0.5) };
  });
}

export default function Sim() {
  const { topics, applyRating, stats, setStats, setView, startSim } = useApp();
  const [questions] = useState(() => buildSimQuestions(topics, 20));
  const [idx, setIdx] = useState(0);
  const [timer, setTimer] = useState(TOTAL_TIME);
  const [answers, setAnswers] = useState([]);
  const [simDone, setSimDone] = useState(false);
  const [flash, setFlash] = useState(null);
  const timerRef = useRef(null);
  const flashRef = useRef(null);
  const savedRef = useRef(false);

  useEffect(() => {
    if (simDone) { clearInterval(timerRef.current); return undefined; }
    timerRef.current = setInterval(() => setTimer(t => { if (t <= 1) { clearInterval(timerRef.current); setSimDone(true); return 0; } return t - 1; }), 1000);
    return () => clearInterval(timerRef.current);
  }, [simDone]);

  useEffect(() => () => clearTimeout(flashRef.current), []);

  useEffect(() => {
    if (!simDone || savedRef.current) return;
    savedRef.current = true;
    const correct = answers.filter(a => a.correct).length;
    const ns = { ...stats, lastSim: { score: correct, total: answers.length, date: new Date().toLocaleDateString() } };
    setStats(ns); saveStats(ns);
  }, [simDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnswer = (ch) => {
    if (flash !== null) return;
    const q = questions[idx];
    const correct = ch === q.answer;
    setFlash(correct ? "c" : "w");
    applyRating(q.card, correct ? RATING.GOOD : RATING.AGAIN, "sim");
    setAnswers(a => [...a, { selected: ch, answer: q.answer, topicName: q.topicName, question: q.question, correct }]);
    clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => {
      setFlash(null);
      if (idx + 1 >= questions.length) { clearInterval(timerRef.current); setSimDone(true); }
      else setIdx(i => i + 1);
    }, 900);
  };

  if (simDone) {
    const correct = answers.filter(a => a.correct).length;
    const byTopic = {};
    answers.forEach(a => {
      if (!byTopic[a.topicName]) byTopic[a.topicName] = { c: 0, t: 0 };
      byTopic[a.topicName].t++;
      if (a.correct) byTopic[a.topicName].c++;
    });
    const missed = answers.filter(a => !a.correct);
    return (
      <Screen>
        <div style={{ textAlign: "center", paddingTop: 32, marginBottom: 32 }}>
          <div style={{ color: "rgba(255,255,255,.65)", fontSize: 13, fontWeight: 800, letterSpacing: 1.4, marginBottom: 20 }}>SIMULATION COMPLETE</div>
          <div className="sco" style={{ width: 120, height: 120, margin: "0 auto" }}>
            <div style={{ color: "#fff", fontSize: 36, fontWeight: 900 }}>{correct}/{answers.length}</div>
            <div style={{ color: "rgba(255,255,255,.7)", fontSize: 12, fontWeight: 700 }}>correct</div>
          </div>
          <div style={{ color: "#fff", fontSize: 22, fontWeight: 900, marginTop: 20 }}>
            {answers.length > 0 && correct / answers.length >= 0.8 ? "Strong performance!" : answers.length > 0 && correct / answers.length >= 0.6 ? "Good effort!" : "More practice needed"}
          </div>
          <div style={{ color: "rgba(255,255,255,.5)", fontSize: 13, fontWeight: 600, marginTop: 6 }}>
            Time: {Math.floor((TOTAL_TIME - timer) / 60)}m {(TOTAL_TIME - timer) % 60}s used · missed answers are now scheduled for review
          </div>
        </div>

        {Object.keys(byTopic).length > 0 && (
          <>
            <div className="section-title">Score by Topic</div>
            {Object.entries(byTopic).map(([name, { c, t }]) => (
              <div key={name} className="acc-row" style={{ cursor: "default" }}>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, minWidth: 110, flex: 1 }}>{name}</div>
                <div className="acc-bar-bg">
                  <div className="acc-bar-fill" style={{ width: `${Math.round(c / t * 100)}%`, background: c / t >= 0.7 ? "#6effc8" : c / t >= 0.5 ? "#ffd200" : "#ff8888" }}/>
                </div>
                <div style={{ color: "rgba(255,255,255,.8)", fontWeight: 800, fontSize: 13, minWidth: 40, textAlign: "right" }}>{c}/{t}</div>
              </div>
            ))}
            <div style={{ height: 24 }}/>
          </>
        )}

        {missed.length > 0 && (
          <>
            <div className="section-title">Missed Questions</div>
            {missed.map((a, i) => (
              <div key={i} style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", marginBottom: 8 }}>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{a.question}</div>
                <div style={{ color: "#ff9090", fontSize: 12, fontWeight: 600, marginTop: 6 }}>Your answer: {a.selected}</div>
                <div style={{ color: "#6effc8", fontSize: 12, fontWeight: 600, marginTop: 3 }}>Correct: {a.answer}</div>
                <div style={{ color: "rgba(255,255,255,.4)", fontSize: 11, fontWeight: 600, marginTop: 3 }}>{a.topicName}</div>
              </div>
            ))}
            <div style={{ height: 16 }}/>
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <button className="ab aq md" onClick={startSim}>New Simulation</button>
          <button className="ab gh md" onClick={() => setView("home")}>Home</button>
        </div>
      </Screen>
    );
  }

  const q = questions[idx];
  const mins = Math.floor(timer / 60), secs = timer % 60;
  return (
    <Screen>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ color: "#fff", fontWeight: 800, fontSize: 13 }}>Simulation</span>
        <span style={{ color: timer < 300 ? "#ff8888" : timer < 600 ? "#ffd200" : "rgba(255,255,255,.75)", fontWeight: 900, fontSize: 16 }}>
          {mins}:{String(secs).padStart(2, "0")}
        </span>
      </div>
      <div className="sim-total-bar">
        <div className="sim-total-fill" style={{ width: `${(timer / TOTAL_TIME) * 100}%` }}/>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <span className="psub">Q {idx + 1} of {questions.length}</span>
        <span className="psub">{answers.filter(a => a.correct).length}/{answers.length} correct</span>
      </div>
      <div className="glass" style={{ padding: "26px 24px", marginBottom: 20, textAlign: "center" }}>
        <div className="clbl">{q?.topicName}</div>
        <div className="ctxt" style={{ fontSize: 17 }}>{q?.question}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {q?.choices.map((ch, i) => {
          let cls = "qch";
          if (flash !== null) {
            if (ch === q.answer) cls += " sim-flash-cor";
            else if (ch === answers[answers.length - 1]?.selected && !answers[answers.length - 1]?.correct) cls += " sim-flash-wrn";
          }
          return <button key={i} className={cls} disabled={flash !== null} onClick={() => handleAnswer(ch)}>{ch}</button>;
        })}
      </div>
    </Screen>
  );
}

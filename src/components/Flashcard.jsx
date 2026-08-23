import { useState } from "react";
import { useApp } from "./context.js";
import { Screen, RateButtons, ClozeText } from "./shared.jsx";
import { RATING } from "../lib/fsrs.js";
import { isCloze } from "../lib/cards.js";
import { playCorrect, playWrong } from "../lib/audio.js";
import { XP_SESSION_DONE } from "../lib/xp.js";

export default function Flashcard() {
  const { topics, topicId, applyRating, addXp, setView } = useApp();
  const topic = topics.find(t => t.id === topicId);
  const [order, setOrder] = useState(() => (topic?.cards || []).map(c => c.id));
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const cards = order.map(id => topic?.cards.find(c => c.id === id)).filter(Boolean);
  const card = cards[idx];
  if (!card) { setView("topic"); return null; }

  const finish = () => { addXp(XP_SESSION_DONE); setView("topic"); };
  const next = () => {
    setFlipped(false);
    if (idx + 1 >= cards.length) finish();
    else setIdx(i => i + 1);
  };
  const handleRate = (rating) => {
    applyRating({ ...card, topicId }, rating, "flip");
    if (rating >= RATING.GOOD) playCorrect(); else if (rating === RATING.AGAIN) playWrong();
    next();
  };
  const shuffle = () => {
    setOrder(o => [...o].sort(() => Math.random() - 0.5));
    setIdx(0); setFlipped(false);
  };
  const cloze = isCloze(card);

  return (
    <Screen>
      <button className="bk" onClick={() => setView("topic")} style={{ marginBottom: 24 }}>← {topic?.name}</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="psub">{idx + 1} / {cards.length}</span>
        <button className="ab gh sm" onClick={shuffle}>Shuffle</button>
      </div>
      <div className="prog-bg" style={{ marginBottom: 32 }}>
        <div className="prog-fill" style={{ width: `${((idx + 1) / cards.length) * 100}%` }}/>
      </div>
      {cloze ? (
        <div className="glass" style={{ padding: "40px 28px", marginBottom: 28, textAlign: "center", cursor: "pointer" }} onClick={() => setFlipped(f => !f)}>
          <div className="clbl">Fill the blank</div>
          <div className="ctxt"><ClozeText text={card.text} revealed={flipped}/></div>
          {!flipped && <div className="chnt">Tap to reveal</div>}
        </div>
      ) : (
        <div className="flip-wrap" style={{ marginBottom: 28 }}>
          <div className={`flip-inner${flipped ? " on" : ""}`} onClick={() => setFlipped(f => !f)}>
            <div className="flip-face ff"><div className="clbl">Question</div><div className="ctxt">{card.front}</div><div className="chnt">Tap to reveal answer</div></div>
            <div className="flip-face fb"><div className="clbl">Answer</div><div className="ctxt">{card.back}</div><div className="chnt">Tap to flip back</div></div>
          </div>
        </div>
      )}
      {flipped ? (
        <>
          <div style={{ color: "rgba(255,255,255,.6)", fontSize: 12, fontWeight: 700, textAlign: "center", marginBottom: 8 }}>How well did you know it?</div>
          <RateButtons srs={card.srs} onRate={handleRate}/>
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button className="ab gh md" onClick={() => { setIdx(i => Math.max(0, i - 1)); setFlipped(false); }} disabled={idx === 0}>← Prev</button>
          <button className="ab aq md" onClick={next}>{idx === cards.length - 1 ? "Done ✓" : "Skip →"}</button>
        </div>
      )}
    </Screen>
  );
}

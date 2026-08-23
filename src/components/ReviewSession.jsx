import { useState } from "react";
import { useApp } from "./context.js";
import { Screen, RateButtons, ClozeText } from "./shared.jsx";
import { RATING } from "../lib/fsrs.js";
import { isCloze } from "../lib/cards.js";
import { playCorrect, playWrong } from "../lib/audio.js";
import { XP_QUEUE_CLEARED } from "../lib/xp.js";

export default function ReviewSession() {
  const { reviewQueue, applyRating, addXp, setView } = useApp();
  const [queue, setQueue] = useState(reviewQueue);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState({ reviews: 0, good: 0 });

  const card = queue[idx];
  const done = idx >= queue.length;

  const handleRate = (rating) => {
    const newSrs = applyRating(card, rating, "review");
    if (rating >= RATING.GOOD) playCorrect(); else if (rating === RATING.AGAIN) playWrong();
    setTally(t => ({ reviews: t.reviews + 1, good: t.good + (rating >= RATING.GOOD ? 1 : 0) }));
    setRevealed(false);
    if (rating === RATING.AGAIN) {
      // Failed cards come back at the end of this session.
      setQueue(q => [...q, { ...card, srs: newSrs }]);
    } else if (idx + 1 >= queue.length) {
      addXp(XP_QUEUE_CLEARED);
    }
    setIdx(i => i + 1);
  };

  if (done) {
    const acc = tally.reviews > 0 ? Math.round((tally.good / tally.reviews) * 100) : 0;
    return (
      <Screen>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, paddingTop: 48 }}>
          <div style={{ fontSize: 52 }}>🎉</div>
          <div className="ptitle" style={{ fontSize: 26 }}>Queue cleared!</div>
          <div className="sco">
            <div style={{ color: "#fff", fontSize: 30, fontWeight: 900 }}>{tally.reviews}</div>
            <div style={{ color: "rgba(255,255,255,.7)", fontSize: 12, fontWeight: 700 }}>reviews</div>
          </div>
          <div className="psub" style={{ textAlign: "center" }}>
            {acc}% rated Good or Easy · +{XP_QUEUE_CLEARED} XP bonus<br/>
            Come back tomorrow — spaced repetition works best daily.
          </div>
          <button className="ab aq md" onClick={() => setView("home")} style={{ minWidth: 200 }}>Done</button>
        </div>
      </Screen>
    );
  }

  const cloze = isCloze(card);
  return (
    <Screen>
      <button className="bk" onClick={() => setView("home")} style={{ marginBottom: 24 }}>← End session</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="psub">{idx + 1} / {queue.length}</span>
        <span className="psub" style={{ fontSize: 12 }}>{card.topicName}{card.srs.state === "new" ? " · NEW" : ""}</span>
      </div>
      <div className="prog-bg" style={{ marginBottom: 32 }}>
        <div className="prog-fill" style={{ width: `${(idx / queue.length) * 100}%` }}/>
      </div>

      {cloze ? (
        <div className="glass" style={{ padding: "40px 28px", marginBottom: 28, textAlign: "center", cursor: revealed ? "default" : "pointer" }}
          onClick={() => !revealed && setRevealed(true)}>
          <div className="clbl">Fill the blank</div>
          <div className="ctxt"><ClozeText text={card.text} revealed={revealed}/></div>
          {!revealed && <div className="chnt">Tap to reveal</div>}
        </div>
      ) : (
        <div className="flip-wrap" style={{ marginBottom: 28 }}>
          <div className={`flip-inner${revealed ? " on" : ""}`} onClick={() => setRevealed(r => !r)}>
            <div className="flip-face ff"><div className="clbl">Question</div><div className="ctxt">{card.front}</div><div className="chnt">Tap to reveal answer</div></div>
            <div className="flip-face fb"><div className="clbl">Answer</div><div className="ctxt">{card.back}</div></div>
          </div>
        </div>
      )}

      {revealed ? (
        <RateButtons srs={card.srs} onRate={handleRate}/>
      ) : (
        <button className="ab aq md" style={{ width: "100%" }} onClick={() => setRevealed(true)}>Show Answer</button>
      )}
      <div style={{ color: "rgba(255,255,255,.45)", fontSize: 12, fontWeight: 600, textAlign: "center", marginTop: 14 }}>
        Rate honestly — the schedule adapts to what you actually remember
      </div>
    </Screen>
  );
}

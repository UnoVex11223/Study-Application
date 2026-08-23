import { useApp } from "./context.js";
import { Screen, ClozeText } from "./shared.jsx";
import { dueCount } from "../lib/fsrs.js";
import { isCloze, isQuizzable } from "../lib/cards.js";

function srsLabel(srs) {
  if (!srs || srs.state === "new") return "new";
  if (srs.state === "learning" || srs.state === "relearning") return "learning";
  const days = Math.round((srs.due - Date.now()) / 864e5);
  return days <= 0 ? "due" : `due in ${days}d`;
}

export default function TopicView() {
  const { topics, topicId, updateTopics, setView, startReview } = useApp();
  const topic = topics.find(t => t.id === topicId);
  const cards = topic?.cards || [];
  const dc = dueCount(cards);
  const quizzable = cards.filter(isQuizzable).length;

  const deleteCard = (cid) => updateTopics(p => p.map(t => t.id !== topicId ? t : { ...t, cards: t.cards.filter(c => c.id !== cid) }));

  return (
    <Screen>
      <button className="bk" onClick={() => setView("home")} style={{ marginBottom: 24 }}>← All Topics</button>
      <div style={{ marginBottom: 28 }}>
        <div className="ptitle">{topic?.name}</div>
        <div className="psub">{cards.length} card{cards.length !== 1 ? "s" : ""}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <button className="ab aq md" onClick={() => setView("flashcard")} disabled={!cards.length}>Flip Cards</button>
        <button className="ab gr md" onClick={() => setView("quiz")} disabled={quizzable < 2}>Quiz</button>
        <button className="ab og md" onClick={() => setView("typedQuiz")} disabled={!cards.length}>Type Mode</button>
        <button className="ab md" onClick={() => setView("addCards")}>+ Add Cards</button>
      </div>
      {dc > 0 && (
        <button className="ab rd md" onClick={() => startReview(topicId)} style={{ width: "100%", marginBottom: 24 }}>
          Review Due Cards
        </button>
      )}
      {!cards.length ? (
        <div className="glass" style={{ padding: 48, textAlign: "center" }}>
          <div style={{ color: "rgba(255,255,255,.6)", fontSize: 16, fontWeight: 700 }}>No cards yet</div>
          <div style={{ color: "rgba(255,255,255,.45)", fontSize: 14, fontWeight: 600, marginTop: 6 }}>Hit "+ Add Cards" to get started</div>
        </div>
      ) : (
        <div className="cgrid">
          {cards.map(c => (
            <div key={c.id} className="ccell">
              {isCloze(c) ? (
                <div className="cf"><ClozeText text={c.text} revealed/></div>
              ) : (
                <>
                  <div className="cf">{c.front}</div>
                  <div className="cb">{c.back}</div>
                </>
              )}
              <div style={{ marginTop: "auto", paddingTop: 8 }}>
                <span className="srs-pill">{srsLabel(c.srs)}</span>
                {isCloze(c) && <span className="srs-pill">cloze</span>}
                {(c.srs?.lapses ?? 0) >= 4 && <span className="srs-pill" style={{ color: "#ff9090" }}>leech ×{c.srs.lapses}</span>}
              </div>
              <button className="xbtn" onClick={() => deleteCard(c.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

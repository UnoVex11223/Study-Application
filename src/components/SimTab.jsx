import { useApp } from "./context.js";
import { isQuizzable } from "../lib/cards.js";

export default function SimTab() {
  const { topics, stats, startSim } = useApp();
  const totalCards = topics.reduce((s, t) => s + t.cards.filter(isQuizzable).length, 0);
  const canSim = totalCards >= 4;
  return (
    <div className="fu">
      <div style={{ marginBottom: 28 }}>
        <div className="ptitle">Interview Simulation</div>
        <div className="psub">20 questions · 25-minute timer · no going back</div>
      </div>
      <div className="glass" style={{ padding: "36px 28px", marginBottom: 20, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>🎯</div>
        <div style={{ color: "#fff", fontWeight: 800, fontSize: 17, marginBottom: 12 }}>Simulate a technical interview</div>
        <div style={{ color: "rgba(255,255,255,.65)", fontSize: 14, fontWeight: 600, lineHeight: 1.75, maxWidth: 380, margin: "0 auto 28px" }}>
          Random questions pulled from all your topics. Each answer flashes correct or wrong, then auto-advances. Full score and breakdown at the end — and every answer updates your review schedule.
        </div>
        <button className="ab aq lg" onClick={startSim} disabled={!canSim} style={{ minWidth: 220 }}>
          Start Simulation
        </button>
        <div style={{ color: "rgba(255,255,255,.5)", fontSize: 13, fontWeight: 600, marginTop: 14 }}>
          {canSim
            ? `${totalCards} quizzable cards across ${topics.length} topic${topics.length !== 1 ? "s" : ""}`
            : "Add at least 4 question-answer cards to begin"}
        </div>
      </div>
      {stats.lastSim && (
        <div style={{ padding: "18px 20px", borderRadius: 18, background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)" }}>
          <div style={{ color: "rgba(255,255,255,.55)", fontSize: 12, fontWeight: 700, letterSpacing: .5, textTransform: "uppercase", marginBottom: 6 }}>Last Simulation</div>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: 22 }}>{stats.lastSim.score}/{stats.lastSim.total} correct</div>
          <div style={{ color: "rgba(255,255,255,.45)", fontSize: 12, fontWeight: 600, marginTop: 4 }}>{stats.lastSim.date}</div>
        </div>
      )}
    </div>
  );
}

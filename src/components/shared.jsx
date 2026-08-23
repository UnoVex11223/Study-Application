import { getLevel, getLvlData, getXpForLevel, getNextXp } from "../lib/xp.js";
import { previewIntervals, RATING } from "../lib/fsrs.js";
import { clozeParts } from "../lib/cards.js";
import { useApp } from "./context.js";

export const Orbs = () => (
  <><div className="bg-orb oa"/><div className="bg-orb ob"/><div className="bg-orb oc"/><div className="bg-orb od"/></>
);

export function XpPopups() {
  const { xpPopups } = useApp();
  return <div className="xp-pop-wrap">{xpPopups.map(p => <div key={p.id} className="xp-pop">+{p.amount} XP</div>)}</div>;
}

export function LevelUpModal() {
  const { levelUpData, setLevelUpData } = useApp();
  if (!levelUpData) return null;
  const { name, emoji, desc, color, badge } = levelUpData;
  return (
    <div className="lu-overlay">
      <div className="lu-backdrop" onClick={() => setLevelUpData(null)}/>
      <div className="lu-stage">
        <div className="lu-box">
          <span className="lu-emoji">{emoji}</span>
          <div className="lu-subtitle">Level Up!</div>
          <div className="lu-title" style={{ color }}>{name}</div>
          <div className="lu-desc">{desc}</div>
          <button className="ab aq md" style={{ padding: "14px 42px" }} onClick={() => setLevelUpData(null)}>Awesome! {badge}</button>
        </div>
      </div>
    </div>
  );
}

export function XpStrip() {
  const { xp } = useApp();
  const level = getLevel(xp);
  const ld = getLvlData(level);
  const xpIn = xp - getXpForLevel(level);
  const xpSpan = getNextXp(level) - getXpForLevel(level);
  return (
    <div className="xp-strip">
      <div className="lvl-badge" style={{ background: `linear-gradient(135deg,${ld.color},${ld.color}99)` }}>
        <span className="lvl-num">{level}</span><span className="lvl-lbl">LVL</span>
      </div>
      <div className="xp-info">
        <div className="xp-name">{ld.emoji} {ld.name}</div>
        <div className="xp-bar-bg"><div className="xp-bar-fill" style={{ width: `${Math.min((xpIn / xpSpan) * 100, 100)}%`, background: `linear-gradient(90deg,${ld.color},${ld.color}99)` }}/></div>
        <div className="xp-count">{xpIn.toLocaleString()} / {xpSpan.toLocaleString()} XP · {xp.toLocaleString()} total</div>
      </div>
    </div>
  );
}

/** Standard screen chrome: gradient background, orbs, XP popups, level-up modal. */
export function Screen({ children }) {
  return (
    <div className="af"><Orbs/><XpPopups/><LevelUpModal/>
      <div className="scr fu">{children}</div>
    </div>
  );
}

const RATE_META = [
  { rating: RATING.AGAIN, label: "Again", cls: "rate-again" },
  { rating: RATING.HARD,  label: "Hard",  cls: "rate-hard" },
  { rating: RATING.GOOD,  label: "Good",  cls: "rate-good" },
  { rating: RATING.EASY,  label: "Easy",  cls: "rate-easy" },
];

/** Again/Hard/Good/Easy buttons with next-interval previews. */
export function RateButtons({ srs, onRate }) {
  const ivls = previewIntervals(srs);
  return (
    <div className="rate-row">
      {RATE_META.map(({ rating, label, cls }) => (
        <button key={rating} className={`rate-btn ${cls}`} onClick={() => onRate(rating)}>
          {label}
          <span className="ivl">{ivls[rating]}</span>
        </button>
      ))}
    </div>
  );
}

/** Cloze sentence — blank before reveal, highlighted answer after. */
export function ClozeText({ text, revealed }) {
  const p = clozeParts(text);
  if (!p) return <>{text}</>;
  return (
    <>
      {p.before}
      {revealed
        ? <span className="cloze-answer">{p.answer}</span>
        : <span className="cloze-blank">&nbsp;</span>}
      {p.after}
    </>
  );
}

export function ResultScreen({ label, score, startFn, btnClass, onBack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, paddingTop: 48 }}>
      <div style={{ color: "rgba(255,255,255,.75)", fontSize: 13, fontWeight: 800, letterSpacing: 1.2 }}>{label}</div>
      <div className="sco">
        <div style={{ color: "#fff", fontSize: 30, fontWeight: 900 }}>{score.c}/{score.t}</div>
        <div style={{ color: "rgba(255,255,255,.7)", fontSize: 12, fontWeight: 700 }}>correct</div>
      </div>
      <div style={{ color: "#fff", fontSize: 20, fontWeight: 800, textAlign: "center" }}>
        {score.c === score.t ? "Perfect!" : score.c >= score.t * 0.7 ? "Great job!" : "Keep practicing!"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, width: "100%" }}>
        <button className={`ab ${btnClass} md`} onClick={startFn}>Try Again</button>
        <button className="ab gh md" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

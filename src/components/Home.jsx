import { useApp } from "./context.js";
import { Orbs, XpPopups, LevelUpModal, XpStrip } from "./shared.jsx";
import TopicsTab from "./TopicsTab.jsx";
import InsightsTab from "./InsightsTab.jsx";
import SimTab from "./SimTab.jsx";
import RanksTab from "./RanksTab.jsx";
import { getDueCards } from "../lib/fsrs.js";
import { newAllowance } from "../lib/storage.js";
import { RECALL_SESSION_LIMIT } from "../lib/recall.js";

const TABS = [
  ["topics", "Topics"],
  ["insights", "Insights"],
  ["sim", "Simulate"],
  ["ranks", "Ranks"],
];

export default function Home() {
  const { topics, stats, homeTab, setHomeTab, startReview, openSettings, clearPickers } = useApp();
  const queue = getDueCards(topics, { newAllowance: newAllowance(stats) });
  const dueNow = queue.filter(c => c.srs && c.srs.state !== "new").length;
  const newNow = queue.length - dueNow;

  return (
    <div className="af" onClick={clearPickers}>
      <Orbs/><XpPopups/><LevelUpModal/>
      <div className="scr fu">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span className="workspace-brand">AERO<span>FLASH</span></span>
          <button className="gear-btn" onClick={(e) => { e.stopPropagation(); openSettings(); }} title="Settings">⚙</button>
        </div>
        <XpStrip/>
        <button className="review-cta" onClick={startReview} disabled={queue.length === 0}>
          <span className="review-cta-icon">🧠</span>
          <span className="review-cta-main">
            <span className="review-cta-title" style={{ display: "block" }}>
              {queue.length === 0 ? "All caught up!" : "Review Now"}
            </span>
            <span className="review-cta-sub" style={{ display: "block" }}>
              {queue.length === 0
                ? "Nothing due — add cards or come back later"
                : `${dueNow} due${newNow > 0 ? ` · ${newNow} new` : ""} · up to ${RECALL_SESSION_LIMIT} written questions this session`}
            </span>
          </span>
          {queue.length > 0 && <span className="review-cta-count">{queue.length}</span>}
        </button>
        <div className="nav-tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={`nav-tab${homeTab === id ? " on" : ""}`} onClick={() => setHomeTab(id)}>{label}</button>
          ))}
        </div>
        {homeTab === "topics"   && <TopicsTab/>}
        {homeTab === "insights" && <InsightsTab/>}
        {homeTab === "sim"      && <SimTab/>}
        {homeTab === "ranks"    && <RanksTab/>}
      </div>
    </div>
  );
}

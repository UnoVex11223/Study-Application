import { useApp } from "./context.js";
import { RANKS, getLevel } from "../lib/xp.js";

export default function RanksTab() {
  const { xp } = useApp();
  const level = getLevel(xp);
  return (
    <div className="roadmap fu">
      <div style={{ marginBottom: 28 }}>
        <div className="ptitle">Rank Roadmap</div>
        <div className="psub">Your journey from Newcomer to Transcendent</div>
      </div>
      {RANKS.map((r, i) => {
        const done  = xp >= r.xpNeeded;
        const isCur = r.level === level;
        const isLast = i === RANKS.length - 1;
        const next  = RANKS[i + 1];
        const segPct = isCur ? Math.min(((xp - r.xpNeeded) / ((next?.xpNeeded ?? r.xpNeeded + 200) - r.xpNeeded)) * 100, 100) : done ? 100 : 0;
        return (
          <div key={r.level} className="rm-row">
            <div className="rm-line-col">
              {i > 0 && <div className="rm-vline" style={{ background: xp >= r.xpNeeded ? `linear-gradient(to bottom,${RANKS[i-1].color},${r.color})` : "rgba(255,255,255,.12)", height: 20, flex: "none" }}/>}
              <div className={`rm-node${done ? " done" : ""}${isCur ? " cur" : ""}`} style={{ background: done || isCur ? r.color : "rgba(255,255,255,.1)" }}>
                <span style={{ fontSize: 18 }}>{done || isCur ? r.emoji : "🔒"}</span>
              </div>
              {!isLast && <div className="rm-vline" style={{ background: done && xp >= (next?.xpNeeded ?? 9999) ? `linear-gradient(to bottom,${r.color},${next?.color ?? r.color})` : "rgba(255,255,255,.12)", flex: 1, minHeight: 20 }}/>}
            </div>
            <div className={`rm-card${done ? " done" : ""}${isCur ? " cur" : ""}${!done && !isCur ? " rm-lock" : ""}`}>
              <div className="rm-badge">{r.badge}</div>
              <div className="rm-rank-name" style={{ color: done || isCur ? r.color : "rgba(255,255,255,.5)" }}>{r.emoji} {r.name}</div>
              <div className="rm-rank-xp"   style={{ color: done || isCur ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.3)" }}>{r.xpNeeded === 0 ? "Starting rank" : `${r.xpNeeded.toLocaleString()} XP required`}</div>
              {isCur && <div className="cur-tag">Current Rank</div>}
              <div className="rm-rank-desc" style={{ color: done || isCur ? "rgba(255,255,255,.65)" : "rgba(255,255,255,.3)" }}>{r.desc}</div>
              {isCur && next && (
                <>
                  <div className="rm-prog" style={{ marginTop: 12 }}><div className="rm-prog-fill" style={{ width: `${segPct}%` }}/></div>
                  <div style={{ color: "rgba(255,255,255,.5)", fontSize: 11, fontWeight: 700, marginTop: 5 }}>
                    {(xp - r.xpNeeded).toLocaleString()} / {(next.xpNeeded - r.xpNeeded).toLocaleString()} XP to {next.name}
                  </div>
                </>
              )}
              {done && !isCur && <div style={{ marginTop: 8, color: "rgba(100,255,180,.7)", fontSize: 12, fontWeight: 800 }}>Completed</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

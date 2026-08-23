import { useState } from "react";
import { useApp } from "./context.js";
import { dueForecast, isMature } from "../lib/fsrs.js";
import { retention, todayStr } from "../lib/storage.js";
import { cardPromptText } from "../lib/cards.js";

const DAY_MS = 864e5;

function heatLevel(n) {
  if (n === 0) return 0;
  if (n < 5) return 1;
  if (n < 15) return 2;
  if (n < 30) return 3;
  return 4;
}

function Heatmap({ daily }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Pad back to the previous Sunday so weekday rows line up, ~17 weeks total.
  const start = new Date(today.getTime() - 118 * DAY_MS);
  start.setDate(start.getDate() - start.getDay());
  const cells = [];
  for (let d = new Date(start); d <= today; d = new Date(d.getTime() + DAY_MS)) {
    const key = todayStr(d);
    const n = daily[key]?.reviews ?? 0;
    cells.push(
      <div key={key} className={`heat-cell${heatLevel(n) ? ` heat-${heatLevel(n)}` : ""}`}
        title={`${key}: ${n} review${n !== 1 ? "s" : ""}`}/>
    );
  }
  return <div className="heatmap">{cells}</div>;
}

function Forecast({ topics }) {
  const [now] = useState(() => Date.now());
  const counts = dueForecast(topics, 7, now);
  const max = Math.max(...counts, 1);
  const dayLabel = (i) => i === 0 ? "Today" : i === 1 ? "Tmrw" : new Date(now + i * DAY_MS).toLocaleDateString(undefined, { weekday: "short" });
  return (
    <div className="forecast">
      {counts.map((n, i) => (
        <div key={i} className="fc-col">
          <span className="fc-num">{n > 0 ? n : ""}</span>
          <div className="fc-bar" style={{ height: `${Math.max((n / max) * 70, n > 0 ? 6 : 3)}px` }}/>
          <span className="fc-day">{dayLabel(i)}</span>
        </div>
      ))}
    </div>
  );
}

export default function InsightsTab() {
  const { topics, stats, log, goTopic } = useApp();
  const today = todayStr();
  const isToday = stats.lastStudyDate === today;
  const ret = retention(log, 30);
  const dueNow = topics.reduce((s, t) => s + t.cards.filter(c => c.srs && c.srs.state !== "new" && c.srs.due != null && c.srs.due <= Date.now()).length, 0);

  const topicMastery = topics
    .filter(t => t.cards.length > 0)
    .map(t => ({ ...t, mastery: t.cards.filter(isMature).length / t.cards.length }))
    .sort((a, b) => b.mastery - a.mastery);

  const leeches = topics
    .flatMap(t => t.cards.filter(c => (c.srs?.lapses ?? 0) >= 4).map(c => ({ ...c, topicName: t.name })))
    .sort((a, b) => b.srs.lapses - a.srs.lapses)
    .slice(0, 8);

  const totalReviews = Object.values(log.daily).reduce((s, d) => s + d.reviews, 0);

  return (
    <div className="fu">
      <div style={{ marginBottom: 20 }}>
        <div className="ptitle">Insights</div>
        <div className="psub">Your memory, measured</div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-num">{stats.streak}</div><div className="stat-lbl">Day Streak</div></div>
        <div className="stat-card"><div className="stat-num">{isToday ? stats.todayCount : 0}</div><div className="stat-lbl">Today</div></div>
        <div className="stat-card"><div className="stat-num">{dueNow}</div><div className="stat-lbl">Due Now</div></div>
        <div className="stat-card"><div className="stat-num">{ret == null ? "—" : `${Math.round(ret * 100)}%`}</div><div className="stat-lbl">Retention 30d</div></div>
      </div>

      <div className="section-title">Activity — last 17 weeks</div>
      <div className="glass" style={{ padding: "14px 16px", marginBottom: 24, borderRadius: 18 }}>
        <Heatmap daily={log.daily}/>
        <div style={{ color: "rgba(255,255,255,.5)", fontSize: 11, fontWeight: 600 }}>{totalReviews.toLocaleString()} reviews logged</div>
      </div>

      <div className="section-title">Upcoming reviews</div>
      <div className="glass" style={{ padding: "10px 14px", marginBottom: 24, borderRadius: 18 }}>
        <Forecast topics={topics}/>
      </div>

      {topicMastery.length > 0 && (
        <>
          <div className="section-title">Mastery by topic</div>
          {topicMastery.map(t => (
            <div key={t.id} className="acc-row" onClick={() => goTopic(t.id)}>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, minWidth: 110, flex: 1 }}>{t.name}</div>
              <div className="acc-bar-bg">
                <div className="acc-bar-fill" style={{ width: `${Math.round(t.mastery * 100)}%`, background: t.mastery >= 0.7 ? "#6effc8" : t.mastery >= 0.3 ? "#ffd200" : "#ff8888" }}/>
              </div>
              <div style={{ color: "rgba(255,255,255,.8)", fontWeight: 800, fontSize: 13, minWidth: 44, textAlign: "right" }}>{Math.round(t.mastery * 100)}%</div>
            </div>
          ))}
          <div style={{ color: "rgba(255,255,255,.45)", fontSize: 11, fontWeight: 600, margin: "6px 0 24px" }}>
            Mastered = scheduled 3+ weeks out. New cards count against mastery until learned.
          </div>
        </>
      )}

      {leeches.length > 0 && (
        <>
          <div className="section-title">Leeches — cards you keep forgetting</div>
          {leeches.map(c => (
            <div key={c.id} className="weak-row">
              <div style={{ flex: 1 }}>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{cardPromptText(c)}</div>
                <div style={{ color: "rgba(255,255,255,.5)", fontSize: 11, fontWeight: 600, marginTop: 2 }}>{c.topicName}</div>
              </div>
              <div style={{ color: "#ff9090", fontWeight: 900, fontSize: 13, minWidth: 28, textAlign: "right" }}>{c.srs.lapses}×</div>
            </div>
          ))}
          <div style={{ color: "rgba(255,255,255,.45)", fontSize: 11, fontWeight: 600, marginTop: 6 }}>
            Tip: a card missed this often is usually badly written — try rewriting it as something smaller and more concrete.
          </div>
        </>
      )}

      {totalReviews === 0 && (
        <div className="glass" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📈</div>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 800 }}>No reviews yet</div>
          <div style={{ color: "rgba(255,255,255,.55)", fontSize: 14, fontWeight: 600, marginTop: 6 }}>
            Start a Review session and your stats will build up here
          </div>
        </div>
      )}
    </div>
  );
}

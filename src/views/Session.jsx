// A study session: works through a queue of tasks, re-asks misses later in the
// same session, and inserts a quick "foundation check" on a shaky prerequisite
// when you miss something that builds on it.

import { useEffect, useState } from "react";
import { useStore } from "../state/store.jsx";
import { Bar } from "../ui/ui.jsx";
import { useNav, useKey } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import TaskView from "./TaskView.jsx";
import { index } from "../lib/model.js";
import { conceptMastery } from "../lib/mastery.js";
import { buildPlan, pickItem } from "../lib/planner.js";
import { aiAvailable } from "../lib/ai.js";
import { dayKey, formatMinutes } from "../lib/time.js";
import { RATING } from "../lib/fsrs.js";
import { play } from "../ui/sound.js";

const MAX_FOUNDATION = 3;
const MAX_REQUEUE = 2;

function foundationFor(state, conceptId, queue, from) {
  const ix = index(state);
  const upcoming = new Set(queue.slice(from).map(t => t.conceptId));
  let best = null;
  for (const e of ix.prereqsOf[conceptId] || []) {
    if ((e.confidence ?? 1) < 0.6 || upcoming.has(e.from)) continue;
    const m = conceptMastery(state, e.from);
    if (!m.started) continue;
    const weakness = m.status === "slipping" ? 2 : (1 - (m.memory ?? 0.5));
    if (weakness < 0.12) continue;
    if (!best || weakness > best.weakness) best = { id: e.from, weakness };
  }
  if (!best) return null;
  const c = ix.concept[best.id];
  const item = pickItem(ix, c);
  if (!item) return null;
  return { itemId: item.id, conceptId: c.id, courseId: c.courseId, kind: "foundation", estSec: 40 };
}

export default function Session({ tasks: initial, mode = "session", title = "Today's session", daily = false }) {
  const { state, act } = useStore();
  const nav = useNav();
  const [queue, setQueue] = useState(initial);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState([]);
  const [aiReady, setAiReady] = useState(false);
  const [foundations, setFoundations] = useState(0);
  const [snapshot] = useState(() => state); // lapses/mastery before this session, for the summary

  useEffect(() => { aiAvailable().then(setAiReady); }, []);

  const ix = index(state);
  const task = queue[idx];
  const done = idx >= queue.length;
  const totalEst = queue.reduce((s, t) => s + (t.estSec || 60), 0);
  const doneEst = queue.slice(0, idx).reduce((s, t) => s + (t.estSec || 60), 0);

  const exit = () => nav.endSession();
  // A low chime when the last question is done (if sounds are on).
  const answered = results.length > 0;
  useEffect(() => { if (done && answered) play("chime"); }, [done, answered]);
  useKey((e) => { if (e.key === "Escape" && !document.querySelector(".modal")) exit(); }, []);

  const onDone = (r) => {
    act("attempt", { itemId: task.itemId, mode, ...r });
    setResults(res => [...res, { ...r, task }]);
    let next = queue;
    if (r.rating === RATING.AGAIN) {
      const times = queue.filter(t => t.itemId === task.itemId).length;
      if (times <= MAX_REQUEUE) {
        const at = Math.min(idx + 4, queue.length);
        next = [...next.slice(0, at), { ...task, kind: "requeue" }, ...next.slice(at)];
      }
      if (mode === "session" && foundations < MAX_FOUNDATION && task.kind !== "foundation") {
        const f = foundationFor(state, task.conceptId, next, idx + 1);
        if (f) {
          next = [...next.slice(0, idx + 1), f, ...next.slice(idx + 1)];
          setFoundations(n => n + 1);
        }
      }
    }
    setQueue(next);
    setIdx(i => i + 1);
  };

  // A reported question leaves the session (and future sessions) without a rating.
  const onReport = (reason) => {
    act("item/flag", { id: task.itemId, reason });
    setQueue(q => [...q.slice(0, idx + 1), ...q.slice(idx + 1).filter(t => t.itemId !== task.itemId)]);
    setResults(res => [...res, { task, reported: true }]);
    setIdx(i => i + 1);
  };

  const keepGoing = () => {
    const today = dayKey(Date.now(), state.settings.rolloverHour);
    const cur = state.days?.[today]?.extraSec || 0;
    const predicted = { ...state, days: { ...state.days, [today]: { extraSec: cur + 300 } } };
    const plan = buildPlan(predicted);
    act("day/extra", { sec: 300 });
    if (plan.tasks.length) nav.startSession({ tasks: plan.tasks, mode: "session", daily: true });
    else exit();
  };

  const summarize = () => {
    const firstTry = new Map();
    for (const r of results) if (!r.reported && !firstTry.has(r.task.itemId)) firstTry.set(r.task.itemId, r);
    const reported = results.filter(r => r.reported).length;
    const firsts = [...firstTry.values()];
    const unaided = firsts.filter(r => r.verdict === "correct" && !r.aided).length;
    const recovered = [], missed = [], started = [];
    const sIx = index(snapshot);
    for (const r of firsts) {
      const c = ix.concept[r.task.conceptId];
      if (!c) continue;
      const before = sIx.concept[c.id]?.srs?.lapses || 0;
      if (r.verdict === "correct" && !r.aided && before > 0 && r.task.kind !== "new") recovered.push(c);
      if (r.verdict !== "correct") missed.push(c);
      if (r.task.kind === "new") started.push(c);
    }
    let more = 0;
    if (daily) {
      const today = dayKey(nav.now, state.settings.rolloverHour);
      const cur = state.days?.[today]?.extraSec || 0;
      more = buildPlan({ ...state, days: { ...state.days, [today]: { extraSec: cur + 300 } } }).tasks.length;
    }
    return { count: firsts.length, reported, unaided, recovered, missed, started, more, minutes: formatMinutes(results.reduce((s, r) => s + Math.min(r.ms || 0, 300e3), 0) / 1000) };
  };
  const summary = done ? summarize() : null;

  const item = task && ix.item[task.itemId];
  const concept = item && ix.concept[item.conceptId];


  return (
    <div className="session" role="dialog" aria-label={title}>
      <div className="session-top">
        <button className="btn btn-quiet" onClick={exit}><Icon name="x" size={16}/>{done ? "Close" : "End session"}</button>
        <div className="session-progress">
          <span className="small muted num">{Math.min(idx + (done ? 0 : 1), queue.length)} of {queue.length}</span>
          <Bar value={queue.length ? doneEst / totalEst : 1}/>
          <span className="small muted num">{done ? "Done" : `about ${formatMinutes(Math.max(0, totalEst - doneEst))} left`}</span>
        </div>
        <span className="small muted" style={{ minWidth: 120, textAlign: "right" }}>{title}</span>
      </div>
      <div className="session-body">
        <div className="session-inner">
          {!done && (!item || !concept) && (
            <div className="panel empty"><h3>This question was deleted</h3><button className="btn" onClick={() => setIdx(i => i + 1)}>Skip</button></div>
          )}
          {!done && item && concept && (
            <TaskView
              key={`${idx}-${task.itemId}`}
              task={task} item={item} concept={concept}
              section={ix.section[concept.sectionId]} course={ix.course[concept.courseId]}
              aiReady={aiReady} retention={state.settings.retention} onDone={onDone} onReport={onReport}
            />
          )}
          {done && summary && (
            <div className="enter">
              <article className="hero">
                <div className="row"><span className="hero-label grow">Session complete</span><span className="muted small">{summary.minutes}</span></div>
                <div className="summary-grid">
                  <div><div className="v">{summary.count}</div><div className="muted small">questions</div></div>
                  <div><div className="v">{summary.count ? Math.round((summary.unaided / summary.count) * 100) : 0}%</div><div className="muted small">right first time, no help</div></div>
                  <div><div className="v">{summary.started.length}</div><div className="muted small">new concepts started</div></div>
                </div>
                {summary.recovered.length > 0 && (
                  <p style={{ marginBottom: 10 }}><strong>Recovered:</strong> {summary.recovered.map(c => c.name).join(", ")}. These had slipped before and you got them back.</p>
                )}
                {summary.missed.length > 0 && (
                  <p style={{ marginBottom: 10 }}><strong>Coming back soon:</strong> {summary.missed.map(c => c.name).join(", ")}.</p>
                )}
                {summary.reported > 0 && <p className="muted" style={{ marginBottom: 10 }}>{summary.reported} reported question{summary.reported === 1 ? " is" : "s are"} waiting on the Progress page to be fixed or restored.</p>}
                {summary.count === 0 && !summary.reported && <p className="muted">Nothing was answered this time.</p>}
              </article>
              <div className="row" style={{ marginTop: 22 }}>
                <button className="btn btn-primary btn-lg" onClick={exit} autoFocus>Done</button>
                {daily && summary.more > 0 && (
                  <button className="btn btn-lg" onClick={keepGoing}>Study 5 more minutes</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A study session: works through a queue of tasks, re-asks misses later in the
// same session, and inserts a quick "foundation check" on a shaky prerequisite
// when you miss something that builds on it.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { Bar } from "../ui/ui.jsx";
import { useNav, useKey } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import TaskView from "./TaskView.jsx";
import { index, ABILITY_KEYS } from "../lib/model.js";
import { conceptMastery } from "../lib/mastery.js";
import { buildPlan, pickItem } from "../lib/planner.js";
import { aiAvailable, freshVersion } from "../lib/ai.js";
import { typicalPace, wantsFreshVersion, MISS_REASONS } from "../lib/training.js";
import { dayKey } from "../lib/time.js";
import { RATING } from "../lib/fsrs.js";
import { play } from "../ui/sound.js";

const MAX_FOUNDATION = 3;
const MAX_REQUEUE = 2;
const EXTRA = 5; // questions added by "5 more" after the day's are done
const FRESH_AHEAD = 3; // fresh versions are written this many questions ahead

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
  return { itemId: item.id, conceptId: c.id, courseId: c.courseId, kind: "foundation" };
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
  const [startedAt] = useState(() => Date.now());
  const [fresh, setFresh] = useState({}); // itemId → { status: pending | ready | failed, question }
  const pretest = mode === "pretest";

  useEffect(() => { aiAvailable().then(setAiReady); }, []);

  const ix = index(state);
  const task = queue[idx];
  const done = idx >= queue.length;

  // Fresh versions of apply questions you've seen, written a few questions ahead so they're ready when you get there.
  const freshOn = aiReady && !pretest && state.settings.freshVersions !== false;
  const requested = useRef(new Set());
  useEffect(() => {
    if (!freshOn) return;
    const ix2 = index(state);
    for (const t of queue.slice(idx, idx + FRESH_AHEAD + 1)) {
      const it = ix2.item[t.itemId];
      if (!it || requested.current.has(it.id) || !wantsFreshVersion(ix2, t, it)) continue;
      requested.current.add(it.id);
      freshVersion({ item: it, concept: ix2.concept[it.conceptId] })
        .then(r => setFresh(f => ({ ...f, [it.id]: r.ok ? { status: "ready", question: r.question } : { status: "failed" } })));
    }
  }, [freshOn, idx, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  // How long you usually take for a right answer of each kind (for spotting slow ones).
  const attempts = state.attempts;
  const paces = useMemo(() => Object.fromEntries(ABILITY_KEYS.map(a => [a, typicalPace(attempts, a)])), [attempts]);

  const exit = () => nav.endSession();
  // A low chime when the last question is done (if sounds are on).
  const answered = results.length > 0;
  useEffect(() => { if (done && answered) play("chime"); }, [done, answered]);
  useKey((e) => { if (e.key === "Escape" && !document.querySelector(".modal")) exit(); }, []);

  const onDone = (r) => {
    // A pretest is asked before you've studied the material: nothing is logged or scheduled.
    if (!pretest) act("attempt", { itemId: task.itemId, mode, requeue: task.kind === "requeue", ...r });
    setResults(res => [...res, { ...r, task }]);
    let next = queue;
    if (r.rating === RATING.AGAIN) {
      const times = queue.filter(t => t.itemId === task.itemId).length;
      if (times <= MAX_REQUEUE) {
        // A miss you were sure about comes back a little sooner.
        const at = Math.min(idx + (r.sure ? 2 : 4), queue.length);
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

  // After the day's questions: a few more, if there's anything worth asking.
  const withExtra = (st) => {
    const today = dayKey(nav.now, st.settings.rolloverHour);
    return { ...st, days: { ...st.days, [today]: { ...st.days?.[today], extra: (st.days?.[today]?.extra || 0) + EXTRA } } };
  };
  const keepGoing = () => {
    const plan = buildPlan(withExtra(state), { now: Date.now() });
    act("day/extra", { count: EXTRA });
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
    const more = daily ? buildPlan(withExtra(state)).tasks.length : 0;
    // Prerequisites that got partial review credit from answers that built on them.
    const strengthened = state.concepts.filter(c => (c.srs?.implicitAt ?? 0) >= startedAt && sIx.concept[c.id]?.srs !== c.srs);
    const sureMissed = firsts.filter(r => r.sure && r.verdict !== "correct").map(r => ix.concept[r.task.conceptId]).filter(Boolean);
    const reasons = {};
    for (const r of results) if (r.reason) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    const deeper = results.filter(r => r.probe);
    return { count: firsts.length, reported, unaided, recovered, missed, started, more, strengthened, sureMissed, reasons, deeper };
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
          <Bar value={queue.length ? Math.min(idx, queue.length) / queue.length : 1}/>
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
              pace={paces[item.ability] ?? null} pretest={pretest}
              variant={!pretest && fresh[item.id]?.status === "ready" ? fresh[item.id].question : null}
            />
          )}
          {done && summary && pretest && (
            <div className="enter">
              <article className="hero">
                <div className="hero-label">Pretest done</div>
                <p style={{ margin: "14px 0 10px" }}>
                  {summary.unaided} of {summary.count} right before studying.
                  {" "}Getting them wrong is fine: trying first makes the material stick better when you read it.
                </p>
                <p className="muted small" style={{ margin: 0 }}>Nothing was scheduled. These ideas come up in your sessions once you've added or read the chapter, like any new material.</p>
              </article>
              <div className="row" style={{ marginTop: 22 }}>
                <button className="btn btn-primary btn-lg" onClick={exit} autoFocus>Done</button>
              </div>
            </div>
          )}
          {done && summary && !pretest && (
            <div className="enter">
              <article className="hero">
                <div className="hero-label">Session complete</div>
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
                {summary.sureMissed.length > 0 && (
                  <p style={{ marginBottom: 10 }}><strong>You were sure about:</strong> {summary.sureMissed.map(c => c.name).join(", ")}. Confident mistakes are worth a second look.</p>
                )}
                {summary.strengthened.length > 0 && (
                  <p className="muted" style={{ marginBottom: 10 }}>Also reviewed along the way: {summary.strengthened.map(c => c.name).join(", ")}, through answers that built on them.</p>
                )}
                {Object.keys(summary.reasons).length > 0 && (
                  <p className="muted small" style={{ marginBottom: 10 }}>
                    Why you missed: {Object.entries(summary.reasons).map(([k, n]) => `${n} ${MISS_REASONS[k]?.label.toLowerCase() ?? k}`).join(", ")}.
                  </p>
                )}
                {summary.deeper.length > 0 && (
                  <p className="muted small" style={{ marginBottom: 10 }}>
                    Went deeper {summary.deeper.length} time{summary.deeper.length === 1 ? "" : "s"}: held up through {Math.max(...summary.deeper.map(r => r.probe.depth))} follow-up{Math.max(...summary.deeper.map(r => r.probe.depth)) === 1 ? "" : "s"} at most.
                  </p>
                )}
                {summary.reported > 0 && <p className="muted" style={{ marginBottom: 10 }}>{summary.reported} reported question{summary.reported === 1 ? " is" : "s are"} waiting on Today to be fixed or restored.</p>}
                {summary.count === 0 && !summary.reported && <p className="muted">Nothing was answered this time.</p>}
              </article>
              <div className="row" style={{ marginTop: 22 }}>
                <button className="btn btn-primary btn-lg" onClick={exit} autoFocus>Done</button>
                {daily && summary.more > 0 && (
                  <button className="btn btn-lg" onClick={keepGoing}>{Math.min(EXTRA, summary.more)} more</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

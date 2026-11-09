// A study session: works through a queue of tasks, re-asks misses later in the
// same session, and inserts a quick "foundation check" on a shaky prerequisite
// when you miss something that builds on it. A new concept is taught first (its
// lesson), then asked its first steps in a row until one is missed
// (lib/ladder.js). It slides up over the whole app.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import { useKey } from "../../ui/hooks.js";
import Icon from "../../ui/Icon.jsx";
import { Bar } from "../../ui/display.jsx";
import { EmptyState } from "../../ui/layout.jsx";
import { index, ABILITY_KEYS } from "../../lib/model.js";
import { conceptMastery } from "../../lib/mastery.js";
import { buildPlan, pickItem } from "../../lib/planner.js";
import { introNext, ladderOf } from "../../lib/ladder.js";
import { aiAvailable, freshVersion } from "../../lib/ai.js";
import { typicalPace, wantsFreshVersion } from "../../lib/training.js";
import { dayKey } from "../../lib/time.js";
import { RATING } from "../../lib/fsrs.js";
import { play } from "../../ui/sound.js";
import { xpFor, totalXp, levelFor } from "../../lib/xp.js";
import TaskView from "./TaskView.jsx";
import LessonCard from "./LessonCard.jsx";
import { SessionSummary, PretestSummary } from "./SessionSummary.jsx";
import MasteryTest from "./MasteryTest.jsx";

const MAX_FOUNDATION = 3;
const MAX_REQUEUE = 2;
const EXTRA = 5; // questions added by "5 more" after the day's are done
const FRESH_AHEAD = 3; // fresh versions are written this many questions ahead

/** A shaky prerequisite of this concept worth a quick check, if there is one. */
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

/** What the session did, for the summary at the end. */
function summarize({ results, state, snapshot, startedAt }) {
  const ix = index(state);
  const firstTry = new Map();
  for (const r of results) if (!r.reported && !firstTry.has(r.task.itemId)) firstTry.set(r.task.itemId, r);
  const firsts = [...firstTry.values()];
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
  const reasons = {};
  for (const r of results) if (r.reason) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  // Steps climbed: answered right, without help, for the first time (or the first time since missing them).
  const climbedBy = new Map();
  for (const r of firsts) {
    if (r.verdict !== "correct" || r.aided || sIx.itemStats[r.task.itemId]?.lastOk) continue;
    const c = ix.concept[r.task.conceptId];
    if (!c) continue;
    const steps = ladderOf(ix, c.id);
    const at = steps.findIndex(i => i.id === r.task.itemId) + 1;
    const prev = climbedBy.get(c.id);
    climbedBy.set(c.id, { concept: c, count: (prev?.count || 0) + 1, top: Math.max(prev?.top || 0, at), total: steps.length });
  }
  return {
    count: firsts.length,
    reported: results.filter(r => r.reported).length,
    unaided: firsts.filter(r => r.verdict === "correct" && !r.aided).length,
    recovered, missed, started, reasons,
    climbed: [...climbedBy.values()],
    steps: [...climbedBy.values()].reduce((n, c) => n + c.count, 0),
    // Prerequisites that got partial review credit from answers that built on them.
    strengthened: state.concepts.filter(c => (c.srs?.implicitAt ?? 0) >= startedAt && sIx.concept[c.id]?.srs !== c.srs),
    sureMissed: firsts.filter(r => r.sure && r.verdict !== "correct").map(r => ix.concept[r.task.conceptId]).filter(Boolean),
    deeper: results.filter(r => r.probe),
  };
}

/** A study session, or the mastery test (mode "test"), which has its own screen. */
export default function Session(props) {
  return props.mode === "test" ? <MasteryTest tasks={props.tasks}/> : <StudySession {...props}/>;
}

function StudySession({ tasks: initial, mode = "session", title = "Today's session", daily = false }) {
  const { state, act } = useStore();
  const nav = useNav();
  const [queue, setQueue] = useState(initial);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState([]);
  const [aiReady, setAiReady] = useState(false);
  const [foundations, setFoundations] = useState(0);
  const [snapshot] = useState(() => state); // lapses and mastery before this session, for the summary
  const [startedAt] = useState(() => Date.now());
  const [fresh, setFresh] = useState({}); // itemId → { status: pending | ready | failed, question }
  const [taught, setTaught] = useState(() => new Set()); // concepts whose lesson you've seen in this session
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
  // A session that took you up a level ends on the level sound instead.
  const levelBefore = useRef(levelFor(totalXp(snapshot.attempts)).level);
  useEffect(() => {
    if (!done || !answered) return;
    play(levelFor(totalXp(state.attempts)).level > levelBefore.current ? "level" : "chime");
  }, [done, answered]); // eslint-disable-line react-hooks/exhaustive-deps
  useKey((e) => { if (e.key === "Escape" && !document.querySelector(".modal")) exit(); }, []);

  const onDone = (r) => {
    // A pretest is asked before you've studied the material: nothing is logged or scheduled.
    if (!pretest) act("attempt", { itemId: task.itemId, mode, requeue: task.kind === "requeue", climb: task.kind === "climb", ...r });
    setResults(res => [...res, { ...r, task }]);
    let next = queue;
    // Introducing a concept: a right answer goes straight on to its next step.
    if (!pretest && (task.kind === "new" || task.kind === "climb") && r.verdict === "correct" && !r.aided) {
      const asked = task.kind === "climb" ? task.step ?? 2 : 1;
      const up = introNext(ix, task.conceptId, task.itemId, asked);
      if (up && !queue.slice(idx + 1).some(t => t.itemId === up.id)) {
        next = [...next.slice(0, idx + 1), { itemId: up.id, conceptId: task.conceptId, courseId: task.courseId, kind: "climb", step: asked + 1 }, ...next.slice(idx + 1)];
      }
    }
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

  const summary = done ? { ...summarize({ results, state, snapshot, startedAt }), xp: results.reduce((n, r) => n + (pretest || r.reported ? 0 : xpFor({ verdict: r.verdict, aided: r.aided })), 0), xpTotal: totalXp(state.attempts) } : null;
  const more = done && daily ? Math.min(EXTRA, buildPlan(withExtra(state)).tasks.length) : 0;
  const item = task && ix.item[task.itemId];
  const concept = item && ix.concept[item.conceptId];
  const position = Math.min(idx + (done ? 0 : 1), queue.length);
  // Teach, then test: a new concept's lesson comes before its first question.
  const teach = Boolean(!done && concept && !pretest && task.kind === "new" && !taught.has(concept.id) && (concept.lesson || concept.summary));

  return (
    <div className="session" role="dialog" aria-label={title}>
      <div className="session-top">
        <button className="btn btn-quiet btn-icon" onClick={exit} aria-label={done ? "Close" : "End session"} title={done ? "Close" : "End session"}><Icon name="x"/></button>
        <div className="session-progress" aria-label={`${position} of ${queue.length}`}>
          <Bar value={queue.length ? Math.min(idx, queue.length) / queue.length : 1}/>
        </div>
        <span/>
      </div>
      <div className="session-body">
        <div className="session-inner">
          {!done && (!item || !concept) && (
            <EmptyState title="This question was deleted" actions={<button className="btn" onClick={() => setIdx(i => i + 1)}>Skip</button>}/>
          )}
          {teach && (
            <LessonCard key={`lesson-${concept.id}`} concept={concept} onStart={() => setTaught(s => new Set(s).add(concept.id))}/>
          )}
          {!done && item && concept && !teach && (
            <TaskView
              key={`${idx}-${task.itemId}`}
              item={item} concept={concept}
              aiReady={aiReady} onDone={onDone} onReport={onReport}
              pace={paces[item.ability] ?? null} pretest={pretest}
              variant={!pretest && fresh[item.id]?.status === "ready" ? fresh[item.id].question : null}
            />
          )}
          {summary && (pretest
            ? <PretestSummary summary={summary} onDone={exit}/>
            : <SessionSummary summary={summary} more={more} onDone={exit} onMore={keepGoing}/>)}
        </div>
      </div>
    </div>
  );
}

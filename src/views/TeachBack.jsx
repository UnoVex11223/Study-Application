// Teach-back: explain a whole section from memory, as if teaching it, then see
// which concepts you covered. Covered concepts that were due get credit; missed
// or wrong ones are brought forward to your next session.

import { useEffect, useState } from "react";
import { useStore } from "../state/store.jsx";
import { Notice, Spinner, Figures, Figure } from "../ui/ui.jsx";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import Markdown from "../ui/Markdown.jsx";
import { index } from "../lib/model.js";
import { conceptMastery } from "../lib/mastery.js";
import { aiAvailable, teachBackWithAI } from "../lib/ai.js";
import { pickItem } from "../lib/planner.js";
import { RATING } from "../lib/fsrs.js";

const STATUS_META = {
  covered: { label: "Covered", tone: "good", mark: "check" },
  partial: { label: "Partly", tone: "warn", mark: "check" },
  missing: { label: "Not mentioned", tone: "muted", mark: "x" },
  wrong: { label: "Incorrect", tone: "bad", mark: "x" },
};

function keyPoints(ix, conceptId) {
  const items = ix.itemsByConcept[conceptId] || [];
  const explain = items.find(i => i.ability === "explain" && i.points?.length) || items.find(i => i.points?.length);
  if (explain) return explain.points.slice(0, 3);
  const c = ix.concept[conceptId];
  return [c.summary || c.name];
}

export default function TeachBack({ courseId, sectionId: initialSection }) {
  const { state, act } = useStore();
  const nav = useNav();
  const ix = index(state);
  const course = ix.course[courseId];
  const sections = (ix.sectionsByCourse[courseId] || []).filter(s => !s.locked);
  const [sectionId, setSectionId] = useState(initialSection ?? sections[0]?.id);
  const [text, setText] = useState("");
  const [showNames, setShowNames] = useState(false);
  const [phase, setPhase] = useState("write"); // write | grading | selfcheck | result
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [self, setSelf] = useState({});
  const [aiReady, setAiReady] = useState(false);
  const [applied, setApplied] = useState(null);

  useEffect(() => { aiAvailable().then(setAiReady); }, []);

  const section = ix.section[sectionId];
  const concepts = (ix.conceptsBySection[sectionId] || []).filter(c => !c.suspended);

  if (!course) return null;
  if (!section) {
    return <div className="page page-narrow"><button className="crumb" onClick={() => nav.go("course", { courseId })}><Icon name="back" size={14}/>{course.name}</button><p className="muted">Mark a chapter as read first; then you can teach it back.</p></div>;
  }

  const apply = (statuses) => {
    const now = nav.now;
    let credited = 0, forward = [];
    for (const c of concepts) {
      const st = statuses[c.id];
      const m = conceptMastery(state, c.id, now);
      if (!m.started) continue;
      const item = pickItem(ix, c);
      if (!item || !c.srs || c.srs.state === "new") continue;
      if (st === "covered") {
        if (c.srs.due != null && c.srs.due <= now) {
          act("attempt", { itemId: item.id, verdict: "correct", rating: RATING.GOOD, mode: "teachback", ms: 0 });
          credited++;
        }
      } else if (st === "wrong" || st === "missing") {
        forward.push(c.id);
        if (st === "wrong") act("attempt", { itemId: item.id, verdict: "incorrect", rating: null, mode: "teachback", ms: 0 });
      }
    }
    if (forward.length) act("concepts/bringForward", { ids: forward });
    setApplied({ credited, forward: forward.length });
  };

  const check = async () => {
    setError("");
    if (!aiReady) {
      setSelf(Object.fromEntries(concepts.map(c => [c.id, "missing"])));
      setPhase("selfcheck");
      return;
    }
    setPhase("grading");
    const res = await teachBackWithAI({
      title: `${course.name}: ${section.title}`,
      concepts: concepts.map(c => ({ id: c.id, name: c.name, points: keyPoints(ix, c.id) })),
      text,
    });
    if (!res.ok) {
      setError(`Automatic checking failed (${res.error}). Check it yourself below.`);
      setSelf(Object.fromEntries(concepts.map(c => [c.id, "missing"])));
      setPhase("selfcheck");
      return;
    }
    const statuses = Object.fromEntries(res.data.concepts.map(x => [x.id, x.status]));
    setResult({ ...res.data, statuses, notes: Object.fromEntries(res.data.concepts.map(x => [x.id, x.note])) });
    setPhase("result");
    if (!showNames) apply(statuses);
  };

  const finishSelf = () => {
    setResult({ statuses: self, notes: {}, errors: [], summary: "" });
    setPhase("result");
    if (!showNames) apply(self);
  };

  const counts = result ? Object.values(result.statuses).reduce((o, s) => ({ ...o, [s]: (o[s] || 0) + 1 }), {}) : {};

  return (
    <div className="page page-narrow">
      <button className="crumb" onClick={() => nav.go("course", { courseId })}><Icon name="back" size={14}/>{course.name}</button>
      <div className="page-head">
        <div>
          <h1>Teach it back</h1>
        </div>
      </div>

      {phase === "write" && (
        <>
          <div className="row" style={{ marginBottom: 16, gap: 12 }}>
            <select className="select" style={{ maxWidth: 360 }} value={sectionId} onChange={e => setSectionId(e.target.value)} aria-label="Section">
              {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
            <span className="muted small" style={{ whiteSpace: "nowrap" }}>{concepts.length} concepts</span>
            <div className="grow"/>
            <label className="row small" style={{ gap: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={showNames} onChange={e => setShowNames(e.target.checked)}/>Show concept names as prompts
            </label>
          </div>
          {showNames && (
            <div style={{ marginBottom: 14 }}>
              <Notice>{concepts.map(c => c.name).join(", ")}. With the list showing, this is practice only and won't change your schedule.</Notice>
            </div>
          )}
          <article className="q-card">
            <div className="q-head"><span className="q-ability">{section?.title}</span></div>
            <textarea className="card-input" value={text} onChange={e => setText(e.target.value)} autoFocus aria-label="Your explanation"
              style={{ minHeight: 320 }}/>
          </article>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={text.trim().length < 40 || !concepts.length} onClick={check}>Check my explanation</button>
            <span className="muted small">{text.trim() ? `${text.trim().split(/\s+/).length} words` : ""}</span>
          </div>
        </>
      )}

      {phase === "grading" && <div className="panel panel-pad progress-line"><Spinner/>Comparing your explanation with the section's key ideas…</div>}

      {phase === "selfcheck" && (
        <div className="panel panel-pad stack">
          {error && <Notice tone="warn" icon="alert">{error}</Notice>}
          {concepts.map(c => (
            <div key={c.id} className="item-card">
              <div className="row"><strong className="grow">{c.name}</strong>
                <div className="seg">
                  {["covered", "partial", "missing", "wrong"].map(s => (
                    <button key={s} className={self[c.id] === s ? "on" : ""} onClick={() => setSelf(x => ({ ...x, [c.id]: s }))}>{STATUS_META[s].label}</button>
                  ))}
                </div>
              </div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{keyPoints(ix, c.id).map((p, i) => <li key={i}><Markdown>{p}</Markdown></li>)}</ul>
            </div>
          ))}
          <div><button className="btn btn-primary" onClick={finishSelf}>Save check</button></div>
        </div>
      )}

      {phase === "result" && result && (
        <div className="stack" style={{ gap: 20 }}>
          <Figures>
            {["covered", "partial", "missing", "wrong"].map(s => (
              <Figure key={s} value={counts[s] || 0} label={STATUS_META[s].label.toLowerCase()}/>
            ))}
          </Figures>
          {result.summary && <p style={{ fontSize: 16, lineHeight: 1.6 }}>{result.summary}</p>}
          {result.errors?.length > 0 && result.errors.map((e, i) => <div key={i} className="misconception"><strong>Error:</strong> {e}</div>)}
          <div className="panel list">
            {concepts.map(c => {
              const st = result.statuses[c.id] || "missing";
              const meta = STATUS_META[st];
              return (
                <div key={c.id} className="list-row static" style={{ alignItems: "flex-start" }}>
                  <span className={`check-mark ${st === "covered" || st === "partial" ? "yes" : "no"}`} style={st === "partial" ? { background: "var(--warn-wash)", color: "var(--warn)" } : st === "missing" ? { background: "var(--surface-2)", color: "var(--ink-3)" } : undefined}>
                    <Icon name={meta.mark} size={12} stroke={2.6}/>
                  </span>
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}><span className="list-title">{c.name}</span><span className="muted small">{meta.label}</span></div>
                    {result.notes[c.id] && <div className="small muted">{result.notes[c.id]}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {applied && (
            <Notice tone="sky">
              {applied.credited ? `${applied.credited} due review${applied.credited === 1 ? "" : "s"} credited. ` : ""}
              {applied.forward ? `${applied.forward} concept${applied.forward === 1 ? "" : "s"} you missed will come up in your next session.` : ""}
              {!applied.credited && !applied.forward ? "Nothing needed to change in your schedule." : ""}
            </Notice>
          )}
          {showNames && <Notice>Concept names were showing, so your schedule wasn't changed.</Notice>}
          <div className="row">
            <button className="btn btn-primary" onClick={() => { setPhase("write"); setText(""); setResult(null); setApplied(null); }}>Explain another section</button>
            <button className="btn" onClick={() => nav.go("course", { courseId })}>Back to course</button>
          </div>
        </div>
      )}
    </div>
  );
}

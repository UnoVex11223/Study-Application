// Teach-back: explain a whole section from memory, as if teaching it, then see
// which concepts you covered. Covered concepts that were due get credit; missed
// or wrong ones are brought forward to your next session.

import { useEffect, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Markdown from "../../ui/Markdown.jsx";
import { Page, PageHeader } from "../../ui/layout.jsx";
import { Segmented } from "../../ui/controls.jsx";
import { Notice, Spinner, Figures, Figure, CheckMark } from "../../ui/display.jsx";
import { index } from "../../lib/model.js";
import { conceptMastery } from "../../lib/mastery.js";
import { aiAvailable, teachBackWithAI } from "../../lib/ai.js";
import { pickItem } from "../../lib/planner.js";
import { RATING } from "../../lib/fsrs.js";
import { plural } from "../../lib/format.js";

// How each concept fared, and the mark it gets.
const STATUS_META = {
  covered: { label: "Covered", mark: "yes" },
  partial: { label: "Partly", mark: "partly" },
  missing: { label: "Not mentioned", mark: "none" },
  wrong: { label: "Incorrect", mark: "no" },
};
const STATUS_OPTIONS = Object.entries(STATUS_META).map(([k, v]) => [k, v.label]);
const MIN_CHARS = 40;

/** What a concept's explanation should cover: its explain question's key points, or its summary. */
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
  const back = { label: course.name, onClick: () => nav.go("course", { courseId }) };
  if (!section) {
    return (
      <Page width="narrow">
        <PageHeader title="Teach it back" back={back}/>
        <p className="muted">Mark a chapter as read first; then you can teach it back.</p>
      </Page>
    );
  }

  // Credit covered concepts that were due; bring missed and wrong ones forward.
  const apply = (statuses) => {
    const now = nav.now;
    let credited = 0;
    const forward = [];
    for (const c of concepts) {
      const st = statuses[c.id];
      if (!conceptMastery(state, c.id, now).started) continue;
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

  const selfCheck = (why = "") => {
    setError(why);
    setSelf(Object.fromEntries(concepts.map(c => [c.id, "missing"])));
    setPhase("selfcheck");
  };

  const check = async () => {
    if (!aiReady) return selfCheck();
    setError("");
    setPhase("grading");
    const res = await teachBackWithAI({
      title: `${course.name}: ${section.title}`,
      concepts: concepts.map(c => ({ id: c.id, name: c.name, points: keyPoints(ix, c.id) })),
      text,
    });
    if (!res.ok) return selfCheck(`Automatic checking failed (${res.error}). Check it yourself below.`);
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

  const again = () => { setPhase("write"); setText(""); setResult(null); setApplied(null); };
  const counts = result ? Object.values(result.statuses).reduce((o, s) => ({ ...o, [s]: (o[s] || 0) + 1 }), {}) : {};
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <Page width="narrow">
      <PageHeader title="Teach it back" back={back}/>

      {phase === "write" && (
        <div className="stack gap-4">
          <div className="row gap-3">
            <select className="select teach-section" value={sectionId} onChange={e => setSectionId(e.target.value)} aria-label="Section">
              {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
            <span className="muted small nowrap">{plural(concepts.length, "concept")}</span>
            <span className="grow"/>
            <label className="check-label">
              <input type="checkbox" checked={showNames} onChange={e => setShowNames(e.target.checked)}/>Show concept names as prompts
            </label>
          </div>
          {showNames && <Notice>{concepts.map(c => c.name).join(", ")}. With the list showing, this is practice only and won't change your schedule.</Notice>}
          <article className="q-card">
            <div className="q-head"><span className="tag sky">{section.title}</span></div>
            <textarea className="card-input teach-input" value={text} onChange={e => setText(e.target.value)} autoFocus aria-label="Your explanation"
              placeholder="Explain the section in your own words, as if teaching it to someone new."/>
          </article>
          <div className="row gap-3">
            <button className="btn btn-primary" disabled={text.trim().length < MIN_CHARS || !concepts.length} onClick={check}>Check my explanation</button>
            {words > 0 && <span className="muted small num">{plural(words, "word")}</span>}
          </div>
        </div>
      )}

      {phase === "grading" && <div className="panel panel-pad busy"><Spinner/>Comparing your explanation with the section's key ideas…</div>}

      {phase === "selfcheck" && (
        <div className="stack gap-4">
          {error && <Notice tone="warn" icon="alert">{error}</Notice>}
          <div className="stack">
            {concepts.map(c => (
              <div key={c.id} className="item-card">
                <div className="row gap-3">
                  <strong className="grow">{c.name}</strong>
                  <Segmented label={`How you covered ${c.name}`} size="sm" options={STATUS_OPTIONS} value={self[c.id]}
                    onChange={(s) => setSelf(x => ({ ...x, [c.id]: s }))}/>
                </div>
                <ul className="small bullets">{keyPoints(ix, c.id).map((p, i) => <li key={i}><Markdown>{p}</Markdown></li>)}</ul>
              </div>
            ))}
          </div>
          <div><button className="btn btn-primary" onClick={finishSelf}>Save check</button></div>
        </div>
      )}

      {phase === "result" && result && (
        <>
          <Figures>
            {Object.keys(STATUS_META).map(s => <Figure key={s} value={counts[s] || 0} label={STATUS_META[s].label.toLowerCase()}/>)}
          </Figures>
          {(result.summary || result.errors?.length > 0) && (
            <div className="stack">
              {result.summary && <p className="teach-summary">{result.summary}</p>}
              {result.errors?.map((e, i) => <div key={i} className="misconception"><strong>Error:</strong> {e}</div>)}
            </div>
          )}
          <div className="list">
            {concepts.map(c => {
              const st = result.statuses[c.id] || "missing";
              return (
                <div key={c.id} className="list-row top">
                  <CheckMark tone={STATUS_META[st].mark}/>
                  <div className="grow stack gap-1">
                    <div className="row baseline"><span className="list-title">{c.name}</span><span className="muted small">{STATUS_META[st].label}</span></div>
                    {result.notes[c.id] && <div className="small muted">{result.notes[c.id]}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {applied && (
            <Notice tone="sky" icon="check">
              {applied.credited ? `${plural(applied.credited, "due review")} credited. ` : ""}
              {applied.forward ? `${plural(applied.forward, "concept")} you missed will come up in your next session.` : ""}
              {!applied.credited && !applied.forward ? "Nothing needed to change in your schedule." : ""}
            </Notice>
          )}
          {showNames && <Notice>Concept names were showing, so your schedule wasn't changed.</Notice>}
          <div className="row">
            <button className="btn btn-primary" onClick={again}>Explain another section</button>
            <button className="btn" onClick={back.onClick}>Back to course</button>
          </div>
        </>
      )}
    </Page>
  );
}

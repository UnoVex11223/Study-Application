import { useState } from "react";
import { useStore } from "../state/store.jsx";
import { Drawer, StatusDot, ImportanceTag, Notice } from "../ui/ui.jsx";
import { useNav, abilityLabel, pct } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import Markdown from "../ui/Markdown.jsx";
import ItemForm from "./ItemForm.jsx";
import FixQuestion from "./FixQuestion.jsx";
import { FLAG_REASONS } from "../lib/quality.js";
import { index } from "../lib/model.js";
import { conceptMastery, explainMastery, STATUS } from "../lib/mastery.js";
import { practiceTasks } from "../lib/planner.js";
import { relativeDays } from "../lib/time.js";

const REL_LABEL = { related: "Related", contrast: "Easily confused with", application: "Used together with" };

// Questions take turns at the concept's reviews, so each shows how often it's been asked.
function askedLine(st) {
  if (!st?.seen) return "Not asked yet";
  const misses = st.missDays.length;
  return `Asked ${st.seen}×${misses ? `, missed on ${misses} day${misses === 1 ? "" : "s"}` : ""}`;
}

export default function ConceptPanel({ conceptId, onOpen, onClose }) {
  const { state, act } = useStore();
  const nav = useNav();
  const [editing, setEditing] = useState(null); // item | "new" | null
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ix = index(state);
  const c = ix.concept[conceptId];
  if (!c) return null;

  const m = conceptMastery(state, c.id);
  const course = ix.course[c.courseId];
  const section = ix.section[c.sectionId];
  const items = ix.itemsByConcept[c.id] || [];
  const prereqs = ix.prereqsOf[c.id] || [];
  const dependents = ix.dependentsOf[c.id] || [];
  const related = ix.relatedOf[c.id] || [];
  const nextDue = c.srs && c.srs.state !== "new" ? c.srs.due : null;
  const locked = ix.lockedConcepts.has(c.id);

  const practice = () => {
    const tasks = practiceTasks(state, { conceptId: c.id });
    if (!tasks.length) return;
    onClose();
    nav.startSession({ tasks, mode: "practice", title: c.name });
  };

  const conceptLink = (id) => {
    const other = ix.concept[id];
    if (!other) return null;
    const om = conceptMastery(state, id);
    return (
      <button className="link row" style={{ gap: 8 }} onClick={() => onOpen(id)}>
        <StatusDot status={om.status}/>{other.name}
        {other.courseId !== c.courseId && <span className="muted small" style={{ fontWeight: 400 }}>{ix.course[other.courseId]?.name}</span>}
      </button>
    );
  };

  return (
    <Drawer onClose={onClose} title={c.name} subtitle={`${course?.name ?? ""}${section ? ` / ${section.title}` : ""}`}>
      <section className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <span className="row" style={{ gap: 7 }}><StatusDot status={m.status}/><strong>{STATUS[m.status].label}</strong></span>
          <ImportanceTag importance={c.importance}/>
          {c.suspended && <span className="tag tag-warn">Suspended</span>}
          {m.memory != null && <span className="tag">Recall chance now {pct(m.memory)}</span>}
          {nextDue && <span className="tag">Next review {relativeDays(nextDue)}</span>}
        </div>
        <p className="muted small">{explainMastery(m)}</p>
        {c.summary && <div className="model-answer"><Markdown>{c.summary}</Markdown></div>}
        {c.importanceReason && <p className="muted small">Why it matters: {c.importanceReason}</p>}
        {locked && <Notice icon="lock">This concept is in a chapter you haven't marked as read, so it won't come up in sessions yet.</Notice>}
        <div className="row" style={{ marginTop: 4 }}>
          {!locked && <button className="btn btn-primary btn-sm" onClick={practice} disabled={!items.length}><Icon name="play" size={12}/>Practice now</button>}
          <button className="btn btn-sm" onClick={() => { onClose(); nav.go("map", { courseId: c.courseId, conceptId: c.id }); }}><Icon name="map" size={14}/>Show on map</button>
        </div>
      </section>

      {(prereqs.length > 0 || dependents.length > 0 || related.length > 0) && (
        <section>
          <h2 className="h">Connections</h2>
          {prereqs.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="sub-label">Builds on</div>
              {prereqs.map(e => (
                <div key={e.id} className="rel">
                  <div className="grow">{conceptLink(e.from)}{e.why && <div className="muted small">{e.why}</div>}</div>
                  {(e.confidence ?? 1) < 0.6 && <span className="tag">Unconfirmed</span>}
                  <button className="btn btn-quiet btn-sm btn-icon" title="Remove this connection" onClick={() => act("edge/delete", { id: e.id })}><Icon name="x" size={14}/></button>
                </div>
              ))}
            </div>
          )}
          {dependents.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="sub-label">Needed for</div>
              {dependents.map(e => <div key={e.id} className="rel"><div className="grow">{conceptLink(e.to)}</div></div>)}
            </div>
          )}
          {related.length > 0 && (
            <div>
              <div className="sub-label">Across your knowledge</div>
              {related.map(e => {
                const other = e.from === c.id ? e.to : e.from;
                const provisional = (e.confidence ?? 1) < 0.6;
                return (
                  <div key={e.id} className="rel">
                    <div className="grow">
                      <div className="small muted">{REL_LABEL[e.type] ?? "Related"}</div>
                      {conceptLink(other)}
                      {e.why && <div className="muted small">{e.why}</div>}
                    </div>
                    {provisional && <button className="btn btn-sm" title="Keep this connection" onClick={() => act("edge/confirm", { id: e.id })}>Keep</button>}
                    <button className="btn btn-quiet btn-sm btn-icon" title="Remove this connection" onClick={() => act("edge/delete", { id: e.id })}><Icon name="x" size={14}/></button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section>
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 className="h grow" style={{ margin: 0 }}>Questions</h2>
          <button className="btn btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={14}/>Add</button>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          {items.map(it => (
            <div key={it.id} className={`item-card${it.flag ? " flagged" : ""}`}>
              <div className="row small">
                <strong>{abilityLabel(it.ability)}</strong>
                <span className="muted grow">
                  {it.flag ? "Out of sessions" : askedLine(ix.itemStats[it.id])}
                </span>
                {it.quality?.score != null && <span className="muted" title="Score from the quality review (out of 5)">Quality {it.quality.score.toFixed(1)}</span>}
                <button className="btn btn-quiet btn-sm btn-icon" title="Edit" onClick={() => setEditing(it)}><Icon name="edit" size={14}/></button>
                <button className="btn btn-quiet btn-sm btn-icon" title="Delete question" onClick={() => act("item/delete", { id: it.id })}><Icon name="trash" size={14}/></button>
              </div>
              {it.flag && <div className="small review-reason">{FLAG_REASONS[it.flag.reason] ?? "Flagged"}</div>}
              <Markdown>{it.prompt}</Markdown>
              {it.flag && <FixQuestion item={it} concept={c}/>}
              <details>
                <summary className="muted small" style={{ cursor: "pointer" }}>Answer and key points</summary>
                <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                  <div className="model-answer"><Markdown>{it.answer}</Markdown></div>
                  {it.points?.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{it.points.map((p, i) => <li key={i}><Markdown>{p}</Markdown></li>)}</ul>}
                </div>
              </details>
            </div>
          ))}
          {!items.length && <p className="muted small">No questions yet. This concept won't appear in sessions until it has one.</p>}
        </div>
      </section>

      {c.source?.excerpt && (
        <section>
          <h2 className="h">Source</h2>
          <div className="source-quote">{c.source.excerpt}</div>
          {(c.source.location || c.source.label) && <div className="muted small" style={{ marginTop: 6 }}>{[c.source.label, c.source.location].filter(Boolean).join(", ")}</div>}
        </section>
      )}

      <section className="row" style={{ borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
        <button className="btn btn-sm" onClick={() => act("concept/update", { id: c.id, patch: { suspended: !c.suspended } })}>
          <Icon name="pause" size={14}/>{c.suspended ? "Resume in sessions" : "Suspend from sessions"}
        </button>
        <div className="grow"/>
        {!confirmDelete
          ? <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14}/>Delete concept</button>
          : <>
              <span className="small">Delete it and its history?</span>
              <button className="btn btn-sm btn-danger" onClick={() => { act("concept/delete", { id: c.id }); onClose(); }}>Delete</button>
              <button className="btn btn-sm btn-quiet" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>}
      </section>

      {editing && (
        <ItemForm courseId={c.courseId} conceptId={c.id} item={editing === "new" ? null : editing} onClose={() => setEditing(null)}/>
      )}
    </Drawer>
  );
}

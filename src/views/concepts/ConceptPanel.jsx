// A concept's panel: how well you know it, what it connects to, its
// questions (to edit, fix or add to) and where it came from.

import { useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Section } from "../../ui/layout.jsx";
import { Drawer } from "../../ui/overlays.jsx";
import { Confirm } from "../../ui/controls.jsx";
import { StatusDot, ImportanceTag, Notice } from "../../ui/display.jsx";
import { FLAG_REASONS } from "../../lib/quality.js";
import { index, abilityLabel } from "../../lib/model.js";
import { conceptMastery, explainMastery, STATUS } from "../../lib/mastery.js";
import { practiceTasks } from "../../lib/planner.js";
import { relativeDays } from "../../lib/time.js";
import { plural, pct } from "../../lib/format.js";
import ItemForm from "./ItemForm.jsx";
import FixQuestion from "./FixQuestion.jsx";

const REL_LABEL = { related: "Related", contrast: "Easily confused with", application: "Used together with" };
const provisional = (e) => (e.confidence ?? 1) < 0.6;

// Questions take turns at the concept's reviews, so each shows how often it's been asked.
function askedLine(st) {
  if (!st?.seen) return "Not asked yet";
  return `Asked ${st.seen}×${st.missDays.length ? `, missed on ${plural(st.missDays.length, "day")}` : ""}`;
}

export default function ConceptPanel({ conceptId, onOpen, onClose, modeless = false, enter = true }) {
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

  /** Another concept, as a link that opens its panel (with its course when it's in another one). */
  const conceptLink = (id) => {
    const other = ix.concept[id];
    if (!other) return null;
    return (
      <button className="link concept-link" onClick={() => onOpen(id)}>
        <StatusDot status={conceptMastery(state, id).status}/>{other.name}
        {other.courseId !== c.courseId && <span className="muted small">{ix.course[other.courseId]?.name}</span>}
      </button>
    );
  };
  const removeEdge = (e) => (
    <button className="btn btn-quiet btn-sm btn-icon" title="Remove this connection" aria-label="Remove this connection" onClick={() => act("edge/delete", { id: e.id })}>
      <Icon name="x"/>
    </button>
  );

  return (
    <Drawer onClose={onClose} modeless={modeless} enter={enter} title={c.name}
      context={[course?.name, section?.title].filter(Boolean).join(" / ")}>
      <section className="stack">
        <div className="row wrap">
          <span className="row gap-2 strong"><StatusDot status={m.status}/>{STATUS[m.status].label}</span>
          <ImportanceTag importance={c.importance}/>
          {c.suspended && <span className="tag warn">Suspended</span>}
          {m.memory != null && <span className="tag">Recall chance now {pct(m.memory)}</span>}
          {nextDue && <span className="tag">Next review {relativeDays(nextDue)}</span>}
        </div>
        <p className="muted small">{explainMastery(m)}</p>
        {c.summary && <div className="quote"><Markdown>{c.summary}</Markdown></div>}
        {c.importanceReason && <p className="muted small">Why it matters: {c.importanceReason}</p>}
        {c.filledIn && <Notice>Your note was brief, so Claude filled in details. Check them against a source you trust, and edit the questions if anything's off.</Notice>}
        {c.corrected && <Notice tone="warn" icon="alert">Your original note needed a correction: {c.corrected}</Notice>}
        {locked && <Notice icon="lock">This concept is in a chapter you haven't marked as read, so it won't come up in sessions yet.</Notice>}
        <div className="row">
          {!locked && <button className="btn btn-primary btn-sm" onClick={practice} disabled={!items.length}><Icon name="play"/>Practice now</button>}
          <button className="btn btn-sm" onClick={() => { onClose(); nav.go("map", { courseId: c.courseId, conceptId: c.id }); }}><Icon name="map"/>Show on map</button>
        </div>
      </section>

      {(prereqs.length > 0 || dependents.length > 0 || related.length > 0) && (
        <Section title="Connections">
          <div className="stack gap-4">
            {prereqs.length > 0 && (
              <div className="rel-group">
                <div className="caption">Builds on</div>
                {prereqs.map(e => (
                  <div key={e.id} className="rel">
                    <div className="grow">{conceptLink(e.from)}{e.why && <div className="muted small">{e.why}</div>}</div>
                    {provisional(e) && <span className="tag">Unconfirmed</span>}
                    {removeEdge(e)}
                  </div>
                ))}
              </div>
            )}
            {dependents.length > 0 && (
              <div className="rel-group">
                <div className="caption">Needed for</div>
                {dependents.map(e => <div key={e.id} className="rel"><div className="grow">{conceptLink(e.to)}</div></div>)}
              </div>
            )}
            {related.length > 0 && (
              <div className="rel-group">
                <div className="caption">Across your knowledge</div>
                {related.map(e => (
                  <div key={e.id} className="rel">
                    <div className="grow">
                      <div className="small muted">{REL_LABEL[e.type] ?? "Related"}</div>
                      {conceptLink(e.from === c.id ? e.to : e.from)}
                      {e.why && <div className="muted small">{e.why}</div>}
                    </div>
                    {provisional(e) && <button className="btn btn-sm" title="Keep this connection" onClick={() => act("edge/confirm", { id: e.id })}>Keep</button>}
                    {removeEdge(e)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title="Questions" count={items.length || null}
        actions={<button className="btn btn-sm" onClick={() => setEditing("new")}><Icon name="plus"/>Add</button>}>
        <div className="stack">
          {items.map(it => (
            <div key={it.id} className={it.flag ? "item-card flagged" : "item-card"}>
              <div className="row small">
                <strong>{abilityLabel(it.ability)}</strong>
                <span className="muted grow">{it.flag ? "Out of sessions" : askedLine(ix.itemStats[it.id])}</span>
                {it.quality?.score != null && <span className="muted" title="Score from the quality review (out of 5)">Quality {it.quality.score.toFixed(1)}</span>}
                <button className="btn btn-quiet btn-sm btn-icon" title="Edit" aria-label="Edit question" onClick={() => setEditing(it)}><Icon name="edit"/></button>
                <button className="btn btn-quiet btn-sm btn-icon" title="Delete question" aria-label="Delete question" onClick={() => act("item/delete", { id: it.id })}><Icon name="trash"/></button>
              </div>
              {it.flag && <div className="error-text">{FLAG_REASONS[it.flag.reason] ?? "Flagged"}</div>}
              <Markdown>{it.prompt}</Markdown>
              {it.flag && <FixQuestion item={it} concept={c}/>}
              <details className="disclosure">
                <summary>Answer and key points</summary>
                <div className="stack gap-2">
                  <div className="quote"><Markdown>{it.answer}</Markdown></div>
                  {it.points?.length > 0 && <ul className="small bullets">{it.points.map((p, i) => <li key={i}><Markdown>{p}</Markdown></li>)}</ul>}
                </div>
              </details>
            </div>
          ))}
          {!items.length && <p className="muted small">No questions yet.</p>}
        </div>
      </Section>

      {c.source?.excerpt && (
        <Section title={c.noteId ? "Your note" : "Source"}>
          <div className="quote source">{c.source.excerpt}</div>
          {(c.source.location || c.source.label) && <div className="muted small">{[c.source.label, c.source.location].filter(Boolean).join(", ")}</div>}
        </Section>
      )}

      <section className="stack rule-top">
        {confirmDelete ? (
          <Confirm action="Delete concept" onCancel={() => setConfirmDelete(false)} onConfirm={() => { act("concept/delete", { id: c.id }); onClose(); }}>
            Delete {c.name} and its history?
          </Confirm>
        ) : (
          <div className="row">
            <button className="btn btn-sm" onClick={() => act("concept/update", { id: c.id, patch: { suspended: !c.suspended } })}>
              <Icon name="pause"/>{c.suspended ? "Resume in sessions" : "Suspend from sessions"}
            </button>
            <span className="grow"/>
            <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}><Icon name="trash"/>Delete concept</button>
          </div>
        )}
      </section>

      {editing && <ItemForm courseId={c.courseId} conceptId={c.id} item={editing === "new" ? null : editing} onClose={() => setEditing(null)}/>}
    </Drawer>
  );
}

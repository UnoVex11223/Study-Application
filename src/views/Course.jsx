import { useState } from "react";
import { useStore } from "../state/store.jsx";
import { Bar, StatusDot, ImportanceTag, Notice } from "../ui/ui.jsx";
import { useNav, pct } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import ConceptPanel from "./ConceptPanel.jsx";
import ItemForm from "./ItemForm.jsx";
import { CourseForm } from "./Courses.jsx";
import { index, COURSE_STATUS, ABILITIES } from "../lib/model.js";
import { courseMastery, sectionMastery, abilityBreakdown } from "../lib/mastery.js";
import { practiceTasks } from "../lib/planner.js";
import { aiBridge } from "../lib/ai.js";

export default function Course({ courseId }) {
  const { state, act } = useStore();
  const nav = useNav();
  const ix = index(state);
  const course = ix.course[courseId];
  const [open, setOpen] = useState(() => new Set());
  const [conceptId, setConceptId] = useState(nav.route.conceptId ?? null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = nav.now;

  if (!course) {
    return <div className="page"><button className="crumb" onClick={() => nav.go("courses")}><Icon name="back" size={14}/>Courses</button><p>This course no longer exists.</p></div>;
  }

  const m = courseMastery(state, courseId, now);
  const abilities = abilityBreakdown(state, { courseId, now });
  const sections = ix.sectionsByCourse[courseId] || [];
  const toggle = (id) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const practice = (scope, title) => {
    const tasks = practiceTasks(state, scope);
    if (tasks.length) nav.startSession({ tasks, mode: "practice", title });
  };
  const abilityRows = Object.entries(abilities).filter(([, v]) => v.attempts > 0);

  return (
    <div className="page">
      <button className="crumb" onClick={() => nav.go("courses")}><Icon name="back" size={14}/>Courses</button>
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <div className="row" style={{ gap: 12 }}>
            <span className="dot" style={{ background: course.color, width: 12, height: 12 }}/>
            <h1>{course.name}</h1>
            <button className="btn btn-quiet btn-sm btn-icon" title="Edit course" onClick={() => setEditing(true)}><Icon name="edit" size={15}/></button>
          </div>
          <div className="row" style={{ marginTop: 12, gap: 12, flexWrap: "wrap" }}>
            <div className="seg" role="group" aria-label="Course status">
              {Object.entries(COURSE_STATUS).map(([k, v]) => (
                <button key={k} className={course.status === k ? "on" : ""} onClick={() => act("course/update", { id: course.id, patch: { status: k } })}>{v.label}</button>
              ))}
            </div>
            <span className="muted small">{COURSE_STATUS[course.status].blurb}.</span>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => practice({ courseId }, course.name)} disabled={!m.introduced}><Icon name="play" size={12}/>Practice</button>
          <button className="btn" onClick={() => nav.go("teach", { courseId })} disabled={!sections.length}><Icon name="pen" size={15}/>Teach back</button>
          <button className="btn btn-primary" onClick={() => nav.go("import", { courseId })}><Icon name="plus" size={15}/>Add material</button>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="panel empty">
          <h3>Add the first chapter</h3>
          <p>Paste a chapter or lesson, or drop in your notes. AeroFlash pulls out the concepts that matter, writes questions for them, and introduces them a few a day.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => nav.go("import", { courseId })}><Icon name="plus" size={15}/>Add material</button>
            <button className="btn" onClick={() => setAdding({})}>Write a question yourself</button>
          </div>
          {!aiBridge() && <p className="small muted" style={{ marginTop: 16, marginBottom: 0 }}>Automatic extraction runs in the desktop app with an API key.</p>}
        </div>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 28 }}>
            <div className="stat">
              <div className="stat-value">{m.mastered}<span className="muted" style={{ fontSize: 15 }}> / {m.basisCount}</span></div>
              <div className="stat-label">{m.basisIsCore ? "core concepts" : "concepts"} mastered</div>
            </div>
            <div className="stat"><div className="stat-value">{pct(m.coveragePct)}</div><div className="stat-label">of {m.total} concepts started</div></div>
            <div className="stat"><div className="stat-value">{m.memory == null ? "–" : pct(m.memory)}</div><div className="stat-label">average recall chance now</div></div>
            <div className="stat"><div className="stat-value">{m.slipping}</div><div className="stat-label">slipping</div></div>
          </div>

          <div className="grid-2">
            <div>
              <div className="row" style={{ marginBottom: 12 }}>
                <h2 className="h grow" style={{ margin: 0 }}>Sections</h2>
                <button className="btn btn-sm btn-quiet" onClick={() => setAdding({})}><Icon name="plus" size={14}/>Add a question</button>
                <button className="btn btn-sm btn-quiet" onClick={() => nav.go("map", { courseId })}><Icon name="map" size={14}/>Map</button>
              </div>
              <div className="panel">
                {sections.map(s => {
                  const sm = sectionMastery(state, s.id, now);
                  const isOpen = open.has(s.id);
                  const concepts = ix.conceptsBySection[s.id] || [];
                  return (
                    <div key={s.id} className="section-block">
                      <button className={`section-row${isOpen ? " open" : ""}`} onClick={() => toggle(s.id)} aria-expanded={isOpen}>
                        <Icon name="chevron" size={14} className="chev"/>
                        <div style={{ minWidth: 0 }}>
                          <div className="list-title">{s.title}</div>
                          <div className="list-meta">{sm.mastered} of {sm.basisCount} {sm.basisIsCore ? "core " : ""}mastered, {sm.introduced} of {sm.total} started{sm.slipping ? `, ${sm.slipping} slipping` : ""}</div>
                        </div>
                        <Bar value={sm.masteryPct} tone="good"/>
                        <span className="num small muted" style={{ textAlign: "right" }}>{pct(sm.masteryPct)}</span>
                      </button>
                      {isOpen && (
                        <div style={{ paddingBottom: 8 }}>
                          {concepts.map(c => {
                            const cm = sm.per[c.id] ?? { status: "new" };
                            return (
                              <button key={c.id} className="concept-row" onClick={() => setConceptId(c.id)} style={{ opacity: c.suspended ? 0.5 : 1 }}>
                                <StatusDot status={cm.status}/>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                                <span className="list-meta">
                                  {cm.due && <span className="tag tag-sky">Due</span>}
                                  <ImportanceTag importance={c.importance}/>
                                </span>
                              </button>
                            );
                          })}
                          <div className="row" style={{ padding: "8px 18px 4px 48px" }}>
                            <button className="btn btn-sm" onClick={() => practice({ sectionId: s.id }, s.title)} disabled={!sm.introduced}><Icon name="play" size={11}/>Practice section</button>
                            <button className="btn btn-sm" onClick={() => nav.go("teach", { courseId, sectionId: s.id })}><Icon name="pen" size={13}/>Teach it back</button>
                            {s.sourceLabel && <span className="muted small grow" style={{ textAlign: "right" }}>{s.sourceLabel}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="stack" style={{ gap: 24 }}>
              <div className="panel panel-pad">
                <h2 className="h" style={{ marginBottom: 4 }}>Recall, explain, apply</h2>
                <p className="muted small" style={{ marginBottom: 10 }}>Share of answers right the first time without help, last 60 days.</p>
                {abilityRows.length === 0 && <p className="small muted">Shows up after a few sessions.</p>}
                {abilityRows.map(([k, v]) => (
                  <div key={k} className="ability-row">
                    <span>{ABILITIES[k].label}</span>
                    <Bar value={v.correct / v.attempts} tone="good"/>
                    <span className="num small muted" style={{ textAlign: "right" }}>{pct(v.correct / v.attempts)} of {v.attempts}</span>
                  </div>
                ))}
              </div>
              <div className="panel panel-pad small">
                <h2 className="h">How mastery is measured</h2>
                <p className="muted" style={{ lineHeight: 1.6 }}>
                  A concept is mastered once you've answered it correctly without hints on your last two study days with it, and, if it has an application question, you've solved one. Percentages count core concepts only, so details don't dilute them.
                </p>
              </div>
              {course.status === "paused" && <Notice icon="pause">Paused courses are left out of daily sessions. Their schedules resume when you switch back.</Notice>}
            </div>
          </div>
        </>
      )}

      <div className="divider"/>
      <div className="row">
        {!confirmDelete
          ? <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14}/>Delete course</button>
          : <>
              <span className="small">Delete {course.name} with all its concepts, questions and history?</span>
              <button className="btn btn-sm btn-danger" onClick={() => { act("course/delete", { id: course.id }); nav.go("courses"); }}>Delete course</button>
              <button className="btn btn-sm btn-quiet" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>}
      </div>

      {conceptId && <ConceptPanel conceptId={conceptId} onOpen={setConceptId} onClose={() => setConceptId(null)}/>}
      {editing && <CourseForm course={course} onClose={() => setEditing(false)} onSave={(patch) => { act("course/update", { id: course.id, patch }); setEditing(false); }}/>}
      {adding && <ItemForm courseId={courseId} onClose={() => setAdding(null)}/>}
    </div>
  );
}

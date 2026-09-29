import { useState } from "react";
import { useStore } from "../state/store.jsx";
import { Bar, StatusDot, ImportanceTag, Notice, Spinner, Modal } from "../ui/ui.jsx";
import { useBackground } from "../state/background.jsx";
import { useBookImport, jobProgress, bookBridge } from "../state/bookImport.jsx";
import { useNav, pct } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import ConceptPanel from "./ConceptPanel.jsx";
import ItemForm from "./ItemForm.jsx";
import { CourseForm } from "./Courses.jsx";
import { index, COURSE_STATUS, ABILITIES } from "../lib/model.js";
import { InlineMarkdown } from "../ui/Markdown.jsx";
import { courseMastery, sectionMastery, abilityBreakdown } from "../lib/mastery.js";
import { practiceTasks } from "../lib/planner.js";
import { aiBridge, roomForQuestions } from "../lib/ai.js";

/** Progress and controls for a book being imported into this course. */
function JobBanner({ job }) {
  const importer = useBookImport();
  const p = jobProgress(job);
  if (job.status === "running" || job.status === "paused") {
    const paused = job.status === "paused";
    return (
      <div className="job-banner">
        {paused ? <Icon name="pause" size={16}/> : <Spinner/>}
        <div className="grow" style={{ minWidth: 0 }}>
          <div><strong>{paused ? "Import paused" : `Importing ${job.title}`}</strong>{paused && job.error ? <span className="muted">: {job.error}</span> : null}</div>
          <div className="section-stats">
            <span>{p.done} of {p.total} chapters ready</span>
            {p.failed > 0 && <span>{p.failed} failed</span>}
            {!paused && p.active && <span className="ell">now: {p.active.title}</span>}
          </div>
          <Bar value={p.total ? p.done / p.total : 0} thin/>
        </div>
        {paused
          ? <button className="btn btn-sm btn-primary" onClick={() => importer.resume(job.id)}><Icon name="play" size={11}/>Resume</button>
          : <button className="btn btn-sm" onClick={() => importer.pause(job.id)}><Icon name="pause" size={13}/>Pause</button>}
      </div>
    );
  }
  return (
    <div className="job-banner">
      <Icon name="check" size={16}/>
      <div className="grow">
        <strong>Imported {p.done} of {p.total} chapters</strong>
        <div className="muted small">{p.failed ? `${p.failed} chapter${p.failed === 1 ? "" : "s"} failed; try again below. ` : ""}Chapters stay locked until you mark them read.</div>
      </div>
      {p.failed > 0 && <button className="btn btn-sm" onClick={() => importer.resume(job.id)}>Retry failed</button>}
      <button className="btn btn-sm btn-quiet" onClick={() => importer.dismiss(job.id)}>Dismiss</button>
    </div>
  );
}

/** Confirm topping up a chapter's or course's questions. */
function TopUpModal({ scope, onClose, onStart }) {
  const { state } = useStore();
  const room = roomForQuestions(state, scope.conceptIds);
  const n = room.length, adds = room.reduce((sum, t) => sum + t.room, 0);
  const minutes = Math.max(1, Math.round(n / 16)), dollars = Math.max(1, Math.round(n * 0.02));
  return (
    <Modal title="Write more questions" onClose={onClose} footer={<>
      <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={!n} onClick={() => { onStart(room.map(t => t.concept.id)); onClose(); }}>Write more questions</button>
    </>}>
      {n ? (
        <div className="stack" style={{ gap: 10 }}>
          <p style={{ margin: 0 }}><strong>{n} concept{n === 1 ? "" : "s"}</strong> in {scope.label} {n === 1 ? "has" : "have"} fewer questions than the target (4 for core concepts, 3 for supporting, 1 for details): room for up to {adds} more.</p>
          <p className="muted" style={{ margin: 0 }}>Claude writes questions that come at each idea from another side. They go through the same quality check and are added automatically. A concept's questions take turns at its reviews, so this adds variety, not review time.</p>
          <p className="muted small" style={{ margin: 0 }}>About {minutes} minute{minutes === 1 ? "" : "s"} in the background, roughly ${dollars} of API usage.</p>
        </div>
      ) : <p style={{ margin: 0 }}>Every concept in {scope.label} already has its full set of questions.</p>}
    </Modal>
  );
}

/** Progress for a question top-up running on this course. */
function TopUpBanner({ task, onDismiss }) {
  if (task.status === "running") {
    return (
      <div className="job-banner">
        <Spinner/>
        <div className="grow" style={{ minWidth: 0 }}>
          <strong>Writing more questions for {task.label}</strong>
          <div className="section-stats"><span>{task.done} of {task.total || "…"} groups</span><span>{task.added} added so far</span></div>
          <Bar value={task.total ? task.done / task.total : 0} thin/>
        </div>
      </div>
    );
  }
  return (
    <div className="job-banner">
      <Icon name={task.status === "failed" ? "alert" : "check"} size={16}/>
      <div className="grow">
        <strong>{task.status === "failed" ? `Couldn't write more questions for ${task.label}` : `Added ${task.added} question${task.added === 1 ? "" : "s"} to ${task.concepts ?? 0} concept${task.concepts === 1 ? "" : "s"} in ${task.label}`}</strong>
        {task.error && <div className="muted small">{task.status === "failed" ? task.error : `Some groups failed: ${task.error}. Running it again fills the gaps.`}</div>}
      </div>
      <button className="btn btn-sm btn-quiet" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

const CHAPTER_STATUS = {
  pending: "Waiting",
  reading: "Finding concepts…",
  writing: "Writing questions…",
  failed: "Failed",
};

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
  const [confirmSection, setConfirmSection] = useState(null);
  const importer = useBookImport();
  const bg = useBackground();
  const [topUpScope, setTopUpScope] = useState(null);
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
  const jobs = state.bookJobs.filter(j => j.courseId === courseId);
  const waiting = jobs.flatMap(job => job.chapters.map((c, i) => ({ job, c, i })).filter(x => x.c.include && x.c.status !== "done"));
  const lockedCount = sections.filter(s => s.locked).length;
  const topUps = bg.tasks.filter(t => t.courseId === courseId);
  const topUpRunning = topUps.some(t => t.status === "running");
  const questionCount = (conceptList) => conceptList.reduce((n, c) => n + (ix.itemsByConcept[c.id] || []).filter(i => !i.flag).length, 0);
  const startTopUp = (label, sectionId) => (conceptIds) => bg.topUp({ label, courseId, sectionId, conceptIds });

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
          <button className="btn" onClick={() => nav.go("teach", { courseId })} disabled={!sections.some(s => !s.locked)}><Icon name="pen" size={15}/>Teach back</button>
          <button className="btn btn-primary" onClick={() => nav.go("import", { courseId })}><Icon name="plus" size={15}/>Add material</button>
        </div>
      </div>

      {jobs.map(job => <JobBanner key={job.id} job={job}/>)}
      {topUps.map(t => <TopUpBanner key={t.id} task={t} onDismiss={() => bg.dismiss(t.id)}/>)}

      {sections.length === 0 && waiting.length === 0 ? (
        <div className="panel empty">
          <h3>Add the first chapter</h3>
          <p>Paste a chapter or lesson, or drop in your notes. Tenax pulls out the concepts that matter, writes questions for them, and introduces them a few a day.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => nav.go("import", { courseId })}><Icon name="plus" size={15}/>Add material</button>
            <button className="btn" onClick={() => nav.go("book", { courseId })}><Icon name="book" size={15}/>Import a whole book</button>
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
            <div className="stat"><div className="stat-value">{m.memory == null ? "–" : pct(m.memory)}</div><div className="stat-label">average recall today</div></div>
            <div className="stat"><div className="stat-value">{m.slipping}</div><div className="stat-label">slipping</div></div>
          </div>

          <div className="grid-2">
            <div>
              <div className="row" style={{ marginBottom: 12 }}>
                <h2 className="h grow" style={{ margin: 0 }}>Sections</h2>
                {aiBridge() && <button className="btn btn-sm btn-quiet" disabled={topUpRunning} onClick={() => setTopUpScope({ label: course.name, conceptIds: (ix.conceptsByCourse[courseId] || []).map(c => c.id), start: startTopUp(course.name, null) })}><Icon name="sparkle" size={14}/>More questions</button>}
                <button className="btn btn-sm btn-quiet" onClick={() => setAdding({})}><Icon name="plus" size={14}/>Add a question</button>
                <button className="btn btn-sm btn-quiet" onClick={() => nav.go("map", { courseId })}><Icon name="map" size={14}/>Map</button>
              </div>
              {lockedCount > 0 && (
                <p className="muted small" style={{ margin: "-4px 0 12px" }}>
                  {lockedCount} chapter{lockedCount === 1 ? " is" : "s are"} locked until you mark {lockedCount === 1 ? "it" : "them"} read. Nothing from a locked chapter comes up in sessions, and course totals count unlocked chapters only.
                </p>
              )}
              <div className="panel">
                {sections.map(s => {
                  const sm = sectionMastery(state, s.id, now);
                  const isOpen = open.has(s.id);
                  const concepts = ix.conceptsBySection[s.id] || [];
                  return (
                    <div key={s.id} className={`section-block${s.locked ? " locked" : ""}`}>
                      <div className="section-head">
                        <button className={`section-row${isOpen ? " open" : ""}`} onClick={() => toggle(s.id)} aria-expanded={isOpen}>
                          <Icon name="chevron" size={14} className="chev"/>
                          <div className="section-text">
                            <div className="list-title section-title">{s.locked && <Icon name="lock" size={13}/>}{s.title}</div>
                            {s.summary && <div className="section-desc"><InlineMarkdown>{s.summary}</InlineMarkdown></div>}
                            <div className="section-stats">
                              <span>{sm.total} concept{sm.total === 1 ? "" : "s"}</span>
                              <span>{questionCount(concepts)} questions</span>
                              {s.locked ? <span>locked until you've read it</span> : <>
                                <span title={sm.basisIsCore ? "Core concepts mastered" : "Concepts mastered"}>{sm.mastered}/{sm.basisCount} mastered</span>
                                {sm.introduced < sm.total && <span>{sm.introduced}/{sm.total} started</span>}
                                {sm.slipping > 0 && <span>{sm.slipping} slipping</span>}
                              </>}
                            </div>
                          </div>
                        </button>
                        <div className="section-side">
                          {s.locked
                            ? <button className="btn btn-sm" onClick={() => act("section/lock", { id: s.id, locked: false })}><Icon name="check" size={13}/>Mark as read</button>
                            : <><span className="num">{pct(sm.masteryPct)}</span><Bar value={sm.masteryPct} tone="good" thin/></>}
                        </div>
                      </div>
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
                            {!s.locked && <>
                              <button className="btn btn-sm" onClick={() => practice({ sectionId: s.id }, s.title)} disabled={!sm.introduced}><Icon name="play" size={11}/>Practice section</button>
                              <button className="btn btn-sm" onClick={() => nav.go("teach", { courseId, sectionId: s.id })}><Icon name="pen" size={13}/>Teach it back</button>
                            </>}
                            {aiBridge() && (
                              <button className="btn btn-sm" disabled={topUpRunning} onClick={() => setTopUpScope({ label: s.title, conceptIds: concepts.map(c => c.id), start: startTopUp(s.title, s.id) })}><Icon name="sparkle" size={13}/>More questions</button>
                            )}
                            {!s.locked && s.pages && (
                              <button className="btn btn-sm btn-quiet" title="Stop introducing new concepts from this chapter" onClick={() => act("section/lock", { id: s.id, locked: true })}><Icon name="lock" size={13}/>Lock</button>
                            )}
                            <span className="muted small grow" style={{ textAlign: "right" }}>{s.sourceLabel}</span>
                            <button className="btn btn-quiet btn-sm btn-icon" title="Remove section" onClick={() => setConfirmSection(s.id)}><Icon name="trash" size={14}/></button>
                          </div>
                          {confirmSection === s.id && (
                            <div className="row small" style={{ padding: "4px 18px 8px 48px" }}>
                              <span className="grow">Remove {s.title} with its concepts, questions and history? You can add the material again afterwards.</span>
                              <button className="btn btn-sm btn-danger" onClick={() => { act("section/delete", { id: s.id }); setConfirmSection(null); }}>Remove</button>
                              <button className="btn btn-sm btn-quiet" onClick={() => setConfirmSection(null)}>Cancel</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {waiting.map(({ job, c, i }) => (
                  <div key={`${job.id}-${i}`} className="section-block waiting">
                    <div className="section-head">
                      <div className="section-row">
                        {c.status === "reading" || c.status === "writing" ? <Spinner/> : <Icon name={c.status === "failed" ? "alert" : "lock"} size={13} className="chev"/>}
                        <div className="section-text">
                          <div className="list-title">{c.title}</div>
                          <div className="section-stats">
                            <span>pp. {c.from}–{c.to}</span>
                            <span>{c.status === "pending" && job.status === "paused" ? "Paused" : c.status === "writing" && c.mode === "batch" ? "Writing questions (half-price batch)…" : CHAPTER_STATUS[c.status]}</span>
                          </div>
                          {c.status === "failed" && c.error && <div className="small review-reason">{c.error}</div>}
                        </div>
                      </div>
                      <div className="section-side">
                        <label className="chapter-read" title="Unlock this chapter as soon as it's imported">
                          <input type="checkbox" checked={Boolean(c.read)} onChange={() => importer.setRead(job.id, i, !c.read)}/>
                          <span className="small">Read</span>
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
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
              <button className="btn btn-sm btn-danger" onClick={() => { jobs.forEach(j => bookBridge()?.remove(j.bookId)); act("course/delete", { id: course.id }); nav.go("courses"); }}>Delete course</button>
              <button className="btn btn-sm btn-quiet" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>}
      </div>

      {conceptId && <ConceptPanel conceptId={conceptId} onOpen={setConceptId} onClose={() => setConceptId(null)}/>}
      {editing && <CourseForm course={course} onClose={() => setEditing(false)} onSave={(patch) => { act("course/update", { id: course.id, patch }); setEditing(false); }}/>}
      {adding && <ItemForm courseId={courseId} onClose={() => setAdding(null)}/>}
      {topUpScope && <TopUpModal scope={topUpScope} onClose={() => setTopUpScope(null)} onStart={topUpScope.start}/>}
    </div>
  );
}

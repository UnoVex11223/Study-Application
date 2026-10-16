import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store.jsx";
import { Bar, StatusDot, ImportanceTag, Notice, Spinner, Modal, Figures, Figure, Spark } from "../ui/ui.jsx";
import { CoverArt } from "../ui/Cover.jsx";
import { useBackground } from "../state/background.jsx";
import { useSync } from "../state/sync.jsx";
import { useBookImport, jobProgress, bookBridge } from "../state/bookImport.jsx";
import { useNav, pct } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import ConceptPanel from "./ConceptPanel.jsx";
import ItemForm from "./ItemForm.jsx";
import { CourseForm } from "./Courses.jsx";
import { index, COURSE_STATUS, ABILITIES } from "../lib/model.js";
import { courseMastery, sectionMastery, abilityBreakdown } from "../lib/mastery.js";
import { practiceTasks } from "../lib/planner.js";
import { aiBridge, roomForQuestions } from "../lib/ai.js";
import { lastDays, milestones, runningTotal } from "../lib/history.js";
import { dayKey } from "../lib/time.js";

/** Progress and controls for a book being imported into this course. */
function JobBanner({ job, device }) {
  const importer = useBookImport();
  const p = jobProgress(job);
  // Running on another computer: progress only; that computer controls it.
  if (job.deviceId && device && job.deviceId !== device.id && job.status !== "done") {
    return (
      <div className="job-banner">
        <Icon name="book" size={16}/>
        <div className="grow" style={{ minWidth: 0 }}>
          <strong>Importing {job.title} on {job.deviceName || "another computer"}</strong>
          <div className="section-stats"><span>{p.done} of {p.total} chapters ready</span>{job.status === "paused" && <span>paused</span>}</div>
          <Bar value={p.total ? p.done / p.total : 0} thin/>
        </div>
      </div>
    );
  }
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
        {p.failed > 0 && <div className="muted small">{p.failed} chapter{p.failed === 1 ? "" : "s"} failed</div>}
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
          <p style={{ margin: 0 }}><strong>{n} concept{n === 1 ? "" : "s"}</strong> in {scope.label}: room for up to {adds} more questions.</p>
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
  const [open, setOpen] = useState(() => new Set(nav.route.sectionId ? [nav.route.sectionId] : []));
  const [conceptId, setConceptId] = useState(nav.route.conceptId ?? null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSection, setConfirmSection] = useState(null);
  const importer = useBookImport();
  const bg = useBackground();
  const device = useSync()?.device ?? null;
  const [topUpScope, setTopUpScope] = useState(null);
  const now = nav.now;
  // Opened at a chapter (from the palette): bring it into view.
  useEffect(() => {
    if (nav.route.sectionId) document.getElementById(`sec-${nav.route.sectionId}`)?.scrollIntoView({ block: "center" });
  }, [nav.route.sectionId]);
  // The last 30 days of concepts started and mastered, for the sparklines.
  const hasCourse = Boolean(course);
  const history = useMemo(() => {
    if (!hasCourse) return null;
    const ix2 = index(state);
    const all = (ix2.conceptsByCourse[courseId] || []).filter(c => !c.suspended && !ix2.lockedConcepts.has(c.id));
    const core = all.filter(c => c.importance === "core");
    const days = lastDays(dayKey(now, state.settings.rolloverHour), 30);
    const started = milestones(state, all, now).started;
    const mastered = milestones(state, core.length ? core : all, now).mastered;
    return { started: runningTotal(started, days), mastered: runningTotal(mastered, days) };
  }, [state, hasCourse, courseId, now]);

  if (!course) {
    return <div className="page"><button className="crumb" onClick={() => nav.go("courses")}><Icon name="back" size={14}/>Courses</button><p>This course no longer exists.</p></div>;
  }

  const m = courseMastery(state, courseId, now);
  const shelfItem = state.shelf.find(it => it.courseId === courseId) || null;
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
  const topUps = bg.tasks.filter(t => t.courseId === courseId);
  const topUpRunning = topUps.some(t => t.status === "running");
  const questionCount = (conceptList) => conceptList.reduce((n, c) => n + (ix.itemsByConcept[c.id] || []).filter(i => !i.flag).length, 0);
  const startTopUp = (label, sectionId) => (conceptIds) => bg.topUp({ label, courseId, sectionId, conceptIds });

  return (
    <div className="page">
      <button className="crumb" onClick={() => nav.go("courses")}><Icon name="back" size={14}/>Courses</button>
      <div className="page-head course-head">
        <CoverArt src={shelfItem?.cover || null} title={shelfItem?.title || course.name} className="course-cover"/>
        <div className="grow">
          <h1>{course.name}</h1>
          <div className="row" style={{ marginTop: 14, gap: 8 }}>
            <div className="seg" role="group" aria-label="Course status">
              {Object.entries(COURSE_STATUS).map(([k, v]) => (
                <button key={k} className={course.status === k ? "on" : ""} onClick={() => act("course/update", { id: course.id, patch: { status: k } })}>{v.label}</button>
              ))}
            </div>
            <button className="btn btn-quiet btn-sm btn-icon" title="Edit course" aria-label="Edit course" onClick={() => setEditing(true)}><Icon name="edit" size={15}/></button>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => practice({ courseId }, course.name)} disabled={!m.introduced}><Icon name="play" size={12}/>Practice</button>
          <button className="btn" onClick={() => nav.go("teach", { courseId })} disabled={!sections.some(s => !s.locked)}><Icon name="pen" size={15}/>Teach back</button>
          <button className="btn btn-primary" onClick={() => nav.go("import", { courseId })}><Icon name="plus" size={15}/>Add material</button>
        </div>
      </div>

      {course.status === "paused" && <div style={{ marginBottom: 20 }}><Notice icon="pause">Paused courses are left out of daily sessions. Their schedules resume when you switch back.</Notice></div>}
      {jobs.map(job => <JobBanner key={job.id} job={job} device={device}/>)}
      {topUps.map(t => <TopUpBanner key={t.id} task={t} onDismiss={() => bg.dismiss(t.id)}/>)}

      {sections.length === 0 && waiting.length === 0 ? (
        <div className="panel empty">
          <h3>Add the first chapter</h3>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => nav.go("import", { courseId })}><Icon name="plus" size={15}/>Add material</button>
            <button className="btn" onClick={() => nav.go("book", { courseId })}><Icon name="book" size={15}/>Import a whole book</button>
            <button className="btn" onClick={() => setAdding({})}>Write a question yourself</button>
          </div>
          {!aiBridge() && <p className="small muted" style={{ marginTop: 16, marginBottom: 0 }}>Automatic extraction runs in the desktop app with an API key.</p>}
        </div>
      ) : (
        <>
          <Figures>
            <Figure value={m.mastered} of={m.basisCount} label={`${m.basisIsCore ? "core concepts" : "concepts"} mastered`}
              spark={history && <Spark values={history.mastered} label="Mastered over the last 30 days"/>}/>
            <Figure value={pct(m.coveragePct)} label={`of ${m.total} concepts started`}
              spark={history && <Spark values={history.started} label="Started over the last 30 days"/>}/>
            <Figure value={m.memory == null ? "–" : pct(m.memory)} label="average recall today"/>
            <Figure value={m.slipping} label="slipping"/>
          </Figures>

          <div>
            <div>
              <div className="row" style={{ marginBottom: 12 }}>
                <h2 className="h grow" style={{ margin: 0 }}>Sections</h2>
                {aiBridge() && <button className="btn btn-sm btn-quiet" disabled={topUpRunning} onClick={() => setTopUpScope({ label: course.name, conceptIds: (ix.conceptsByCourse[courseId] || []).map(c => c.id), start: startTopUp(course.name, null) })}><Icon name="sparkle" size={14}/>More questions</button>}
                <button className="btn btn-sm btn-quiet" onClick={() => setAdding({})}><Icon name="plus" size={14}/>Add a question</button>
                <button className="btn btn-sm btn-quiet" onClick={() => nav.go("map", { courseId })}><Icon name="map" size={14}/>Map</button>
              </div>
              <div className="panel">
                {sections.map(s => {
                  const sm = sectionMastery(state, s.id, now);
                  const isOpen = open.has(s.id);
                  const concepts = ix.conceptsBySection[s.id] || [];
                  return (
                    <div key={s.id} id={`sec-${s.id}`} className={`section-block${s.locked ? " locked" : ""}`}>
                      <div className="section-head">
                        <button className={`section-row${isOpen ? " open" : ""}`} onClick={() => toggle(s.id)} aria-expanded={isOpen}>
                          <Icon name="chevron" size={14} className="chev"/>
                          <div className="section-text">
                            <div className="list-title section-title">{s.locked && <Icon name="lock" size={13}/>}{s.title}</div>
                            <div className="section-stats" title={`${questionCount(concepts)} questions`}>
                              <span>{sm.total} concept{sm.total === 1 ? "" : "s"}</span>
                              {s.locked ? <span>locked until you've read it</span> : <>
                                <span title={sm.basisIsCore ? "Core concepts mastered" : "Concepts mastered"}>{sm.mastered} of {sm.basisCount} mastered</span>
                                {sm.introduced < sm.total && <span>{sm.introduced} started</span>}
                                {sm.slipping > 0 && <span className="warn">{sm.slipping} slipping</span>}
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
                            <span className="grow"/>
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

            {abilityRows.length > 0 && (
              <section className="abilities">
                <h2 className="h">Right answers by kind of question <span className="muted small">last 60 days</span></h2>
                <div className="ability-grid">
                  {abilityRows.map(([k, v]) => (
                    <div key={k} className="ability">
                      <div className="ability-top"><span>{ABILITIES[k].label}</span><span className="num">{pct(v.correct / v.attempts)}</span></div>
                      <Bar value={v.correct / v.attempts} thin/>
                      <div className="ability-n num">of {v.attempts}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
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

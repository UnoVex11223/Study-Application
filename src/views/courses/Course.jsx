// A course: its book cover and name, whether it's Active, how it's going (the
// figures), its sections with their concepts, and how often each kind of
// question is answered right.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useBackground } from "../../state/background.jsx";
import { useSync } from "../../state/sync.jsx";
import { useBookImport, bookBridge } from "../../state/bookImport.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, Section, EmptyState } from "../../ui/layout.jsx";
import { Segmented } from "../../ui/controls.jsx";
import { Menu, MenuItem, ConfirmDialog } from "../../ui/overlays.jsx";
import { Bar, Figures, Figure, Spark, ImportanceTag, Notice, Spinner } from "../../ui/display.jsx";
import { CoverArt } from "../../ui/Cover.jsx";
import { index, COURSE_STATUS, ABILITIES } from "../../lib/model.js";
import { courseMastery, sectionMastery, abilityBreakdown } from "../../lib/mastery.js";
import { practiceTasks, questionsPerDay } from "../../lib/planner.js";
import { activationForecast, pretestTasks, sectionStarted } from "../../lib/training.js";
import { aiBridge } from "../../lib/ai.js";
import { lastDays, milestones, runningTotal } from "../../lib/history.js";
import { dayKey } from "../../lib/time.js";
import { plural, pct } from "../../lib/format.js";
import { Outline, OutlineItem, ConceptRow, OutlineActions } from "../concepts/Outline.jsx";
import ConceptPanel from "../concepts/ConceptPanel.jsx";
import ItemForm from "../concepts/ItemForm.jsx";
import CourseForm from "./CourseForm.jsx";
import { JobBanner, TopUpBanner, TopUpModal } from "./CourseBanners.jsx";

const STATUS_OPTIONS = Object.entries(COURSE_STATUS).map(([k, v]) => [k, v.label, v.blurb]);
const CHAPTER_STATUS = {
  pending: "Waiting",
  reading: "Finding concepts…",
  writing: "Writing questions…",
  failed: "Failed",
};

/** Concepts started and mastered over the last 30 days, for the sparklines. */
function useHistory(state, courseId, now) {
  return useMemo(() => {
    const ix = index(state);
    if (!ix.course[courseId]) return null;
    const all = (ix.conceptsByCourse[courseId] || []).filter(c => !c.suspended && !ix.lockedConcepts.has(c.id));
    const core = all.filter(c => c.importance === "core");
    const days = lastDays(dayKey(now, state.settings.rolloverHour), 30);
    return {
      started: runningTotal(milestones(state, all, now).started, days),
      mastered: runningTotal(milestones(state, core.length ? core : all, now).mastered, days),
    };
  }, [state, courseId, now]);
}

export default function Course({ courseId }) {
  const { state, act } = useStore();
  const nav = useNav();
  const ix = index(state);
  const course = ix.course[courseId];
  const importer = useBookImport();
  const bg = useBackground();
  const device = useSync()?.device ?? null;
  const now = nav.now;
  const [open, setOpen] = useState(() => new Set(nav.route.sectionId ? [nav.route.sectionId] : []));
  const [conceptId, setConceptId] = useState(nav.route.conceptId ?? null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState(null); // a section to remove
  const [topUpScope, setTopUpScope] = useState(null);
  const history = useHistory(state, courseId, now);

  // Opened at a chapter (from the palette): bring it into view.
  useEffect(() => {
    if (nav.route.sectionId) document.getElementById(`sec-${nav.route.sectionId}`)?.scrollIntoView({ block: "center" });
  }, [nav.route.sectionId]);

  if (!course) {
    return (
      <Page>
        <EmptyState title="This course no longer exists" actions={<button className="btn" onClick={() => nav.go("courses")}>Back to courses</button>}/>
      </Page>
    );
  }

  const m = courseMastery(state, courseId, now);
  const sections = ix.sectionsByCourse[courseId] || [];
  const shelfItem = state.shelf.find(it => it.courseId === courseId) || null;
  const jobs = state.bookJobs.filter(j => j.courseId === courseId);
  const waiting = jobs.flatMap(job => job.chapters.map((c, i) => ({ job, c, i })).filter(x => x.c.include && x.c.status !== "done"));
  const topUps = bg.tasks.filter(t => t.courseId === courseId);
  const topUpRunning = topUps.some(t => t.status === "running");
  const abilityRows = Object.entries(abilityBreakdown(state, { courseId, now })).filter(([, v]) => v.attempts > 0);
  // What Active would mean for your days, shown while the course isn't Active yet.
  const forecast = course.status !== "active" ? activationForecast(state, courseId) : null;
  const ai = Boolean(aiBridge());

  const toggle = (id) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const practice = (scope, title) => {
    const tasks = practiceTasks(state, scope);
    if (tasks.length) nav.startSession({ tasks, mode: "practice", title });
  };
  const pretest = (s) => {
    const tasks = pretestTasks(state, s.id);
    if (tasks.length) nav.startSession({ tasks, mode: "pretest", title: `Pretest: ${s.title}` });
  };
  const topUp = (label, conceptIds, sectionId = null) => setTopUpScope({
    label, conceptIds, start: (ids) => bg.topUp({ label, courseId, sectionId, conceptIds: ids }),
  });
  const deleteCourse = () => {
    jobs.forEach(j => bookBridge()?.remove(j.bookId));
    act("course/delete", { id: course.id });
    nav.go("courses");
  };

  return (
    <Page>
      <header className="page-header">
        <button className="crumb" onClick={() => nav.go("courses")}><Icon name="back"/>Courses</button>
        <div className="course-head">
          <CoverArt src={shelfItem?.cover || null} title={shelfItem?.title || course.name} className="course-cover"/>
          <div className="course-head-main">
            <h1 className="page-title">{course.name}</h1>
            <div className="course-toolbar">
              <Segmented label="Course status" options={STATUS_OPTIONS} value={course.status}
                onChange={(status) => act("course/update", { id: course.id, patch: { status } })}/>
              <div className="page-actions">
                <button className="btn" onClick={() => practice({ courseId }, course.name)} disabled={!m.introduced}><Icon name="play"/>Practice</button>
                <button className="btn" onClick={() => nav.go("teach", { courseId })} disabled={!sections.some(s => !s.locked)}><Icon name="pen"/>Teach back</button>
                <button className="btn btn-primary" onClick={() => nav.go("import", { courseId })}><Icon name="plus"/>Add material</button>
                <Menu label="More for this course" trigger="btn btn-quiet btn-icon">
                  <MenuItem icon="edit" onClick={() => setEditing(true)}>Edit course</MenuItem>
                  {ai && <MenuItem icon="sparkle" disabled={topUpRunning} onClick={() => topUp(course.name, (ix.conceptsByCourse[courseId] || []).map(c => c.id))}>Write more questions</MenuItem>}
                  <MenuItem icon="trash" danger onClick={() => setDeleting(true)}>Delete course</MenuItem>
                </Menu>
              </div>
            </div>
          </div>
        </div>
        {forecast && (
          <p className="help">
            If Active: about {plural(Math.max(1, Math.round(forecast.newPerDay)), "new concept")} a day, and within a month it would take
            about {Math.max(1, Math.round(forecast.perDay))} of your {questionsPerDay(state.settings)} daily questions.
          </p>
        )}
      </header>

      {course.status === "paused" && <Notice icon="pause">Paused courses are left out of daily sessions. Their schedules resume when you switch back.</Notice>}
      {(jobs.length > 0 || topUps.length > 0) && (
        <div className="stack">
          {jobs.map(job => <JobBanner key={job.id} job={job} device={device}/>)}
          {topUps.map(t => <TopUpBanner key={t.id} task={t} onDismiss={() => bg.dismiss(t.id)}/>)}
        </div>
      )}

      {sections.length === 0 && waiting.length === 0 ? (
        <EmptyState title="Add the first chapter" actions={<>
          <button className="btn btn-primary" onClick={() => nav.go("import", { courseId })}><Icon name="plus"/>Add material</button>
          <button className="btn" onClick={() => nav.go("book", { courseId })}><Icon name="book"/>Import a whole book</button>
          <button className="btn" onClick={() => setAdding({})}>Write a question yourself</button>
        </>}>
          {!ai && "Automatic extraction runs in the desktop app with an API key."}
        </EmptyState>
      ) : (
        <>
          <Figures>
            <Figure value={m.mastered} of={m.basisCount} label={`${m.basisIsCore ? "core concepts" : "concepts"} mastered`}
              spark={history && <Spark values={history.mastered} label="Mastered over the last 30 days"/>}/>
            <Figure value={pct(m.coveragePct)} label={`of ${plural(m.total, "concept")} started`}
              spark={history && <Spark values={history.started} label="Started over the last 30 days"/>}/>
            <Figure value={m.memory == null ? "–" : pct(m.memory)} label="average recall today"/>
            <Figure value={m.slipping} label="slipping"/>
          </Figures>

          <Section title="Sections" actions={<>
            <button className="btn btn-sm btn-quiet" onClick={() => setAdding({})}><Icon name="plus"/>Add a question</button>
            <button className="btn btn-sm btn-quiet" onClick={() => nav.go("map", { courseId })}><Icon name="map"/>Map</button>
          </>}>
            <Outline>
              {sections.map(s => {
                const sm = sectionMastery(state, s.id, now);
                const concepts = ix.conceptsBySection[s.id] || [];
                return (
                  <OutlineItem key={s.id} id={`sec-${s.id}`} title={s.title} titleIcon={s.locked ? "lock" : null}
                    open={open.has(s.id)} onToggle={() => toggle(s.id)}
                    meta={<>
                      <span>{plural(sm.total, "concept")}</span>
                      {s.locked ? <span>locked until you've read it</span> : <>
                        <span>{sm.mastered} of {sm.basisCount} mastered</span>
                        {sm.introduced < sm.total && <span>{sm.introduced} started</span>}
                        {sm.slipping > 0 && <span className="warn">{sm.slipping} slipping</span>}
                      </>}
                    </>}
                    side={s.locked
                      ? <button className="btn btn-sm" onClick={() => act("section/lock", { id: s.id, locked: false })}><Icon name="check"/>Mark as read</button>
                      : <><span className="outline-pct num">{pct(sm.masteryPct)}</span><Bar value={sm.masteryPct} tone="good" thin/></>}>
                    {concepts.map(c => (
                      <ConceptRow key={c.id} concept={c} status={sm.per[c.id]?.status ?? "new"} onOpen={setConceptId}
                        tags={<>{sm.per[c.id]?.due && <span className="tag sky">Due</span>}<ImportanceTag importance={c.importance}/></>}/>
                    ))}
                    <OutlineActions>
                      {!s.locked && <button className="btn btn-sm" onClick={() => practice({ sectionId: s.id }, s.title)} disabled={!sm.introduced}><Icon name="play"/>Practice section</button>}
                      {!s.locked && <button className="btn btn-sm" onClick={() => nav.go("teach", { courseId, sectionId: s.id })}><Icon name="pen"/>Teach it back</button>}
                      {!sectionStarted(state, s.id) && concepts.length > 0 && (
                        <button className="btn btn-sm" onClick={() => pretest(s)}
                          title="Try its questions before you study it: attempting first makes the material stick better, even when you get them wrong. Nothing is scheduled.">
                          <Icon name="target"/>Pretest
                        </button>
                      )}
                      <span className="grow"/>
                      <Menu label={`More for ${s.title}`}>
                        {ai && <MenuItem icon="sparkle" disabled={topUpRunning} onClick={() => topUp(s.title, concepts.map(c => c.id), s.id)}>Write more questions</MenuItem>}
                        {!s.locked && s.pages && <MenuItem icon="lock" onClick={() => act("section/lock", { id: s.id, locked: true })}>Lock until read</MenuItem>}
                        <MenuItem icon="trash" danger onClick={() => setRemoving(s)}>Remove section</MenuItem>
                      </Menu>
                    </OutlineActions>
                  </OutlineItem>
                );
              })}
              {waiting.map(({ job, c, i }) => (
                <OutlineItem key={`${job.id}-${i}`} title={c.title} waiting
                  lead={c.status === "reading" || c.status === "writing" ? <Spinner/> : <Icon name={c.status === "failed" ? "alert" : "lock"}/>}
                  meta={<>
                    <span className="num">pp. {c.from}–{c.to}</span>
                    <span>{c.status === "pending" && job.status === "paused" ? "Paused" : c.status === "writing" && c.mode === "batch" ? "Writing questions (half-price batch)…" : CHAPTER_STATUS[c.status]}</span>
                    {c.status === "failed" && c.error && <span className="warn">{c.error}</span>}
                  </>}
                  side={
                    <label className="check-label" title="Unlock this chapter as soon as it's imported">
                      <input type="checkbox" checked={Boolean(c.read)} onChange={() => importer.setRead(job.id, i, !c.read)}/>Read
                    </label>
                  }/>
              ))}
            </Outline>
          </Section>

          {abilityRows.length > 0 && (
            <Section title="Right answers by kind of question" note="last 60 days">
              <div className="ability-grid">
                {abilityRows.map(([k, v]) => (
                  <div key={k} className="ability">
                    <div className="ability-top"><span>{ABILITIES[k].label}</span><span className="num strong">{pct(v.correct / v.attempts)}</span></div>
                    <Bar value={v.correct / v.attempts} thin/>
                    <div className="ability-n num">of {v.attempts}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {conceptId && <ConceptPanel conceptId={conceptId} onOpen={setConceptId} onClose={() => setConceptId(null)}/>}
      {editing && <CourseForm course={course} onClose={() => setEditing(false)} onSave={(patch) => { act("course/update", { id: course.id, patch }); setEditing(false); }}/>}
      {adding && <ItemForm courseId={courseId} onClose={() => setAdding(null)}/>}
      {topUpScope && <TopUpModal scope={topUpScope} onClose={() => setTopUpScope(null)} onStart={topUpScope.start}/>}
      {deleting && (
        <ConfirmDialog title="Delete this course?" action="Delete course" onConfirm={deleteCourse} onClose={() => setDeleting(false)}>
          {course.name} will be deleted with all its concepts, questions and history.
        </ConfirmDialog>
      )}
      {removing && (
        <ConfirmDialog title="Remove this section?" action="Remove section" onConfirm={() => act("section/delete", { id: removing.id })} onClose={() => setRemoving(null)}>
          {removing.title} will be removed with its concepts, questions and history. You can add the material again afterwards.
        </ConfirmDialog>
      )}
    </Page>
  );
}

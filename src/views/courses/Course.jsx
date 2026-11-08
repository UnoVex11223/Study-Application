// A course, kept bare: its cover and name, Practice and Drill terms, and its
// chapters (each with how much is mastered) that open to show their concepts.
// Everything else (whether it's Active, Teach back, editing, adding material,
// writing or rebuilding questions) is under the ⋯ menu.

import { useEffect, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useBackground } from "../../state/background.jsx";
import { useSync } from "../../state/sync.jsx";
import { useBookImport, bookBridge } from "../../state/bookImport.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, EmptyState } from "../../ui/layout.jsx";
import { Menu, MenuItem, ConfirmDialog } from "../../ui/overlays.jsx";
import { Bar, Spinner } from "../../ui/display.jsx";
import { CoverArt } from "../../ui/Cover.jsx";
import { index, COURSE_STATUS, jobCourseIds, chapterCourse, dropJobCourse } from "../../lib/model.js";
import { courseMastery, sectionMastery } from "../../lib/mastery.js";
import { practiceTasks } from "../../lib/planner.js";
import { pretestTasks, sectionStarted } from "../../lib/training.js";
import { termTasks } from "../../lib/ladder.js";
import { aiBridge } from "../../lib/ai.js";
import { pct } from "../../lib/format.js";
import { Outline, OutlineItem, ConceptRow, OutlineActions } from "../concepts/Outline.jsx";
import ConceptPanel from "../concepts/ConceptPanel.jsx";
import ItemForm from "../concepts/ItemForm.jsx";
import CourseForm from "./CourseForm.jsx";
import { JobBanner, TopUpBanner, TopUpModal, RebuildModal } from "./CourseBanners.jsx";

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
  const [rebuildScope, setRebuildScope] = useState(null);

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
  // A book being imported into this course, or a pasted guide with chapters for it.
  const jobs = state.bookJobs.filter(j => jobCourseIds(j).includes(courseId));
  const waiting = jobs.flatMap(job => job.chapters.map((c, i) => ({ job, c, i }))
    .filter(x => x.c.include && x.c.status !== "done" && chapterCourse(job, x.c) === courseId));
  const topUps = bg.tasks.filter(t => t.courseId === courseId);
  const topUpRunning = topUps.some(t => t.status === "running");
  const drillable = termTasks(state, { courseId }).length;
  const ai = Boolean(aiBridge());
  const allIds = (ix.conceptsByCourse[courseId] || []).map(c => c.id);

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
  const rebuild = (label, conceptIds, sectionId = null) => setRebuildScope({
    label, conceptIds, start: (ids) => bg.rebuild({ label, courseId, sectionId, conceptIds: ids }),
  });
  // Terms drill: the vocabulary of everything you've started, rapid-fire.
  const drill = (scope, title) => {
    const tasks = termTasks(state, scope);
    if (tasks.length) nav.startSession({ tasks, mode: "practice", title: `Terms: ${title}` });
  };
  const deleteCourse = () => {
    // The saved PDF or paste goes with the last course it was filling.
    jobs.forEach(j => { if (!dropJobCourse(j, course.id)) bookBridge()?.remove(j.bookId); });
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
              {course.status !== "active" && <span className="muted small">{COURSE_STATUS[course.status].label}</span>}
              <span className="grow"/>
              <div className="page-actions">
                <button className="btn btn-primary" onClick={() => practice({ courseId }, course.name)} disabled={!m.introduced}><Icon name="play"/>Practice</button>
                {drillable > 0 && <button className="btn" onClick={() => drill({ courseId }, course.name)}><Icon name="bulb"/>Drill terms</button>}
                <Menu label="More for this course" trigger="btn btn-quiet btn-icon">
                  {Object.entries(COURSE_STATUS).map(([k, v]) => (
                    <MenuItem key={k} icon={course.status === k ? "check" : "blank"} title={v.blurb}
                      onClick={() => act("course/update", { id: course.id, patch: { status: k } })}>{v.label}</MenuItem>
                  ))}
                  <MenuItem icon="pen" disabled={!sections.some(s => !s.locked)} onClick={() => nav.go("teach", { courseId })}>Teach back</MenuItem>
                  <MenuItem icon="map" onClick={() => nav.go("map", { courseId })}>Show on map</MenuItem>
                  <MenuItem icon="edit" onClick={() => setEditing(true)}>Edit course</MenuItem>
                  <MenuItem icon="plus" onClick={() => nav.go("import", { courseId })}>Add material</MenuItem>
                  {ai && <MenuItem icon="sparkle" disabled={topUpRunning} onClick={() => topUp(course.name, allIds)}>Write more questions</MenuItem>}
                  {ai && <MenuItem icon="wand" disabled={topUpRunning} onClick={() => rebuild(course.name, allIds)}>Rebuild as ladders</MenuItem>}
                  <MenuItem icon="trash" danger onClick={() => setDeleting(true)}>Delete course</MenuItem>
                </Menu>
              </div>
            </div>
          </div>
        </div>
      </header>

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
        <Outline>
          {sections.map(s => {
            const sm = sectionMastery(state, s.id, now);
            const concepts = ix.conceptsBySection[s.id] || [];
            const drillHere = !s.locked && termTasks(state, { courseId, sectionId: s.id }).length > 0;
            return (
              <OutlineItem key={s.id} id={`sec-${s.id}`} title={s.title} titleIcon={s.locked ? "lock" : null}
                open={open.has(s.id)} onToggle={() => toggle(s.id)}
                side={s.locked
                  ? <button className="btn btn-sm" onClick={() => act("section/lock", { id: s.id, locked: false })}><Icon name="check"/>Mark as read</button>
                  : <><span className="outline-pct num">{pct(sm.masteryPct)}</span><Bar value={sm.masteryPct} tone="good" thin/></>}>
                {concepts.map(c => (
                  <ConceptRow key={c.id} concept={c} status={sm.per[c.id]?.status ?? "new"} onOpen={setConceptId}/>
                ))}
                <OutlineActions>
                  {!s.locked && <button className="btn btn-sm" onClick={() => practice({ sectionId: s.id }, s.title)} disabled={!sm.introduced}><Icon name="play"/>Practice</button>}
                  {drillHere && <button className="btn btn-sm" onClick={() => drill({ courseId, sectionId: s.id }, s.title)}><Icon name="bulb"/>Drill terms</button>}
                  <span className="grow"/>
                  <Menu label={`More for ${s.title}`}>
                    {!s.locked && <MenuItem icon="pen" onClick={() => nav.go("teach", { courseId, sectionId: s.id })}>Teach it back</MenuItem>}
                    {!sectionStarted(state, s.id) && concepts.length > 0 && <MenuItem icon="target" onClick={() => pretest(s)}>Pretest</MenuItem>}
                    {ai && <MenuItem icon="sparkle" disabled={topUpRunning} onClick={() => topUp(s.title, concepts.map(c => c.id), s.id)}>Write more questions</MenuItem>}
                    {ai && <MenuItem icon="wand" disabled={topUpRunning} onClick={() => rebuild(s.title, concepts.map(c => c.id), s.id)}>Rebuild as ladders</MenuItem>}
                    {!s.locked && s.pages && <MenuItem icon="lock" onClick={() => act("section/lock", { id: s.id, locked: true })}>Lock until read</MenuItem>}
                    <MenuItem icon="trash" danger onClick={() => setRemoving(s)}>Remove section</MenuItem>
                  </Menu>
                </OutlineActions>
              </OutlineItem>
            );
          })}
          {waiting.map(({ job, c, i }) => (
            <OutlineItem key={`${job.id}-${i}`} title={c.title} waiting
              lead={c.status === "reading" || c.status === "writing" ? <Spinner/> : <Icon name={c.status === "failed" ? "alert" : job.source === "text" ? "note" : "lock"}/>}
              meta={<>
                <span>{c.status === "pending" && job.status === "paused" ? "Paused" : c.status === "writing" && c.mode === "batch" ? "Writing questions (half-price batch)…" : CHAPTER_STATUS[c.status]}</span>
                {c.status === "failed" && c.error && <span className="warn">{c.error}</span>}
              </>}
              side={job.source !== "text" && (
                <label className="check-label" title="Unlock this chapter as soon as it's imported">
                  <input type="checkbox" checked={Boolean(c.read)} onChange={() => importer.setRead(job.id, i, !c.read)}/>Read
                </label>
              )}/>
          ))}
        </Outline>
      )}

      {conceptId && <ConceptPanel conceptId={conceptId} onOpen={setConceptId} onClose={() => setConceptId(null)}/>}
      {editing && <CourseForm course={course} onClose={() => setEditing(false)} onSave={(patch) => { act("course/update", { id: course.id, patch }); setEditing(false); }}/>}
      {adding && <ItemForm courseId={courseId} onClose={() => setAdding(null)}/>}
      {topUpScope && <TopUpModal scope={topUpScope} onClose={() => setTopUpScope(null)} onStart={topUpScope.start}/>}
      {rebuildScope && <RebuildModal scope={rebuildScope} onClose={() => setRebuildScope(null)} onStart={rebuildScope.start}/>}
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

// A course, kept bare and on one centre line: its name, the book under it
// with whether it's Active, Maintaining or Paused, then its chapters across
// the page (each with how much is mastered), opening to show their concepts.
// Practice happens on Today. The ⋯ menu holds only the status, Edit course
// and Delete course (which asks first).

import { useEffect, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useBackground } from "../../state/background.jsx";
import { useSync } from "../../state/sync.jsx";
import { useBookImport, bookBridge } from "../../state/bookImport.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, EmptyState } from "../../ui/layout.jsx";
import { Menu, MenuItem, ConfirmDialog } from "../../ui/overlays.jsx";
import { Spinner } from "../../ui/display.jsx";
import { CoverArt } from "../../ui/Cover.jsx";
import { cx } from "../../ui/cx.js";
import { index, COURSE_STATUS, jobCourseIds, chapterCourse, dropJobCourse } from "../../lib/model.js";
import { sectionMastery } from "../../lib/mastery.js";
import { aiBridge } from "../../lib/ai.js";
import { pct, plural } from "../../lib/format.js";
import { Outline, OutlineItem, ConceptRow, OutlineActions } from "../concepts/Outline.jsx";
import ConceptPanel from "../concepts/ConceptPanel.jsx";
import ItemForm from "../concepts/ItemForm.jsx";
import CourseForm from "./CourseForm.jsx";
import { JobBanner, TopUpBanner } from "./CourseBanners.jsx";

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

  const sections = ix.sectionsByCourse[courseId] || [];
  const shelfItem = state.shelf.find(it => it.courseId === courseId) || null;
  // A book being imported into this course, or a pasted guide with chapters for it.
  const jobs = state.bookJobs.filter(j => jobCourseIds(j).includes(courseId));
  const waiting = jobs.flatMap(job => job.chapters.map((c, i) => ({ job, c, i }))
    .filter(x => x.c.include && x.c.status !== "done" && chapterCourse(job, x.c) === courseId));
  const topUps = bg.tasks.filter(t => t.courseId === courseId);
  const ai = Boolean(aiBridge());
  const concepts = ix.conceptsByCourse[courseId] || [];
  const questions = concepts.reduce((n, c) => n + (ix.itemsByConcept[c.id] || []).length, 0);

  const toggle = (id) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const deleteCourse = () => {
    // The saved PDF or paste goes with the last course it was filling.
    jobs.forEach(j => { if (!dropJobCourse(j, course.id)) bookBridge()?.remove(j.bookId); });
    act("course/delete", { id: course.id });
    nav.go("courses");
  };

  return (
    <Page className="course-page">
      <div className="course-topbar">
        <button className="crumb" onClick={() => nav.go("courses")}><Icon name="back"/>Courses</button>
        <Menu label="More for this course" trigger="btn btn-quiet btn-icon">
          {Object.entries(COURSE_STATUS).map(([k, v]) => (
            <MenuItem key={k} icon={course.status === k ? "check" : "blank"} title={v.blurb}
              onClick={() => act("course/update", { id: course.id, patch: { status: k } })}>{v.label}</MenuItem>
          ))}
          <MenuItem icon="edit" onClick={() => setEditing(true)}>Edit course</MenuItem>
          <MenuItem icon="trash" danger onClick={() => setDeleting(true)}>Delete course</MenuItem>
        </Menu>
      </div>

      <header className="course-hero">
        <h1 className="page-title course-title">{course.name}</h1>
        <CoverArt src={shelfItem?.cover || null} title={shelfItem?.title || course.name} className="course-cover"/>
        <div className={cx("course-status", course.status)} title={COURSE_STATUS[course.status].blurb}>
          <span className="course-status-dot" aria-hidden="true"/>{COURSE_STATUS[course.status].label}
        </div>
      </header>

      {(jobs.length > 0 || topUps.length > 0) && (
        <div className="stack">
          {jobs.map(job => <JobBanner key={job.id} job={job} device={device}/>)}
          {topUps.map(t => <TopUpBanner key={t.id} task={t} onDismiss={() => bg.dismiss(t.id)}/>)}
        </div>
      )}

      <div className="course-chapters">
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
              const here = ix.conceptsBySection[s.id] || [];
              return (
                <OutlineItem key={s.id} id={`sec-${s.id}`} title={s.title} titleIcon={s.locked ? "lock" : null}
                  open={open.has(s.id)} onToggle={() => toggle(s.id)}
                  side={s.locked
                    ? <button className="btn btn-sm" onClick={() => act("section/lock", { id: s.id, locked: false })}><Icon name="check"/>Mark as read</button>
                    : <span className="outline-pct num">{pct(sm.masteryPct)}</span>}>
                  {here.map(c => (
                    <ConceptRow key={c.id} concept={c} status={sm.per[c.id]?.status ?? "new"} onOpen={setConceptId}/>
                  ))}
                  <OutlineActions>
                    <span className="grow"/>
                    <Menu label={`More for ${s.title}`}>
                      {!s.locked && s.pages && <MenuItem icon="lock" onClick={() => act("section/lock", { id: s.id, locked: true })}>Lock until read</MenuItem>}
                      <MenuItem icon="trash" danger onClick={() => setRemoving(s)}>Remove chapter</MenuItem>
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
      </div>

      {conceptId && <ConceptPanel conceptId={conceptId} onOpen={setConceptId} onClose={() => setConceptId(null)}/>}
      {editing && <CourseForm course={course} onClose={() => setEditing(false)} onSave={(patch) => { act("course/update", { id: course.id, patch }); setEditing(false); }}/>}
      {adding && <ItemForm courseId={courseId} onClose={() => setAdding(null)}/>}
      {deleting && (
        <ConfirmDialog title={`Delete ${course.name}?`} action="Delete course" onConfirm={deleteCourse} onClose={() => setDeleting(false)}>
          This deletes {plural(sections.length, "chapter")}, {plural(concepts.length, "concept")} and {plural(questions, "question")}, with every answer and review schedule in them. It can't be undone.
        </ConfirmDialog>
      )}
      {removing && (
        <ConfirmDialog title="Remove this chapter?" action="Remove chapter" onConfirm={() => act("section/delete", { id: removing.id })} onClose={() => setRemoving(null)}>
          {removing.title} will be removed with its concepts, questions and history. You can add the material again afterwards.
        </ConfirmDialog>
      )}
    </Page>
  );
}

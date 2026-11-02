// Courses: every course you study, active ones first, with how much is
// mastered, started and remembered. The areas made from your notes come
// after the courses you added yourself.
import { useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, PageHeader, EmptyState } from "../../ui/layout.jsx";
import { makeCourse } from "../../lib/model.js";
import CourseForm from "./CourseForm.jsx";
import CourseRow from "./CourseRow.jsx";

const STATUS_ORDER = { active: 0, maintain: 1, paused: 2 };
const fromNotes = (c) => (c.kind === "notes" ? 1 : 0);

export default function Courses() {
  const { state, act } = useStore();
  const nav = useNav();
  const [creating, setCreating] = useState(Boolean(nav.route.create));

  const create = (fields) => {
    const course = makeCourse(fields, state.courses.length);
    act("course/add", { course });
    setCreating(false);
    nav.go("course", { courseId: course.id, fresh: true });
  };

  const courses = [...state.courses]
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || fromNotes(a) - fromNotes(b) || a.createdAt - b.createdAt);
  const importBook = <button className="btn" onClick={() => nav.go("book")}><Icon name="book"/>Import a book</button>;
  const newCourse = <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus"/>New course</button>;

  return (
    <Page>
      <PageHeader title="Courses" actions={<>{importBook}{newCourse}</>}/>

      {courses.length === 0 ? (
        <EmptyState title="No courses yet" actions={<>{importBook}{newCourse}</>}>
          A course is a book, class or subject. Import a book's PDF, or start a course and add its chapters as you go.
        </EmptyState>
      ) : (
        <div className="list">
          {courses.map(c => <CourseRow key={c.id} course={c} note={c.kind === "notes" ? "From your notes" : null}/>)}
        </div>
      )}
      {creating && <CourseForm onSave={create} onClose={() => setCreating(false)}/>}
    </Page>
  );
}

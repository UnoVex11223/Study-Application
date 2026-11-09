// Courses: every course you study, active ones first, with how much is
// mastered, started and remembered. The areas made from your notes come
// after the courses you added yourself.
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, PageHeader, EmptyState } from "../../ui/layout.jsx";
import CourseRow from "./CourseRow.jsx";

const STATUS_ORDER = { active: 0, maintain: 1, paused: 2 };
const fromNotes = (c) => (c.kind === "notes" ? 1 : 0);

export default function Courses() {
  const { state } = useStore();
  const nav = useNav();

  const courses = [...state.courses]
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || fromNotes(a) - fromNotes(b) || a.createdAt - b.createdAt);
  // One way in: your notes or a guide (sorted into courses), or a book's PDF.
  const importCourse = <button className="btn btn-primary" onClick={() => nav.go("new")}><Icon name="plus"/>Import course</button>;

  return (
    <Page>
      <PageHeader title="Courses" actions={importCourse}/>

      {courses.length === 0 ? (
        <EmptyState title="No courses yet" actions={importCourse}>
          Import your notes or a guide (Tenax sorts them into courses), or a book's PDF.
        </EmptyState>
      ) : (
        <div className="list">
          {courses.map(c => <CourseRow key={c.id} course={c} note={c.kind === "notes" ? "From your notes" : null}/>)}
        </div>
      )}
    </Page>
  );
}

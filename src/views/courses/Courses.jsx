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
  const importBook = <button className="btn" onClick={() => nav.go("book")}><Icon name="book"/>Import a book</button>;
  // A new course starts from a paste (which can make several); an empty one is a link on that page.
  const newCourse = <button className="btn btn-primary" onClick={() => nav.go("new")}><Icon name="plus"/>New course</button>;

  return (
    <Page>
      <PageHeader title="Courses" actions={<>{importBook}{newCourse}</>}/>

      {courses.length === 0 ? (
        <EmptyState title="No courses yet" actions={<>{importBook}{newCourse}</>}>
          A course is a book, class or subject. Paste a guide or notes and Tenax sorts them into courses, or import a book's PDF.
        </EmptyState>
      ) : (
        <div className="list">
          {courses.map(c => <CourseRow key={c.id} course={c} note={c.kind === "notes" ? "From your notes" : null}/>)}
        </div>
      )}
    </Page>
  );
}

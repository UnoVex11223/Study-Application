// Which page shows for each route, and which sidebar item is lit for it.
//
// A route is { view, ...params }, set by nav.go(view, params) (see App.jsx).
// Some pages get a `key` from their params so opening them again from
// elsewhere (the palette, a link) starts them afresh: route.at is a fresh
// timestamp on such links, route.n counts every page change.

import Today from "../views/today/Today.jsx";
import Courses from "../views/courses/Courses.jsx";
import Course from "../views/courses/Course.jsx";
import TeachBack from "../views/courses/TeachBack.jsx";
import AddMaterial from "../views/material/AddMaterial.jsx";
import ImportBook from "../views/material/ImportBook.jsx";
import Notes from "../views/notes/Notes.jsx";
import Shelf from "../views/shelf/Shelf.jsx";
import KnowledgeMap from "../views/map/KnowledgeMap.jsx";
import Progress from "../views/progress/Progress.jsx";
import Settings from "../views/settings/Settings.jsx";

/** The Notes space is stored as a course, but it has its own page. */
const isNotesCourse = (state, courseId) => state.courses.find(c => c.id === courseId)?.kind === "notes";

export function pageFor(route, { state, plan }) {
  switch (route.view) {
    case "courses": return <Courses key={route.at ?? "courses"}/>;
    case "course": return isNotesCourse(state, route.courseId)
      ? <Notes key={route.at ?? "notes"}/>
      : <Course key={`${route.courseId}-${route.at ?? ""}`} courseId={route.courseId}/>;
    case "notes": return <Notes/>;
    case "shelf": return (
      <Shelf key={`${route.recall ? "recall" : "shelf"}-${route.at ?? route.open ?? route.add ?? route.n ?? ""}`}
        recall={Boolean(route.recall)} openItem={route.open} adding={Boolean(route.add)} year={route.year ?? null}/>
    );
    case "import": return <AddMaterial courseId={route.courseId}/>;
    case "book": return <ImportBook key={route.at ?? "book"} courseId={route.courseId}/>;
    case "teach": return <TeachBack courseId={route.courseId} sectionId={route.sectionId}/>;
    case "map": return <KnowledgeMap focusCourseId={route.courseId} focusConceptId={route.conceptId}/>;
    case "progress": return <Progress/>;
    case "settings": return <Settings/>;
    default: return <Today key={route.fix ?? "today"} plan={plan}/>;
  }
}

/** The sidebar item for a route: pages inside a course light up Courses. */
export function navItemFor(route, state) {
  if (route.courseId && isNotesCourse(state, route.courseId)) return "notes";
  if (["course", "import", "teach", "book"].includes(route.view)) return "courses";
  return route.view;
}

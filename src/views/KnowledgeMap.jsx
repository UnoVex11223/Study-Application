// The knowledge map: the 3D sky of books, chapters and concepts (SkyMap), or
// the flat map for a course's Prerequisites chart and for computers that
// can't show 3D (FlatMap). Both say when you switch course or view.
// The 3D map (and three.js) loads the first time it's opened.

import { lazy, Suspense, useState } from "react";
import FlatMap from "./FlatMap.jsx";
import { webglAvailable } from "../ui/webgl.js";

const SkyMap = lazy(() => import("./SkyMap.jsx"));

function Loading() {
  return (
    <div className="page map-page">
      <div className="page-head"><div><h1>Knowledge map</h1></div></div>
      <div className="map-wrap space sky3d"/>
    </div>
  );
}

export default function KnowledgeMap({ focusCourseId, focusConceptId }) {
  const [view, setView] = useState({ scope: focusCourseId ?? "all", mode: "orbits" });
  if (!webglAvailable() || view.mode === "prereq") {
    return <FlatMap key={`${view.scope}-${view.mode}`} focusCourseId={focusCourseId} focusConceptId={focusConceptId}
      initialScope={view.scope} initialMode={view.mode} onView={setView}/>;
  }
  return (
    <Suspense fallback={<Loading/>}>
      <SkyMap key={view.scope} scope={view.scope} focusConceptId={focusConceptId} onView={setView}/>
    </Suspense>
  );
}

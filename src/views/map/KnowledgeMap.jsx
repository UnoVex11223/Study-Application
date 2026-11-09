// The knowledge map: the 3D sky of books, chapters and concepts (SkyMap), or
// the flat map on computers that can't show 3D (FlatMap). Everything you
// study, or one course's when "Show on map" opens it at a concept. The 3D map
// (and three.js) loads the first time it's opened.

import { lazy, Suspense } from "react";
import { Page } from "../../ui/layout.jsx";
import { MapHeader } from "./MapChrome.jsx";
import FlatMap from "./FlatMap.jsx";
import { webglAvailable } from "./webgl.js";

const SkyMap = lazy(() => import("./SkyMap.jsx"));

/** The page as it will look, while the 3D map loads. */
function Loading() {
  return (
    <Page width="full" className="map-page">
      <MapHeader/>
      <div className="map-wrap space sky3d"/>
    </Page>
  );
}

export default function KnowledgeMap({ focusCourseId, focusConceptId }) {
  const scope = focusCourseId ?? "all";
  if (!webglAvailable()) return <FlatMap key={scope} focusCourseId={focusCourseId} focusConceptId={focusConceptId}/>;
  return (
    <Suspense fallback={<Loading/>}>
      <SkyMap key={scope} scope={scope} focusConceptId={focusConceptId}/>
    </Suspense>
  );
}

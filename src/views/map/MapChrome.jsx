// What both maps (the 3D sky and the flat one) put around the picture: the
// title, and the legend centred along the bottom. Nothing else: you move
// around by dragging and zoom by scrolling.

import { PageHeader } from "../../ui/layout.jsx";

export function MapHeader() {
  return <PageHeader center title="Knowledge map"/>;
}

/** What the planets' colours mean. */
export function MapLegend() {
  return (
    <div className="map-legend">
      <span><span className="orb mastered"/>Mastered</span>
      <span><span className="orb learning"/>Learning</span>
      <span><span className="orb new"/>Not started</span>
    </div>
  );
}

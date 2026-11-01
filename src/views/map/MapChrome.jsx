// What both maps (the 3D sky and the flat one) put around the picture: the
// page header with what to show, the zoom buttons, and the legend.

import { useStore } from "../../state/store.jsx";
import Icon from "../../ui/Icon.jsx";
import { PageHeader } from "../../ui/layout.jsx";
import { Segmented } from "../../ui/controls.jsx";

const MODE_OPTIONS = [["orbits", "Orbits"], ["prereq", "Prerequisites"]];

/**
 * The title, then (for one course) Orbits or Prerequisites, and which books to
 * show. `actions` go first (the time-lapse).
 */
export function MapHeader({ scope, onScope, mode = "orbits", onMode, actions }) {
  const { state } = useStore();
  const courses = state.courses.filter(c => state.concepts.some(k => k.courseId === c.id && !k.suspended));
  return (
    <PageHeader title="Knowledge map" actions={<>
      {actions}
      {scope !== "all" && <Segmented label="Map view" options={MODE_OPTIONS} value={mode} onChange={onMode}/>}
      <select className="select map-scope" value={scope} onChange={e => onScope(e.target.value)} aria-label="Map scope">
        <option value="all">All books and courses</option>
        {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </>}/>
  );
}

export function ZoomControls({ onIn, onOut, onFit }) {
  return (
    <div className="map-zoom">
      <button className="btn btn-sm btn-icon" onClick={onIn} aria-label="Zoom in" title="Zoom in"><Icon name="zoomIn"/></button>
      <button className="btn btn-sm btn-icon" onClick={onOut} aria-label="Zoom out" title="Zoom out"><Icon name="zoomOut"/></button>
      <button className="btn btn-sm btn-icon" onClick={onFit} aria-label="Fit to screen" title="Fit to screen"><Icon name="fit"/></button>
    </div>
  );
}

/** What the planets' looks mean. `fading`, `unread` and `bridges` add those entries when they're on the map. */
export function MapLegend({ fading = false, unread = false, bridges = false }) {
  return (
    <div className="map-legend">
      <span><span className="orb mastered"/>Mastered</span>
      <span><span className="orb learning"/>Learning</span>
      <span><span className="orb slipping"/>Slipping</span>
      {fading && <span><span className="orb fading"/>Fading</span>}
      <span><span className="orb new"/>Not started</span>
      {unread && <span><span className="orb unread"/>Unread chapter</span>}
      {bridges && <span><span className="legend-line"/>Links between books</span>}
    </div>
  );
}

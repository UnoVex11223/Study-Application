// A book cover, 2:3, shaped by lib/cover.js: the picture (margins cropped,
// other shapes extended or cut to fit), or plain cloth with the
// title when there's no picture. Used on the shelf, in the course header, the
// book panel, the recall and the edit form.

import { useEffect, useSyncExternalStore } from "react";
import { analyzeCover, peekCover, subscribeCovers, clothFor } from "../lib/cover.js";

/** What lib/cover.js has worked out about a picture (null until it's looked at it). */
// eslint-disable-next-line react-refresh/only-export-components
export function useCoverInfo(src) {
  const info = useSyncExternalStore(subscribeCovers, () => (src ? peekCover(src) : null));
  useEffect(() => { if (src) analyzeCover(src); }, [src]);
  return info;
}

/** How big a cloth cover's title is set (in % of the cover's width), so the whole title fits: smaller for long titles and long words. */
function clothTitleSize(title) {
  const t = String(title || "Untitled");
  const longest = Math.max(...t.split(/\s+/).map(w => w.length), 1);
  // The title font runs about 0.6em a letter, and the cloth leaves 75% of the width for the title.
  return Math.max(6, Math.min(12.5, 90 / Math.sqrt(t.length), 116 / longest)).toFixed(2);
}

/**
 * A book cover, 2:3: the picture filling it, or plain cloth with the title.
 * `pos` moves a picture of another shape within the cover (0–1, see
 * coverWindow); left out, it's cut where it has the most detail.
 */
export function CoverArt({ src, title, author, className = "", pos = null }) {
  const info = useCoverInfo(src);
  if (!src) {
    const cloth = clothFor(title);
    return (
      <div className={`cover-art cloth ${className}`} style={{ "--cloth": cloth.bg, "--cloth-ink": cloth.ink, "--cloth-size": `${clothTitleSize(title)}cqw` }}>
        <div className="cloth-body">
          <div className="cloth-title">{title || "Untitled"}</div>
          {author && <div className="cloth-author">{author}</div>}
        </div>
      </div>
    );
  }
  if (!info) return <div className={`cover-art loading ${className}`}/>;
  return (
    <div className={`cover-art ${className}`}>
      <img className="cover-fill" src={info.src} alt="" draggable={false} style={{ "--pos": `${(pos ?? info.pos) * 100}%` }}/>
    </div>
  );
}

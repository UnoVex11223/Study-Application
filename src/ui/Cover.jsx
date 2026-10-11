// A book cover, 2:3, shaped by lib/cover.js: the picture (margins cropped,
// odd shapes set on a plate over a blurred copy), or plain cloth with the
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

/** A book cover, 2:3: the picture (margins cropped, odd shapes set on a plate), or plain cloth with the title. */
export function CoverArt({ src, title, author, className = "" }) {
  const info = useCoverInfo(src);
  if (!src) {
    const cloth = clothFor(title);
    return (
      <div className={`cover-art cloth ${className}`} style={{ "--cloth": cloth.bg, "--cloth-ink": cloth.ink }}>
        <div className="cloth-body">
          <div className="cloth-title">{title || "Untitled"}</div>
          {author && <div className="cloth-author">{author}</div>}
        </div>
      </div>
    );
  }
  if (!info) return <div className={`cover-art loading ${className}`}/>;
  if (info.fit === "fill") return <div className={`cover-art ${className}`}><img className="cover-fill" src={info.src} alt="" draggable={false}/></div>;
  return (
    <div className={`cover-art framed ${className}`}>
      <img className="cover-haze" src={info.src} alt="" draggable={false}/>
      <img className="cover-plate" src={info.src} alt="" draggable={false}/>
    </div>
  );
}

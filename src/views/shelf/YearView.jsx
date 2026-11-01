// A year on the shelf: what you finished, as a pile of books that grows as
// they land (their whole titles along the spines), and the months they fall in.

import { useMemo } from "react";
import { Page, PageHeader } from "../../ui/layout.jsx";
import { Segmented } from "../../ui/controls.jsx";
import { Figures, Figure } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { bookThickness, fitTitle } from "../../lib/cover.js";
import { yearOnShelf } from "../../lib/shelf.js";
import { seeded } from "../../lib/orbits.js";
import { pluralWord } from "../../lib/format.js";
import { lastName, useFonts, measureWith, useSpineColors } from "./typeset.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PILE_WIDTH = 420;

/** One finished book lying in the pile, its whole title along the spine. */
function Slab({ entry: e, index, onOpen }) {
  const { bg, ink } = useSpineColors(e);
  const fonts = useFonts();
  const r = (k) => seeded(e.key, k);
  const share = 0.62 + r(1) * 0.3; // of the pile's width
  const t = Math.max(20, Math.round(bookThickness(e) * 1.35));
  const author = e.category === "reading" && e.author ? lastName(e.author) : "";
  const type = useMemo(() => {
    const serif = measureWith("serif", 500);
    const sans = measureWith("sans", 700, 0.03);
    const room = PILE_WIDTH * share - 28 - 8 - (author ? sans(author, 10.5) + 18 : 0);
    return fitTitle(e.title, { length: room, across: t - 6, max: Math.min(14, t * 0.62), min: 8, leading: 1.08, measure: serif });
  }, [e.title, author, share, t, fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button className="slab" onClick={() => onOpen(e)} title={e.title}
      style={{ "--w": `${share * 100}%`, "--t": `${Math.max(t, type.across + 6)}px`, "--x": `${(r(2) - 0.5) * 22}px`,
        "--r": `${(r(3) - 0.5) * 2.4}deg`, "--spine": bg, "--spine-ink": ink, "--i": index }}>
      <span className="slab-title" style={{ "--fs": `${type.size}px` }}>{type.lines.map((l, i) => <span key={i}>{l}</span>)}</span>
      {author && <span className="slab-author">{author}</span>}
    </button>
  );
}

export default function YearView({ entries, year, onYear, onBack, onOpen, children }) {
  const y = yearOnShelf(entries, year);
  return (
    <Page className="year" key={year}>
      <PageHeader title={`${year} on your shelf`} back={{ label: "Shelf", onClick: onBack }}
        actions={y.years.length > 1 && <Segmented label="Year" options={y.years.slice(0, 6).map(yr => [yr, String(yr)])} value={year} onChange={onYear}/>}/>

      <Figures>
        <Figure value={y.books} label={`${pluralWord(y.books, "book")} finished`}/>
        <Figure value={y.pages ? y.pages.toLocaleString() : "–"} label="pages read"/>
        <Figure value={y.study} label={y.study === 1 ? "textbook or course finished" : "textbooks and courses finished"}/>
        <Figure value={y.rating == null ? "–" : y.rating.toFixed(1)} label="average rating"/>
      </Figures>

      <div className="year-body">
        <div className="year-pile">
          <div className="year-stack">
            {y.finished.map((e, i) => <Slab key={e.key} entry={e} index={i} onOpen={onOpen}/>)}
          </div>
          <div className="year-plank" aria-hidden="true"/>
          {y.finished.length === 0 && <p className="muted small year-none">Nothing finished in {year} yet.</p>}
        </div>
        <ol className="year-months">
          {MONTHS.map((m, i) => (
            <li key={m} className={cx(!y.byMonth[i].length && "empty")}>
              <span className="year-month">{m}</span>
              <span className="year-month-books">
                {y.byMonth[i].map(e => <button key={e.key} className="year-book" onClick={() => onOpen(e)}>{e.title}</button>)}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {children}
    </Page>
  );
}

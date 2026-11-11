// Page layout. Every page is a <Page> with a <PageHeader>, then its parts
// (usually <Section>s). The page spaces its parts evenly, so components don't
// add margins of their own (styles/shell.css).
//
//   <Page width="narrow">
//     <PageHeader title="Settings" back={{ label: "Courses", onClick }} actions={<button…/>}/>
//     <Section title="Inbox" count={3} actions={<button…/>}>…</Section>
//   </Page>

import Icon from "./Icon.jsx";
import { cx } from "./cx.js";

/** A page column. width: "wide" (default), "narrow" (a shorter line, same left edge) or "full" (the map). */
export function Page({ width = "wide", className, children }) {
  return <div className={cx("page", width !== "wide" && width, className)}>{children}</div>;
}

/**
 * The page's title, with an optional way back above it and actions beside it. Children go under the title row.
 * center: a top-level page's header, the title centred in large type with its actions centred under it.
 */
export function PageHeader({ title, back, actions, center = false, children }) {
  return (
    <header className={cx("page-header", center && "center")}>
      {back && <button className="crumb" onClick={back.onClick}><Icon name="back"/>{back.label}</button>}
      <div className="page-header-row">
        <h1 className="page-title">{title}</h1>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** A titled part of a page: the heading (with a count, a note or actions on the same line), then the content. */
export function Section({ title, count, note, actions, className, children }) {
  return (
    <section className={cx("page-section", className)}>
      <div className="page-section-head">
        <h2 className="page-section-title">
          {title}{count != null && <span className="page-section-count num">{count}</span>}
        </h2>
        {note && <span className="page-section-note num">{note}</span>}
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Nothing here yet: what goes here, and the actions that start it. */
export function EmptyState({ title, children, actions }) {
  return (
    <div className="panel empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="row center wrap">{actions}</div>}
    </div>
  );
}

// Banners at the top of a course page for work in progress: a book import,
// a batch of extra questions being written, and questions being rebuilt as
// ladders (both of those from earlier versions; nothing starts them now).

import { useBookImport, jobProgress } from "../../state/bookImport.jsx";
import Icon from "../../ui/Icon.jsx";
import { Bar, Spinner } from "../../ui/display.jsx";
import { plural } from "../../lib/format.js";

/** A banner: an icon (or spinner), a title with facts and a progress bar under it, and actions. */
function Banner({ lead, title, meta, progress, actions }) {
  return (
    <div className="banner">
      {lead}
      <div className="grow stack gap-1">
        <div className="strong">{title}</div>
        {meta && <div className="meta">{meta}</div>}
        {progress != null && <Bar value={progress} thin/>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

/** Progress and controls for a book being imported into this course. */
export function JobBanner({ job, device }) {
  const importer = useBookImport();
  const p = jobProgress(job);
  const progress = p.total ? p.done / p.total : 0;
  const ready = <span className="num">{p.done} of {p.total} chapters ready</span>;
  // Running on another computer: progress only; that computer controls it.
  if (job.deviceId && device && job.deviceId !== device.id && job.status !== "done") {
    return <Banner lead={<Icon name="book"/>} title={`Importing ${job.title} on ${job.deviceName || "another computer"}`}
      meta={<>{ready}{job.status === "paused" && <span>paused</span>}</>} progress={progress}/>;
  }
  if (job.status === "running" || job.status === "paused") {
    const paused = job.status === "paused";
    return (
      <Banner lead={paused ? <Icon name="pause"/> : <Spinner/>}
        title={paused ? <>Import paused{job.error && <span className="muted">: {job.error}</span>}</> : `Importing ${job.title}`}
        meta={<>{ready}{p.failed > 0 && <span>{p.failed} failed</span>}{!paused && p.active && <span className="ell">now: {p.active.title}</span>}</>}
        progress={progress}
        actions={paused
          ? <button className="btn btn-sm btn-primary" onClick={() => importer.resume(job.id)}><Icon name="play"/>Resume</button>
          : <button className="btn btn-sm" onClick={() => importer.pause(job.id)}><Icon name="pause"/>Pause</button>}/>
    );
  }
  return (
    <Banner lead={<Icon name="check"/>} title={`Imported ${p.done} of ${p.total} chapters`}
      meta={p.failed > 0 && <span>{plural(p.failed, "chapter")} failed</span>}
      actions={<>
        {p.failed > 0 && <button className="btn btn-sm" onClick={() => importer.resume(job.id)}>Retry failed</button>}
        <button className="btn btn-sm btn-quiet" onClick={() => importer.dismiss(job.id)}>Dismiss</button>
      </>}/>
  );
}

/** Progress for a question top-up (or a rebuild) running on this course. */
export function TopUpBanner({ task, onDismiss }) {
  if (task.kind === "rebuild") return <RebuildBanner task={task} onDismiss={onDismiss}/>;
  if (task.status === "running") {
    return <Banner lead={<Spinner/>} title={`Writing more questions for ${task.label}`}
      meta={<><span className="num">{task.done} of {task.total || "…"} groups</span><span>{task.added} added so far</span></>}
      progress={task.total ? task.done / task.total : 0}/>;
  }
  const failed = task.status === "failed";
  return (
    <Banner lead={<Icon name={failed ? "alert" : "check"}/>}
      title={failed ? `Couldn't write more questions for ${task.label}` : `Added ${plural(task.added, "question")} to ${plural(task.concepts ?? 0, "concept")} in ${task.label}`}
      meta={task.error && <span>{failed ? task.error : `Some groups failed: ${task.error}. Running it again fills the gaps.`}</span>}
      actions={<button className="btn btn-sm btn-quiet" onClick={onDismiss}>Dismiss</button>}/>
  );
}

function RebuildBanner({ task, onDismiss }) {
  if (task.status === "running" && task.batch) {
    return <Banner lead={<Spinner/>} title={`Rebuilding ${task.label} as ladders, at half price`}
      meta={<><span>{task.stage === "critique" ? "Reviewing the questions" : "Writing the questions"}</span><span>usually a few minutes, sometimes up to an hour; you can close Tenax meanwhile</span></>}/>;
  }
  if (task.status === "running") {
    return <Banner lead={<Spinner/>} title={`Rebuilding ${task.label} as ladders`}
      meta={<><span className="num">{task.done} of {task.total || "…"} groups</span><span>{plural(task.rebuilt, "concept")} rebuilt so far</span></>}
      progress={task.total ? task.done / task.total : 0}/>;
  }
  const failed = task.status === "failed";
  return (
    <Banner lead={<Icon name={failed ? "alert" : "check"}/>}
      title={failed ? `Couldn't rebuild ${task.label}` : `Rebuilt ${plural(task.rebuilt, "concept")} in ${task.label} as ladders (${plural(task.steps ?? 0, "step")})`}
      meta={task.error
        ? <span>{failed ? task.error : `Some groups failed: ${task.error}. Running it again picks up the concepts that weren't rebuilt.`}</span>
        : !failed && task.rebuilt < (task.concepts ?? 0) && <span>{plural(task.concepts - task.rebuilt, "concept")} kept {task.concepts - task.rebuilt === 1 ? "its" : "their"} questions: nothing better passed the review.</span>}
      actions={<button className="btn btn-sm btn-quiet" onClick={onDismiss}>Dismiss</button>}/>
  );
}

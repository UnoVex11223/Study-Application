// Banners at the top of a course page for work in progress: a book import,
// and a batch of extra questions being written (with the dialog that starts one).

import { useStore } from "../../state/store.jsx";
import { useBookImport, jobProgress } from "../../state/bookImport.jsx";
import Icon from "../../ui/Icon.jsx";
import { Bar, Spinner } from "../../ui/display.jsx";
import { Modal } from "../../ui/overlays.jsx";
import { roomForQuestions } from "../../lib/ai.js";
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

/** Progress for a question top-up running on this course. */
export function TopUpBanner({ task, onDismiss }) {
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

/** Confirm topping up a chapter's or course's questions. */
export function TopUpModal({ scope, onClose, onStart }) {
  const { state } = useStore();
  const room = roomForQuestions(state, scope.conceptIds);
  const n = room.length, adds = room.reduce((sum, t) => sum + t.room, 0);
  const minutes = Math.max(1, Math.round(n / 16)), dollars = Math.max(1, Math.round(n * 0.02));
  return (
    <Modal title="Write more questions" onClose={onClose} footer={<>
      <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={!n} onClick={() => { onStart(room.map(t => t.concept.id)); onClose(); }}>Write more questions</button>
    </>}>
      {n ? (
        <div className="stack gap-2">
          <p><strong>{plural(n, "concept")}</strong> in {scope.label}: room for up to {adds} more questions.</p>
          <p className="muted small">About {plural(minutes, "minute")} in the background, roughly ${dollars} of API usage.</p>
        </div>
      ) : <p>Every concept in {scope.label} already has its full set of questions.</p>}
    </Modal>
  );
}

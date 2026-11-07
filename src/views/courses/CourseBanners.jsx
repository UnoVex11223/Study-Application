// Banners at the top of a course page for work in progress: a book import,
// a batch of extra questions being written, and questions being rebuilt as
// ladders (with the dialogs that start them).

import { useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useBookImport, jobProgress } from "../../state/bookImport.jsx";
import Icon from "../../ui/Icon.jsx";
import { Bar, Spinner } from "../../ui/display.jsx";
import { Modal } from "../../ui/overlays.jsx";
import { Segmented } from "../../ui/controls.jsx";
import { roomForQuestions, ladderCost, writerOf, WRITERS } from "../../lib/ai.js";
import { hasLadder } from "../../lib/ladder.js";
import { index } from "../../lib/model.js";
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

/** Confirm rebuilding a chapter's or course's questions as ladders. */
export function RebuildModal({ scope, onClose, onStart }) {
  const { state } = useStore();
  const ix = index(state);
  const concepts = scope.conceptIds.map(id => ix.concept[id]).filter(Boolean);
  const pending = concepts.filter(c => !hasLadder(ix, c));
  const pool = pending.length ? pending : concepts;
  // Concepts you've started are the ones worth rebuilding now; the rest can wait until you reach them.
  const begun = pool.filter(c => (c.srs && c.srs.state !== "new") || (ix.attemptsByConcept[c.id] || []).length);
  const [which, setWhich] = useState(begun.length && begun.length < pool.length ? "started" : "all");
  const ids = (which === "started" ? begun : pool).map(c => c.id);
  const n = ids.length;
  const batch = state.settings.batchImports !== false;
  const writer = writerOf(state);
  const [lo, hi] = ladderCost(n, { writer, batch });
  const money = (x) => (x < 1 ? `${Math.max(1, Math.round(x * 100))}¢` : `$${Math.round(x)}`);
  const time = batch ? "usually a few minutes, sometimes up to an hour" : `about ${plural(Math.max(1, Math.round(n / 12)), "minute")}`;
  return (
    <Modal title="Rebuild as ladders" onClose={onClose} footer={<>
      <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={!n} onClick={() => { onStart(ids); onClose(); }}>{pending.length || !n ? "Rebuild" : "Rebuild again"}</button>
    </>}>
      <div className="stack gap-3">
        {pending.length > 0 || !concepts.length
          ? <p><strong>{plural(n, "concept")}</strong> in {scope.label} will get a ladder of small questions, simplest first: the term, one rule, a small problem, a twist, and using it with what it builds on.</p>
          : <p>Every concept in {scope.label} is already a ladder. Rebuilding writes {n === 1 ? "its ladder" : `all ${n} ladders`} again.</p>}
        {begun.length > 0 && begun.length < pool.length && (
          <Segmented label="Which concepts" value={which} onChange={setWhich} options={[
            ["started", `Started so far (${begun.length})`, "The concepts you've already met. The rest can be rebuilt when you reach them."],
            ["all", `All ${pool.length}`, "Every concept in scope, including ones you haven't started yet."],
          ]}/>
        )}
        <ul className="bullets small">
          <li>A current question that already fits as a step is kept, with its history. The rest are replaced.</li>
          <li>Questions you wrote yourself and code questions with tests are kept as they are.</li>
          <li>Each concept keeps its memory schedule; only its questions change. Concepts also get a lesson (their terms and a worked example) if they don't have one.</li>
          <li>A concept nothing better passes the review for keeps its questions.</li>
        </ul>
        <p className="muted small">
          In the background, {time}. Roughly {money(lo)}–{money(hi)} of API usage
          ({batch ? "half-price batch" : "full price"}, {WRITERS[writer].label.toLowerCase()} question writing; both are in Settings). Try one chapter first to see if you like it.
        </p>
      </div>
    </Modal>
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

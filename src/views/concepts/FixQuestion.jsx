// Actions for a flagged question: rewrite it with Claude (the proposal passes
// the same rule checks as new questions), restore it as is, or delete it.

import { useState } from "react";
import { useStore } from "../../state/store.jsx";
import Icon from "../../ui/Icon.jsx";
import Markdown from "../../ui/Markdown.jsx";
import { Notice, Spinner } from "../../ui/display.jsx";
import { FLAG_REASONS } from "../../lib/quality.js";
import { rewriteQuestion, aiBridge } from "../../lib/ai.js";
import { abilityLabel } from "../../lib/model.js";

export default function FixQuestion({ item, concept }) {
  const { act } = useStore();
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState("");

  const rewrite = async () => {
    setBusy(true); setError("");
    const res = await rewriteQuestion({ item, concept, problem: FLAG_REASONS[item.flag?.reason] ?? "Needs improvement", note: item.flag?.note });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setProposal(res);
  };

  const accept = () => {
    const q = proposal.question;
    act("item/replace", { id: item.id, fields: { ability: q.ability, prompt: q.prompt, answer: q.answer, accept: q.accept, points: q.points.length ? q.points : [q.answer], misconceptions: q.misconceptions, hint: q.hint } });
    setProposal(null);
  };
  const remove = () => act("item/delete", { id: item.id });
  const blockers = proposal?.issues?.filter(i => i.severity === "block") ?? [];

  return (
    <div className="stack">
      <div className="row wrap">
        {aiBridge() && !proposal && (
          <button className="btn btn-sm btn-primary" onClick={rewrite} disabled={busy}>{busy ? <Spinner/> : <Icon name="wand"/>}Rewrite with Claude</button>
        )}
        <button className="btn btn-sm" onClick={() => act("item/unflag", { id: item.id })}><Icon name="undo"/>Restore as is</button>
        <button className="btn btn-sm btn-danger" onClick={remove}><Icon name="trash"/>Delete</button>
      </div>
      {error && <Notice tone="bad" icon="alert">{error}</Notice>}
      {proposal && (
        <div className="proposal stack enter">
          {proposal.worthKeeping === false ? (
            <>
              <p className="small"><strong>Claude suggests deleting this question.</strong> {proposal.reason}</p>
              <div className="row wrap">
                <button className="btn btn-sm btn-danger" onClick={remove}>Delete it</button>
                <button className="btn btn-sm btn-quiet" onClick={() => setProposal(null)}>Keep it</button>
              </div>
            </>
          ) : (
            <>
              <div className="small muted">Proposed {abilityLabel(proposal.question.ability).toLowerCase()} question. {proposal.reason}</div>
              <Markdown>{proposal.question.prompt}</Markdown>
              <Markdown className="small">{proposal.question.answer}</Markdown>
              {blockers.length > 0 && <div className="error-text">{blockers[0].message}</div>}
              <div className="row wrap">
                <button className="btn btn-sm btn-primary" onClick={accept} disabled={blockers.length > 0}>Use this version</button>
                <button className="btn btn-sm" onClick={rewrite} disabled={busy}>{busy && <Spinner/>}Try again</button>
                <button className="btn btn-sm btn-quiet" onClick={() => setProposal(null)}>Discard</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

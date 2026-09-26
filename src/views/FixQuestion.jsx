// Actions for a flagged question: rewrite it with Claude (the proposal passes
// the same rule checks as new questions), restore it as is, or delete it.

import { useState } from "react";
import { useStore } from "../state/store.jsx";
import { Notice, Spinner } from "../ui/ui.jsx";
import { abilityLabel } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import Markdown from "../ui/Markdown.jsx";
import { FLAG_REASONS } from "../lib/quality.js";
import { rewriteQuestion, aiBridge } from "../lib/ai.js";

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

  const blockers = proposal?.issues?.filter(i => i.severity === "block") ?? [];

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row-wrap">
        {aiBridge() && !proposal && (
          <button className="btn btn-sm btn-primary" onClick={rewrite} disabled={busy}>
            {busy ? <Spinner/> : <Icon name="wand" size={14}/>}Rewrite with Claude
          </button>
        )}
        <button className="btn btn-sm" onClick={() => act("item/unflag", { id: item.id })}><Icon name="undo" size={14}/>Restore as is</button>
        <button className="btn btn-sm btn-danger" onClick={() => act("item/delete", { id: item.id })}><Icon name="trash" size={14}/>Delete</button>
      </div>
      {error && <Notice tone="bad" icon="alert">{error}</Notice>}
      {proposal && (
        <div className="proposal enter">
          {proposal.worthKeeping === false ? (
            <>
              <p className="small" style={{ margin: 0 }}><strong>Claude suggests deleting this question.</strong> {proposal.reason}</p>
              <div className="row-wrap" style={{ marginTop: 10 }}>
                <button className="btn btn-sm btn-danger" onClick={() => act("item/delete", { id: item.id })}>Delete it</button>
                <button className="btn btn-sm btn-quiet" onClick={() => setProposal(null)}>Keep it</button>
              </div>
            </>
          ) : (
            <>
              <div className="small muted" style={{ marginBottom: 6 }}>Proposed {abilityLabel(proposal.question.ability).toLowerCase()} question. {proposal.reason}</div>
              <Markdown>{proposal.question.prompt}</Markdown>
              <div className="small" style={{ marginTop: 8 }}><Markdown>{proposal.question.answer}</Markdown></div>
              {blockers.length > 0 && <div className="small review-reason" style={{ marginTop: 8 }}>{blockers[0].message}</div>}
              <div className="row-wrap" style={{ marginTop: 10 }}>
                <button className="btn btn-sm btn-primary" onClick={accept} disabled={blockers.length > 0}>Use this version</button>
                <button className="btn btn-sm" onClick={rewrite} disabled={busy}>{busy ? <Spinner/> : null}Try again</button>
                <button className="btn btn-sm btn-quiet" onClick={() => setProposal(null)}>Discard</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

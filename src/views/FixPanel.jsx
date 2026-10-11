// The questions taken out of your sessions (reported, missed on 5 different
// days, or overruled twice), in a panel: rewrite each with Claude, restore it
// as is, or delete it. Opened from Today (and from search).

import { useStore } from "../state/store.jsx";
import { Drawer } from "../ui/ui.jsx";
import Markdown from "../ui/Markdown.jsx";
import FixQuestion from "./FixQuestion.jsx";
import { index } from "../lib/model.js";
import { FLAG_REASONS } from "../lib/quality.js";

export default function FixPanel({ onClose }) {
  const { state } = useStore();
  const ix = index(state);
  const flagged = state.items.filter(i => i.flag).sort((a, b) => (b.flag.at || 0) - (a.flag.at || 0));
  return (
    <Drawer onClose={onClose} title="Questions to fix">
      {flagged.length === 0 && <p className="muted">Nothing to fix. Every question is back in your sessions.</p>}
      {flagged.map(it => {
        const c = ix.concept[it.conceptId];
        return (
          <section key={it.id} className="fix-item">
            <div className="section-stats"><span>{c?.name ?? "Deleted concept"}</span><span>{(FLAG_REASONS[it.flag.reason] ?? "flagged").toLowerCase()}</span></div>
            <Markdown>{it.prompt}</Markdown>
            {c && <FixQuestion item={it} concept={c}/>}
          </section>
        );
      })}
    </Drawer>
  );
}

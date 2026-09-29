import { useState } from "react";
import { useStore } from "../state/store.jsx";
import { Modal, Notice } from "../ui/ui.jsx";
import { lintQuestion } from "../lib/quality.js";
import { index, makeConcept, makeItem, makeSection, ABILITIES, ABILITY_KEYS, IMPORTANCE } from "../lib/model.js";

const lines = (s) => s.split("\n").map(x => x.trim()).filter(Boolean);

/** Edit an existing question, or add one (optionally creating its concept and section). */
export default function ItemForm({ courseId, item, conceptId: fixedConcept, sectionId: fixedSection, onClose }) {
  const { state, act } = useStore();
  const ix = index(state);
  const editing = Boolean(item);
  const sections = ix.sectionsByCourse[courseId] || [];

  const [sectionId, setSectionId] = useState(fixedSection ?? ix.concept[fixedConcept]?.sectionId ?? sections[0]?.id ?? "__new");
  const [newSection, setNewSection] = useState("");
  const [conceptId, setConceptId] = useState(fixedConcept ?? item?.conceptId ?? "__new");
  const [conceptName, setConceptName] = useState("");
  const [importance, setImportance] = useState("core");
  const [ability, setAbility] = useState(item?.ability ?? "explain");
  const [prompt, setPrompt] = useState(item?.prompt ?? "");
  const [answer, setAnswer] = useState(item?.answer ?? "");
  const [points, setPoints] = useState((item?.points ?? []).join("\n"));
  const [accept, setAccept] = useState((item?.accept ?? []).join("\n"));
  const [misc, setMisc] = useState((item?.misconceptions ?? []).join("\n"));
  const [hint, setHint] = useState(item?.hint ?? "");

  const conceptsHere = sectionId === "__new" ? [] : (ix.conceptsBySection[sectionId] || []);
  const valid = prompt.trim() && answer.trim()
    && (editing || conceptId !== "__new" || conceptName.trim())
    && (editing || sectionId !== "__new" || newSection.trim() || conceptId !== "__new");

  // The same rule checks new questions go through, shown as advice while you type.
  const lint = prompt.trim() && answer.trim()
    ? lintQuestion({ ability, prompt, answer, accept: lines(accept), points: lines(points).length ? lines(points) : [answer] })
    : { issues: [] };

  const save = () => {
    if (!valid) return;
    const fields = {
      ability, prompt: prompt.trim(), answer: answer.trim(),
      points: lines(points).length ? lines(points) : [answer.trim()],
      accept: ability === "recall" ? lines(accept) : [],
      misconceptions: lines(misc), hint: hint.trim(),
    };
    if (editing) { act("item/update", { id: item.id, patch: fields }); onClose(); return; }

    let secId = sectionId;
    if (conceptId === "__new" && sectionId === "__new") {
      const order = Math.max(-1, ...sections.map(s => s.order)) + 1;
      const s = makeSection({ courseId, title: newSection.trim(), order });
      act("section/add", { section: s });
      secId = s.id;
    }
    let cid = conceptId;
    if (conceptId === "__new") {
      const c = makeConcept({ courseId, sectionId: secId, name: conceptName.trim(), summary: answer.trim().slice(0, 400), importance, order: conceptsHere.length });
      act("import", { payload: { concepts: [c] } });
      cid = c.id;
    }
    act("item/add", { item: makeItem({ conceptId: cid, ...fields }) });
    onClose();
  };

  return (
    <Modal title={editing ? "Edit question" : "Add a question"} onClose={onClose} width="min(640px, 94vw)"
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!valid}>{editing ? "Save changes" : "Add question"}</button>
      </>}>
      {!editing && !fixedConcept && (
        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <div className="field grow">
            <label htmlFor="if-section">Section</label>
            <select id="if-section" className="select" value={sectionId} onChange={e => { setSectionId(e.target.value); setConceptId("__new"); }}>
              {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              <option value="__new">New section…</option>
            </select>
            {sectionId === "__new" && <input className="input" aria-label="New section name" value={newSection} onChange={e => setNewSection(e.target.value)} autoFocus/>}
          </div>
          <div className="field grow">
            <label htmlFor="if-concept">Concept</label>
            <select id="if-concept" className="select" value={conceptId} onChange={e => setConceptId(e.target.value)}>
              {conceptsHere.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new">New concept…</option>
            </select>
            {conceptId === "__new" && <input className="input" aria-label="New concept name" value={conceptName} onChange={e => setConceptName(e.target.value)}/>}
          </div>
        </div>
      )}
      {!editing && conceptId === "__new" && (
        <div className="field">
          <span className="label">Importance</span>
          <div className="seg">
            {Object.entries(IMPORTANCE).map(([k, v]) => <button key={k} type="button" className={importance === k ? "on" : ""} onClick={() => setImportance(k)}>{v.label}</button>)}
          </div>
        </div>
      )}
      <div className="field">
        <span className="label">Type of question</span>
        <div className="seg">
          {ABILITY_KEYS.map(k => <button key={k} type="button" className={ability === k ? "on" : ""} onClick={() => setAbility(k)}>{ABILITIES[k].label}</button>)}
        </div>
      </div>
      <div className="field">
        <label htmlFor="if-prompt">Question</label>
        <textarea id="if-prompt" className="textarea" style={{ minHeight: 70 }} value={prompt} onChange={e => setPrompt(e.target.value)}/>
      </div>
      <div className="field">
        <label htmlFor="if-answer">Model answer</label>
        <textarea id="if-answer" className="textarea" style={{ minHeight: 70 }} value={answer} onChange={e => setAnswer(e.target.value)}/>
      </div>
      {ability === "recall" && (
        <div className="field">
          <label htmlFor="if-accept">Accepted answers, one per line</label>
          <textarea id="if-accept" className="textarea" style={{ minHeight: 56 }} value={accept} onChange={e => setAccept(e.target.value)}/>
        </div>
      )}
      <div className="field">
        <label htmlFor="if-points">Key points a correct answer must include, one per line</label>
        <textarea id="if-points" className="textarea" style={{ minHeight: 70 }} value={points} onChange={e => setPoints(e.target.value)}/>
      </div>
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div className="field grow">
          <label htmlFor="if-misc">Common misconceptions, one per line</label>
          <textarea id="if-misc" className="textarea" style={{ minHeight: 56 }} value={misc} onChange={e => setMisc(e.target.value)}/>
        </div>
        <div className="field grow">
          <label htmlFor="if-hint">Hint</label>
          <textarea id="if-hint" className="textarea" style={{ minHeight: 56 }} value={hint} onChange={e => setHint(e.target.value)}/>
        </div>
      </div>
      {lint.issues.length > 0 && (
        <Notice tone="warn" icon="alert">
          <strong>This question may not be worth keeping as written:</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{lint.issues.map(i => <li key={i.code}>{i.message}</li>)}</ul>
        </Notice>
      )}
    </Modal>
  );
}

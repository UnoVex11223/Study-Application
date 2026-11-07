// Edit a question, or add one (optionally creating its concept and section).
// Questions you write get the same rule checks as Claude's, shown as advice
// while you type, and can carry tests that check code answers by running them.

import { useState } from "react";
import { useStore } from "../../state/store.jsx";
import Icon from "../../ui/Icon.jsx";
import { Modal } from "../../ui/overlays.jsx";
import { Field, Segmented } from "../../ui/controls.jsx";
import { Notice, Spinner } from "../../ui/display.jsx";
import { aiBridge, writeTests } from "../../lib/ai.js";
import { CODE_LANGS, guessLang, runCode } from "../../lib/code.js";
import { lintQuestion } from "../../lib/quality.js";
import { index, makeConcept, makeItem, makeSection, ABILITIES, ABILITY_KEYS, IMPORTANCE, LEVELS, LEVEL_KEYS, levelOf } from "../../lib/model.js";

const NEW = "__new";
const lines = (s) => s.split("\n").map(x => x.trim()).filter(Boolean);
const ABILITY_OPTIONS = ABILITY_KEYS.map(k => [k, ABILITIES[k].label]);
const LEVEL_OPTIONS = LEVEL_KEYS.map(l => [String(l), `${l} ${LEVELS[l].label}`, LEVELS[l].blurb]);
const IMPORTANCE_OPTIONS = Object.entries(IMPORTANCE).map(([k, v]) => [k, v.label]);
const LANG_OPTIONS = Object.entries(CODE_LANGS).map(([k, l]) => [k, l.label]);
const TEST_PLACEHOLDER = {
  c: "#include <assert.h>\nint main(void) { assert(add(2, 3) == 5); return 0; }",
  javascript: "const assert = require(\"node:assert\");\nassert.equal(add(2, 3), 5);",
  python: "assert add(2, 3) == 5",
};

export default function ItemForm({ courseId, item, conceptId: fixedConcept, sectionId: fixedSection, onClose }) {
  const { state, act } = useStore();
  const ix = index(state);
  const editing = Boolean(item);
  const sections = ix.sectionsByCourse[courseId] || [];

  const [sectionId, setSectionId] = useState(fixedSection ?? ix.concept[fixedConcept]?.sectionId ?? sections[0]?.id ?? NEW);
  const [newSection, setNewSection] = useState("");
  const [conceptId, setConceptId] = useState(fixedConcept ?? item?.conceptId ?? NEW);
  const [conceptName, setConceptName] = useState("");
  const [importance, setImportance] = useState("core");
  const [ability, setAbility] = useState(item?.ability ?? "explain");
  const [level, setLevel] = useState(String(item ? levelOf(item) : 2));
  const [shape, setShape] = useState(item?.shape ?? "");
  const [prompt, setPrompt] = useState(item?.prompt ?? "");
  const [answer, setAnswer] = useState(item?.answer ?? "");
  const [points, setPoints] = useState((item?.points ?? []).join("\n"));
  const [accept, setAccept] = useState((item?.accept ?? []).join("\n"));
  const [misc, setMisc] = useState((item?.misconceptions ?? []).join("\n"));
  const [hint, setHint] = useState(item?.hint ?? "");
  // Code questions: tests run against your answer instead of grading it against the key points.
  const [showTests, setShowTests] = useState(Boolean(item?.tests?.code));
  const [lang, setLang] = useState(item?.tests?.lang ?? guessLang(item?.answer) ?? "python");
  const [tests, setTests] = useState(item?.tests?.code ?? "");
  const [testState, setTestState] = useState(null); // { busy } | { passed, output } | { error }
  const [testNote, setTestNote] = useState("");

  // Tests are only trusted once the model answer passes them.
  const checkTests = async (code = tests) => {
    setTestState({ busy: "Running the tests against the model answer…" });
    const r = await runCode({ lang, solution: answer, tests: code });
    setTestState(r.ok ? { passed: r.passed, output: r.output, stage: r.stage, timedOut: r.timedOut } : { error: r.error });
  };
  const draftTests = async () => {
    setTestState({ busy: "Writing tests…" }); setTestNote("");
    const r = await writeTests({ lang, prompt, answer });
    if (!r.ok) { setTestState({ error: r.error }); return; }
    setTests(r.tests); setTestNote(r.notes);
    await checkTests(r.tests);
  };

  const conceptsHere = sectionId === NEW ? [] : (ix.conceptsBySection[sectionId] || []);
  const valid = prompt.trim() && answer.trim()
    && (editing || conceptId !== NEW || conceptName.trim())
    && (editing || sectionId !== NEW || newSection.trim() || conceptId !== NEW);

  // The same rule checks new questions go through, shown as advice while you type.
  const lint = prompt.trim() && answer.trim()
    ? lintQuestion({ ability, level: Number(level), shape, diagram: item?.diagram ?? null, prompt, answer, accept: lines(accept), points: lines(points).length ? lines(points) : [answer] })
    : { issues: [] };

  const save = () => {
    if (!valid) return;
    const fields = {
      ability, level: Number(level), shape: shape.trim(), prompt: prompt.trim(), answer: answer.trim(),
      points: lines(points).length ? lines(points) : [answer.trim()],
      accept: lines(accept),
      misconceptions: lines(misc), hint: hint.trim(),
      tests: showTests && tests.trim() ? { lang, code: tests.replace(/\s+$/, "") } : null,
    };
    if (editing) { act("item/update", { id: item.id, patch: fields }); onClose(); return; }

    let secId = sectionId;
    if (conceptId === NEW && sectionId === NEW) {
      const order = Math.max(-1, ...sections.map(s => s.order)) + 1;
      const s = makeSection({ courseId, title: newSection.trim(), order });
      act("section/add", { section: s });
      secId = s.id;
    }
    let cid = conceptId;
    if (conceptId === NEW) {
      const c = makeConcept({ courseId, sectionId: secId, name: conceptName.trim(), summary: answer.trim().slice(0, 400), importance, order: conceptsHere.length });
      act("import", { payload: { concepts: [c] } });
      cid = c.id;
    }
    act("item/add", { item: makeItem({ conceptId: cid, ...fields }) });
    onClose();
  };

  const removeTests = () => { setShowTests(false); setTests(""); setTestState(null); };

  return (
    <Modal title={editing ? "Edit question" : "Add a question"} size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!valid}>{editing ? "Save changes" : "Add question"}</button>
      </>}>
      {!editing && !fixedConcept && (
        <div className="form-row">
          <Field label="Section" htmlFor="if-section">
            <select id="if-section" className="select" value={sectionId} onChange={e => { setSectionId(e.target.value); setConceptId(NEW); }}>
              {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              <option value={NEW}>New section…</option>
            </select>
            {sectionId === NEW && <input className="input" aria-label="New section name" placeholder="Section name" value={newSection} onChange={e => setNewSection(e.target.value)} autoFocus/>}
          </Field>
          <Field label="Concept" htmlFor="if-concept">
            <select id="if-concept" className="select" value={conceptId} onChange={e => setConceptId(e.target.value)}>
              {conceptsHere.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW}>New concept…</option>
            </select>
            {conceptId === NEW && <input className="input" aria-label="New concept name" placeholder="Concept name" value={conceptName} onChange={e => setConceptName(e.target.value)}/>}
          </Field>
        </div>
      )}
      {!editing && conceptId === NEW && (
        <Field label="Importance"><Segmented label="Importance" options={IMPORTANCE_OPTIONS} value={importance} onChange={setImportance}/></Field>
      )}
      <Field label="Type of question"><Segmented label="Type of question" options={ABILITY_OPTIONS} value={ability} onChange={setAbility}/></Field>
      <Field label="Step on the concept's ladder"><Segmented label="Step on the ladder" options={LEVEL_OPTIONS} value={level} onChange={setLevel}/></Field>
      <Field label="Question" htmlFor="if-prompt">
        <textarea id="if-prompt" className="textarea short" value={prompt} onChange={e => setPrompt(e.target.value)}/>
      </Field>
      <Field label="What form the answer takes (optional)" htmlFor="if-shape">
        <input id="if-shape" className="input" placeholder="one word, a number, what it prints…" value={shape} onChange={e => setShape(e.target.value)}/>
      </Field>
      <Field label="Model answer" htmlFor="if-answer">
        <textarea id="if-answer" className="textarea short" value={answer} onChange={e => setAnswer(e.target.value)}/>
      </Field>
      <Field label={ability === "recall" ? "Accepted answers, one per line" : "Exact answers marked right instantly, one per line (optional)"} htmlFor="if-accept">
        <textarea id="if-accept" className="textarea short" value={accept} onChange={e => setAccept(e.target.value)}/>
      </Field>
      <Field label="Key points a correct answer must include, one per line" htmlFor="if-points">
        <textarea id="if-points" className="textarea short" value={points} onChange={e => setPoints(e.target.value)}/>
      </Field>
      <div className="form-row">
        <Field label="Common misconceptions, one per line" htmlFor="if-misc">
          <textarea id="if-misc" className="textarea short" value={misc} onChange={e => setMisc(e.target.value)}/>
        </Field>
        <Field label="Hint" htmlFor="if-hint">
          <textarea id="if-hint" className="textarea short" value={hint} onChange={e => setHint(e.target.value)}/>
        </Field>
      </div>
      {!showTests ? (
        <div><button type="button" className="link small" onClick={() => setShowTests(true)}>Add tests: check answers by running code</button></div>
      ) : (
        <Field label="Tests" help={<>
          Your answer and these tests run as one file; they pass when it exits cleanly. Name the functions the answer must define in the question.
          {lang === "c" && " The tests hold main(); the answer mustn't."}
        </>}>
          <Segmented label="Language" size="sm" options={LANG_OPTIONS} value={lang} onChange={(k) => { setLang(k); setTestState(null); }}/>
          <textarea className="textarea code" value={tests} spellCheck={false} aria-label="Tests" placeholder={TEST_PLACEHOLDER[lang] ?? TEST_PLACEHOLDER.python}
            onChange={e => { setTests(e.target.value); setTestState(null); }}/>
          <div className="row wrap">
            {aiBridge() && <button type="button" className="btn btn-sm" disabled={!prompt.trim() || !answer.trim() || testState?.busy} onClick={draftTests}><Icon name="sparkle"/>Write tests with Claude</button>}
            <button type="button" className="btn btn-sm" disabled={!tests.trim() || !answer.trim() || testState?.busy} onClick={() => checkTests()}>Check against the model answer</button>
            <span className="grow"/>
            <button type="button" className="btn btn-sm btn-quiet" onClick={removeTests}>Remove tests</button>
          </div>
          {testNote && <span className="help">{testNote}</span>}
          {testState?.busy && <div className="busy small"><Spinner/>{testState.busy}</div>}
          {testState?.error && <Notice tone="warn" icon="alert">{testState.error}</Notice>}
          {testState && "passed" in testState && (testState.passed
            ? <Notice icon="check">The model answer passes these tests.</Notice>
            : (
              <Notice tone="bad" icon="alert">
                The model answer doesn't pass ({testState.timedOut ? "timed out" : testState.stage === "build" ? "it didn't compile" : "a test failed"}). Fix the tests or the model answer before relying on them.
                {testState.output && <pre className="run-output">{testState.output}</pre>}
              </Notice>
            ))}
        </Field>
      )}
      {lint.issues.length > 0 && (
        <Notice tone="warn" icon="alert">
          <strong>This question may not be worth keeping as written:</strong>
          <ul className="bullets">{lint.issues.map(i => <li key={i.code}>{i.message}</li>)}</ul>
        </Notice>
      )}
    </Modal>
  );
}

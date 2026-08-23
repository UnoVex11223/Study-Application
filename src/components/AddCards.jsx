import { useRef, useState } from "react";
import { useApp } from "./context.js";
import { Screen } from "./shared.jsx";
import { newSrs } from "../lib/fsrs.js";
import { clozeParts } from "../lib/cards.js";

const CHUNK_SIZE = 12000;

// Split long notes on paragraph boundaries so each AI call stays well-sized.
function splitChunks(text, max = CHUNK_SIZE) {
  if (text.length <= max) return [text];
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let cur = "";
  for (const p of paragraphs) {
    if (cur.length + p.length + 2 > max && cur) { chunks.push(cur); cur = ""; }
    cur += (cur ? "\n\n" : "") + p;
    while (cur.length > max) { chunks.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

const makeCard = (fields, i = 0) => ({ id: Date.now() + i, wrong: [], ...fields, srs: newSrs() });

export default function AddCards() {
  const { topics, topicId, updateTopics, setView } = useApp();
  const topic = topics.find(t => t.id === topicId);
  const cards = topic?.cards || [];
  const [tab, setTab] = useState("manual");

  // Manual basic
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");

  // Cloze
  const [clozeText, setClozeText] = useState("");
  const clozeRef = useRef(null);

  // AI
  const [noteText, setNoteText] = useState("");
  const [files, setFiles] = useState([]);       // {name, content}
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(null); // {chunk, total, cardsSoFar}
  const [genError, setGenError] = useState("");
  const fileInputRef = useRef(null);

  const addToTopic = (newCards) => {
    updateTopics(p => p.map(t => t.id !== topicId ? t : { ...t, cards: [...t.cards, ...newCards] }));
  };

  const addBasic = () => {
    if (!newFront.trim() || !newBack.trim()) return;
    addToTopic([makeCard({ type: "basic", front: newFront.trim(), back: newBack.trim() })]);
    setNewFront(""); setNewBack("");
  };

  const addCloze = () => {
    if (!clozeParts(clozeText)) return;
    const answer = clozeParts(clozeText).answer;
    addToTopic([makeCard({ type: "cloze", front: "", back: answer, text: clozeText.trim() })]);
    setClozeText("");
  };

  const blankSelection = () => {
    const el = clozeRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    if (s === e) return;
    setClozeText(t => `${t.slice(0, s)}{{c1::${t.slice(s, e)}}}${t.slice(e)}`);
  };

  const readFiles = (fileList) => {
    for (const f of fileList) {
      if (!/\.(md|txt|markdown)$/i.test(f.name)) continue;
      const reader = new FileReader();
      reader.onload = () => setFiles(prev => [...prev.filter(x => x.name !== f.name), { name: f.name, content: String(reader.result) }]);
      reader.readAsText(f);
    }
  };

  const generate = async () => {
    const source = [noteText, ...files.map(f => f.content)].filter(s => s.trim()).join("\n\n");
    if (!source.trim()) return;
    const ai = window.aeroflash?.ai;
    if (!ai) { setGenError("AI generation needs the desktop app."); return; }
    setGenError("");
    const chunks = splitChunks(source);
    let total = 0;
    for (let i = 0; i < chunks.length; i++) {
      setProgress({ chunk: i + 1, total: chunks.length, cardsSoFar: total });
      const res = await ai.generateCards(chunks[i]);
      if (!res.ok) {
        setGenError(total > 0 ? `${res.error} (kept the ${total} cards already generated)` : res.error);
        setProgress(null);
        return;
      }
      const cleaned = res.data
        .filter(c => c.type === "cloze" ? clozeParts(c.text) : (c.front && c.back))
        .map((c, j) => makeCard(c, i * 1000 + j));
      addToTopic(cleaned);
      total += cleaned.length;
    }
    setProgress(null); setNoteText(""); setFiles([]);
    setView("topic");
  };

  return (
    <Screen>
      <button className="bk" onClick={() => setView("topic")} style={{ marginBottom: 24 }}>← {topic?.name}</button>
      <div style={{ marginBottom: 24 }}>
        <div className="ptitle" style={{ fontSize: 26 }}>Add Cards</div>
      </div>
      <div className="tab-bar">
        <button className={`tab-btn${tab === "manual" ? " on" : ""}`} onClick={() => setTab("manual")}>Manual</button>
        <button className={`tab-btn${tab === "cloze" ? " on" : ""}`} onClick={() => setTab("cloze")}>Cloze</button>
        <button className={`tab-btn${tab === "notes" ? " on" : ""}`} onClick={() => setTab("notes")}>From Notes (AI)</button>
      </div>

      {tab === "manual" && (
        <div className="glass" style={{ padding: 24 }}>
          <div className="lbl">Front — Question or Term</div>
          <input className="inp" value={newFront} onChange={e => setNewFront(e.target.value)} style={{ marginBottom: 16 }}/>
          <div className="lbl">Back — Answer or Definition</div>
          <input className="inp" value={newBack} onChange={e => setNewBack(e.target.value)} onKeyDown={e => e.key === "Enter" && addBasic()} style={{ marginBottom: 20 }}/>
          <button className="ab aq md" onClick={addBasic} disabled={!newFront.trim() || !newBack.trim()} style={{ width: "100%" }}>+ Add Card</button>
        </div>
      )}

      {tab === "cloze" && (
        <div className="glass" style={{ padding: 24 }}>
          <div className="lbl">Sentence with a blank</div>
          <textarea ref={clozeRef} className="txta" value={clozeText} onChange={e => setClozeText(e.target.value)}/>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
            <button className="ab gh md" onClick={blankSelection}>Blank selection</button>
            <button className="ab pu md" onClick={addCloze} disabled={!clozeParts(clozeText)}>+ Add Cloze</button>
          </div>
          {clozeText && !clozeParts(clozeText) && (
            <div style={{ color: "rgba(255,255,255,.5)", fontSize: 12, fontWeight: 600, textAlign: "center", marginTop: 10 }}>
              Wrap the answer like {"{{c1::this}}"} or use "Blank selection"
            </div>
          )}
        </div>
      )}

      {tab === "notes" && (
        <div className="glass" style={{ padding: 24 }}>
          <div role="button" tabIndex={0}
            className={`dropzone${dragOver ? " over" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); readFiles(e.dataTransfer.files); }}>
            <div className="dz-title">📄 Drop .md / .txt files here</div>
            <div className="dz-sub">or click to browse — Obsidian notes work great</div>
            <input ref={fileInputRef} type="file" accept=".md,.txt,.markdown" multiple style={{ display: "none" }}
              onChange={e => { readFiles(e.target.files); e.target.value = ""; }}/>
          </div>
          {files.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {files.map(f => (
                <span key={f.name} className="file-chip">
                  {f.name} · {(f.content.length / 1000).toFixed(1)}k chars
                  <button onClick={() => setFiles(prev => prev.filter(x => x.name !== f.name))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="lbl">And / or paste notes below</div>
          <textarea className="txta" value={noteText} onChange={e => setNoteText(e.target.value)}/>
          {genError && <div className="err">{genError}</div>}
          <button className="ab pu md" onClick={generate} disabled={(!noteText.trim() && files.length === 0) || progress !== null} style={{ width: "100%", marginTop: 16 }}>
            {progress ? `Generating… chunk ${progress.chunk}/${progress.total}${progress.cardsSoFar ? ` · ${progress.cardsSoFar} cards so far` : ""}` : "Generate Flashcards with AI"}
          </button>
          <div style={{ color: "rgba(255,255,255,.45)", fontSize: 12, fontWeight: 600, textAlign: "center", marginTop: 10 }}>
            Long notes are split automatically · basic + cloze cards · powered by Claude
          </div>
        </div>
      )}

      {cards.length > 0 && (
        <div style={{ color: "rgba(255,255,255,.6)", fontSize: 13, fontWeight: 600, textAlign: "center", marginTop: 14 }}>
          {cards.length} card{cards.length !== 1 ? "s" : ""} in this topic
        </div>
      )}
    </Screen>
  );
}

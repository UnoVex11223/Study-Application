import { useEffect, useState } from "react";
import { useApp } from "./context.js";
import { getApiKeySet, setApiKey } from "../lib/storage.js";

// Mounted fresh each time the modal opens, so field state resets naturally.
function SettingsBody({ onClose }) {
  const { topics, resetProgress } = useApp();
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    let alive = true;
    getApiKeySet().then(v => { if (alive) setHasKey(v); });
    return () => { alive = false; };
  }, []);

  const save = () => {
    setApiKey(key.trim());
    setHasKey(Boolean(key.trim()));
    setSaved(true); setKey("");
  };
  const clear = () => { setApiKey(null); setHasKey(false); setSaved(true); };

  const cardCount = topics.reduce((s, t) => s + t.cards.length, 0);

  return (
    <div className="lu-overlay">
      <div className="lu-backdrop" onClick={onClose}/>
      <div className="settings-box">
        <div style={{ color: "#fff", fontSize: 20, fontWeight: 900, marginBottom: 6 }}>⚙ Settings</div>
        <div style={{ color: "rgba(255,255,255,.6)", fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
          AI card generation and answer grading need an Anthropic API key. It's stored locally on this machine and never leaves it except to call the API.
        </div>
        <div className="lbl">Anthropic API key</div>
        <input className="inp" type="password" value={key} onChange={e => setKey(e.target.value)}
          placeholder={hasKey ? "•••••••• (key saved — paste to replace)" : "sk-ant-…"}
          onKeyDown={e => e.key === "Enter" && key.trim() && save()} style={{ marginBottom: 14 }}/>
        {saved && <div style={{ color: "#6effc8", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Saved ✓</div>}
        <div style={{ display: "grid", gridTemplateColumns: hasKey ? "1fr 1fr 1fr" : "1fr 1fr", gap: 10 }}>
          <button className="ab aq md" onClick={save} disabled={!key.trim()}>Save</button>
          {hasKey && <button className="ab rd md" onClick={clear}>Remove</button>}
          <button className="ab gh md" onClick={onClose}>Close</button>
        </div>
        <div style={{ color: "rgba(255,255,255,.4)", fontSize: 12, fontWeight: 600, marginTop: 16, lineHeight: 1.5 }}>
          Get a key at console.anthropic.com → API Keys. Without one, everything still works except AI generation and AI grading (typed answers fall back to a keyword check).
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,.15)", marginTop: 24, paddingTop: 20 }}>
          <div style={{ color: "#ff9090", fontSize: 13, fontWeight: 800, letterSpacing: .4, textTransform: "uppercase", marginBottom: 10 }}>Danger Zone</div>
          {!confirmingReset ? (
            <button className="ab rd md" style={{ width: "100%" }} onClick={() => setConfirmingReset(true)}>
              Reset All Progress
            </button>
          ) : (
            <div style={{ padding: 16, borderRadius: 16, background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,80,80,.35)" }}>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
                Delete {topics.length} topic{topics.length !== 1 ? "s" : ""} and {cardCount} card{cardCount !== 1 ? "s" : ""}?
              </div>
              <div style={{ color: "rgba(255,255,255,.7)", fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
                This clears every card, XP, streak, and review history. Your API key is kept. This can't be undone.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button className="ab rd sm" onClick={resetProgress}>Yes, delete everything</button>
                <button className="ab gh sm" onClick={() => setConfirmingReset(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsModal() {
  const { settingsOpen, closeSettings } = useApp();
  if (!settingsOpen) return null;
  return <SettingsBody onClose={closeSettings}/>;
}

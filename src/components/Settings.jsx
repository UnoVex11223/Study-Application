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
        <div style={{ color: "var(--aero-muted)", fontSize: 13, fontWeight: 600, marginBottom: 20, lineHeight: 1.7 }}>
          AI card generation and answer grading need an Anthropic API key. It's stored locally on this machine and never leaves it except to call the API.
        </div>
        <div className="lbl">Anthropic API key</div>
        <input className="inp" type="password" value={key} onChange={e => setKey(e.target.value)}
          placeholder={hasKey ? "•••••••• (key saved — paste to replace)" : undefined}
          onKeyDown={e => e.key === "Enter" && key.trim() && save()} style={{ marginBottom: 14 }}/>
        {saved && <div style={{ color: "#6effc8", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Saved ✓</div>}
        <div className="settings-actions">
          <button className="ab aq md" onClick={save} disabled={!key.trim()}>Save</button>
          {hasKey && <button className="ab rd md" onClick={clear}>Remove</button>}
          <button className="ab gh md" onClick={onClose}>Close</button>
        </div>
        <div style={{ color: "var(--aero-muted)", fontSize: 12, fontWeight: 600, marginTop: 16, lineHeight: 1.7 }}>
          Get a key at console.anthropic.com → API Keys. Without one, written explanations stay ungraded; exact cloze matches can still be checked. Self-checks are recorded separately and do not change the review schedule. Flip cards and multiple choice remain available.
        </div>

        <div style={{ borderTop: "1px solid var(--aero-line)", marginTop: 24, paddingTop: 20 }}>
          <div style={{ color: "var(--aero-danger)", fontSize: 13, fontWeight: 800, letterSpacing: .4, textTransform: "uppercase", marginBottom: 10 }}>Danger Zone</div>
          {!confirmingReset ? (
            <button className="ab rd md" style={{ width: "100%" }} onClick={() => setConfirmingReset(true)}>
              Reset All Progress
            </button>
          ) : (
            <div style={{ padding: 16, borderRadius: 16, background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,80,80,.35)" }}>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
                Delete {topics.length} topic{topics.length !== 1 ? "s" : ""} and {cardCount} card{cardCount !== 1 ? "s" : ""}?
              </div>
              <div style={{ color: "var(--aero-muted)", fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
                This clears every card, XP, streak, and review history. Your API key is kept. This can't be undone.
              </div>
              <div className="settings-actions">
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

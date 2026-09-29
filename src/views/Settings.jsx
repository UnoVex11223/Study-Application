import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { Notice } from "../ui/ui.jsx";
import Icon from "../ui/Icon.jsx";
import { getApiKeySet, setApiKey } from "../lib/persist.js";
import { aiBridge } from "../lib/ai.js";
import { forecastLoad } from "../lib/planner.js";
import { formatMinutes } from "../lib/time.js";

function Section({ title, children, description }) {
  return (
    <section className="panel panel-pad" style={{ marginBottom: 20 }}>
      <h2 className="h" style={{ marginBottom: description ? 4 : 14 }}>{title}</h2>
      {description && <p className="muted small" style={{ marginBottom: 16 }}>{description}</p>}
      {children}
    </section>
  );
}

export default function Settings() {
  const { state, act } = useStore();
  const s = state.settings;
  const set = (patch) => act("settings", { patch });
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [backups, setBackups] = useState(null);
  const backupApi = typeof window !== "undefined" ? window.tenax?.backup : null;
  useEffect(() => { backupApi?.info().then(setBackups).catch(() => {}); }, [backupApi]);
  const [restore, setRestore] = useState(null);
  const [restoreError, setRestoreError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => { getApiKeySet().then(setHasKey); }, []);

  const { sec } = forecastLoad(state, { days: 8 });
  const weekAvg = sec.slice(1).reduce((a, b) => a + b, 0) / 7;

  const saveKey = async () => {
    await setApiKey(key.trim());
    setKey(""); setHasKey(Boolean(key.trim())); setKeySaved(true);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tenax-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const readBackup = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result));
        if (!Array.isArray(data.courses) || !Array.isArray(data.items)) throw new Error("not a backup");
        setRestore(data); setRestoreError("");
      } catch { setRestoreError("That file isn't an Tenax backup."); }
    };
    r.readAsText(file);
  };

  return (
    <div className="page page-narrow">
      <div className="page-head"><div><h1>Settings</h1></div></div>

      <Section title="Daily workload" description="Sessions are built to fit this budget. Reviews that don't fit move to later days, most urgent first, and new material slows down while you catch up.">
        <div className="field">
          <label htmlFor="st-min">Study time per day: <strong>{s.dailyMinutes} minutes</strong></label>
          <input id="st-min" type="range" min={5} max={90} step={5} value={s.dailyMinutes} onChange={e => set({ dailyMinutes: Number(e.target.value) })}/>
          <span className="help">Reviews already scheduled for the coming week average {formatMinutes(weekAvg)} a day.</span>
        </div>
        <div className="field">
          <label htmlFor="st-new">New concepts per day, at most: <strong>{s.maxNewPerDay}</strong></label>
          <input id="st-new" type="range" min={0} max={20} step={1} value={s.maxNewPerDay} onChange={e => set({ maxNewPerDay: Number(e.target.value) })}/>
          <span className="help">Shared across active courses. Each new concept adds a few minutes of reviews over the following weeks.</span>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="st-roll">A new study day starts at</label>
          <select id="st-roll" className="select" style={{ width: 160 }} value={s.rolloverHour} onChange={e => set({ rolloverHour: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map(h => <option key={h} value={h}>{h === 0 ? "Midnight" : `${h}:00 am`}</option>)}
          </select>
          <span className="help">A late-night session counts toward the day you started it.</span>
        </div>
      </Section>

      <Section title="Memory target" description="How likely you should be to remember something when it comes up for review. Higher means more reviews.">
        <div className="seg">
          {[[0.85, "85%, lighter"], [0.9, "90%, recommended"], [0.95, "95%, thorough"]].map(([v, l]) => (
            <button key={v} className={s.retention === v ? "on" : ""} onClick={() => set({ retention: v })}>{l}</button>
          ))}
        </div>
      </Section>

      <Section title="Appearance">
        <div className="seg">
          {[["dark", "Black"], ["light", "White"], ["system", "Match system"]].map(([v, l]) => (
            <button key={v} className={s.theme === v ? "on" : ""} onClick={() => set({ theme: v })}>{l}</button>
          ))}
        </div>
      </Section>

      <Section title="AI" description="Extracting concepts, writing questions and grading written answers use Claude through your Anthropic API key. The key is stored on this computer, encrypted with your user account, and only used to call the API. Without it you can still write questions and check answers yourself.">
        {!aiBridge() && <div style={{ marginBottom: 12 }}><Notice>AI features run in the desktop app.</Notice></div>}
        <div className="row">
          <input className="input grow" type="password" value={key} onChange={e => { setKey(e.target.value); setKeySaved(false); }}
            aria-label="Anthropic API key"
            onKeyDown={e => e.key === "Enter" && key.trim() && saveKey()}/>
          <button className="btn btn-primary" onClick={saveKey} disabled={!key.trim()}>Save key</button>
          {hasKey && <button className="btn btn-danger" onClick={async () => { await setApiKey(null); setHasKey(false); }}>Remove</button>}
        </div>
        {(keySaved || (hasKey && !key)) && <p className="small" style={{ color: "var(--good)", marginTop: 8 }}>{keySaved ? "Key saved." : "A key is saved. Paste a new one to replace it."}</p>}
        <p className="help" style={{ marginTop: 10 }}>Get a key at platform.claude.com under Settings → API keys.</p>

        <div className="label" style={{ marginTop: 20 }}>Book imports</div>
        <div className="seg" style={{ marginTop: 8 }}>
          {[[true, "Half price"], [false, "Faster"]].map(([v, l]) => (
            <button key={l} className={(s.batchImports !== false) === v ? "on" : ""} onClick={() => set({ batchImports: v })}>{l}</button>
          ))}
        </div>
        <p className="help" style={{ marginTop: 8 }}>
          {s.batchImports !== false
            ? "Questions for imported books are written through Anthropic's Batch API: the same models and quality at half the price. Each chapter usually takes a few extra minutes, occasionally up to an hour when the queue is busy."
            : "Questions for imported books are written right away, at full price."}
        </p>
      </Section>

      <Section title="Your data" description="Everything is stored locally on this computer.">
        {backups && (
          <div className="row" style={{ marginBottom: 14, gap: 12 }}>
            <Icon name="check" size={15}/>
            <span className="grow small">
              A copy is saved automatically each day; the last {backups.keep} are kept.
              {backups.latest && <span className="muted"> Latest: {new Date(`${backups.latest}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.</span>}
            </span>
            <button className="btn btn-sm btn-quiet" onClick={() => backupApi.open()}>Open folder</button>
          </div>
        )}
        <div className="row-wrap">
          <button className="btn" onClick={exportData}><Icon name="download" size={15}/>Export backup</button>
          <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={15}/>Restore from backup</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { readBackup(e.target.files?.[0]); e.target.value = ""; }}/>
        </div>
        {restoreError && <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>{restoreError}</p>}
        {restore && (
          <div style={{ marginTop: 14 }}>
            <Notice tone="warn" icon="alert">
              Replace everything with this backup ({restore.courses.length} courses, {restore.items.length} questions)? Current data will be lost.
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-sm btn-danger" onClick={() => { act("replace", { state: restore }); setRestore(null); }}>Replace my data</button>
                <button className="btn btn-sm btn-quiet" onClick={() => setRestore(null)}>Cancel</button>
              </div>
            </Notice>
          </div>
        )}
        <div className="divider"/>
        {!confirmReset ? (
          <button className="btn btn-danger" onClick={() => setConfirmReset(true)}><Icon name="trash" size={15}/>Reset all progress</button>
        ) : (
          <Notice tone="bad" icon="alert">
            Delete all {state.courses.length} courses, {state.items.length} questions and your whole review history? Settings and your API key are kept. This can't be undone.
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm btn-danger" onClick={() => { act("reset"); setConfirmReset(false); }}>Delete everything</button>
              <button className="btn btn-sm btn-quiet" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          </Notice>
        )}
      </Section>
    </div>
  );
}

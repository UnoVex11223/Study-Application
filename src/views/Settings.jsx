import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { Notice, Spinner } from "../ui/ui.jsx";
import { useSync } from "../state/sync.jsx";
import Icon from "../ui/Icon.jsx";
import { getApiKeySet, setApiKey, flush } from "../lib/persist.js";
import { aiBridge } from "../lib/ai.js";
import { play } from "../ui/sound.js";

/** One group of settings: its name on the left, the controls on the right, a hairline between groups. */
function Section({ title, children }) {
  return (
    <section className="settings-section">
      <h2 className="settings-title">{title}</h2>
      <div className="settings-body">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { state, act } = useStore();
  const s = state.settings;
  const set = (patch) => act("settings", { patch });
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [backups, setBackups] = useState(null);
  const sync = useSync();
  const syncing = Boolean(sync?.status?.enabled);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState(null);
  useEffect(() => {
    window.tenax?.version?.().then(setVersion).catch(() => {});
    window.tenax?.update?.status().then(setUpdate).catch(() => {});
  }, []);
  const installUpdate = async () => { flush(); await window.tenax?.update?.install(); };
  const backupApi = typeof window !== "undefined" ? window.tenax?.backup : null;
  useEffect(() => { backupApi?.info().then(setBackups).catch(() => {}); }, [backupApi]);
  const [restore, setRestore] = useState(null);
  const [restoreError, setRestoreError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => { getApiKeySet().then(setHasKey); }, []);

  const saveKey = async () => {
    await setApiKey(key.trim());
    setKey(""); setHasKey(Boolean(key.trim())); setReplacing(false);
  };
  const cancelKey = () => { setKey(""); setReplacing(false); };

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
      } catch { setRestoreError("That file isn't a Tenax backup."); }
    };
    r.readAsText(file);
  };

  return (
    <div className="page page-narrow">
      <div className="page-head"><div><h1>Settings</h1></div></div>

      <Section title="Study">
        <div className="field">
          <label htmlFor="st-min" className="field-row"><span>Study time per day</span><span className="num">{s.dailyMinutes} min</span></label>
          <input id="st-min" type="range" min={5} max={90} step={5} value={s.dailyMinutes} onChange={e => set({ dailyMinutes: Number(e.target.value) })}/>
        </div>
        <div className="field">
          <label htmlFor="st-new" className="field-row"><span>New concepts per day, at most</span><span className="num">{s.maxNewPerDay}</span></label>
          <input id="st-new" type="range" min={0} max={20} step={1} value={s.maxNewPerDay} onChange={e => set({ maxNewPerDay: Number(e.target.value) })}/>
        </div>
        <div className="field">
          <span className="label">Memory target</span>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {[[0.85, "85%, lighter"], [0.9, "90%, recommended"], [0.95, "95%, thorough"]].map(([v, l]) => (
              <button key={v} className={s.retention === v ? "on" : ""} onClick={() => set({ retention: v })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="st-roll">A new study day starts at</label>
          <select id="st-roll" className="select" style={{ width: 160 }} value={s.rolloverHour} onChange={e => set({ rolloverHour: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map(h => <option key={h} value={h}>{h === 0 ? "Midnight" : `${h}:00 am`}</option>)}
          </select>
        </div>
      </Section>

      <Section title="Anthropic API key">
        {!aiBridge() && <div style={{ marginBottom: 12 }}><Notice>AI features run in the desktop app.</Notice></div>}
        {hasKey && !replacing ? (
          <div className="row">
            <span className="key-mask grow" aria-label="An API key is saved">sk-ant-••••••••••••••••</span>
            <button className="btn" onClick={() => setReplacing(true)}><Icon name="plus" size={15}/>New key</button>
            <button className="btn btn-danger" onClick={async () => { await setApiKey(null); setHasKey(false); }}>Remove</button>
          </div>
        ) : (
          <div className="row">
            <input className="input grow" type="password" value={key} onChange={e => setKey(e.target.value)}
              aria-label="Anthropic API key" autoFocus={replacing}
              onKeyDown={e => { if (e.key === "Enter" && key.trim()) saveKey(); if (e.key === "Escape") cancelKey(); }}/>
            <button className="btn btn-primary" onClick={saveKey} disabled={!key.trim()}>Save key</button>
            {replacing && <button className="btn btn-quiet" onClick={cancelKey}>Cancel</button>}
            <a className="btn btn-quiet" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">Create a key</a>
          </div>
        )}
      </Section>

      <Section title="Book imports">
        <div className="seg">
          {[[true, "Half price"], [false, "Faster"]].map(([v, l]) => (
            <button key={l} className={(s.batchImports !== false) === v ? "on" : ""} onClick={() => set({ batchImports: v })}>{l}</button>
          ))}
        </div>
      </Section>

      <Section title="Sync across computers">
        {!sync?.status && <p className="muted small">Sync is available in the desktop app.</p>}
        {sync?.status && !sync.status.enabled && (
          <div className="row-wrap">
            {/onedrive/i.test(sync.status.suggested) && (
              <button className="btn btn-primary" onClick={sync.useSuggested}>Use OneDrive</button>
            )}
            <button className="btn" onClick={sync.choose}>Choose a folder…</button>
          </div>
        )}
        {sync?.status?.enabled && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="sync-grid">
              <span className="muted small">Folder</span><span className="small mono-path">{sync.status.dir}</span>
              <span className="muted small">This computer</span><span className="small">{sync.status.device?.name}</span>
              <span className="muted small">Other computers</span>
              <span className="small">
                {sync.status.others.length === 0 ? "None yet" :
                  sync.status.others.map(o => `${o.name} (saved ${new Date(o.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})`).join(", ")}
              </span>
              <span className="muted small">Last checked</span>
              <span className="small">{sync.info.busy ? <Spinner/> : sync.info.lastSync ? new Date(sync.info.lastSync).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "not yet"}</span>
            </div>
            {sync.info.error && <Notice tone="warn" icon="alert">{sync.info.error}</Notice>}
            {sync.info.skipped.length > 0 && <Notice tone="warn" icon="alert">{sync.info.skipped.join(", ")} {sync.info.skipped.length === 1 ? "has" : "have"} a newer version of Tenax. Update this computer to sync with {sync.info.skipped.length === 1 ? "it" : "them"}.</Notice>}
            <div className="row-wrap">
              <button className="btn" onClick={sync.syncNow} disabled={sync.info.busy}>Sync now</button>
              <button className="btn btn-quiet" onClick={sync.choose}>Change folder</button>
              <button className="btn btn-quiet" onClick={sync.stop}>Stop syncing</button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Look and sound">
        <div className="field">
          <span className="label">Theme</span>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {[["dark", "Black"], ["light", "Paper"], ["system", "Match system"]].map(([v, l]) => (
              <button key={v} className={s.theme === v ? "on" : ""} onClick={() => set({ theme: v })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <span className="label">Sounds</span>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {[[false, "Off"], [true, "On"]].map(([v, l]) => (
              <button key={l} className={Boolean(s.sounds) === v ? "on" : ""} onClick={() => { set({ sounds: v }); if (v) play("chime", { force: true }); }}>{l}</button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Your data">
        {backups && (
          <div className="row" style={{ marginBottom: 14, gap: 12 }}>
            <Icon name="check" size={15}/>
            <span className="grow small">
              Daily backups{backups.latest && <span className="muted"> · latest {new Date(`${backups.latest}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
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
              Replace everything with this backup ({restore.courses.length} courses, {restore.items.length} questions)? Current data will be lost{syncing ? ", on your other computers too" : ""}.
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
            Delete all {state.courses.length} courses, {state.items.length} questions, your shelf and your whole review history{syncing ? " on every computer you sync with" : ""}? Settings and your API key are kept. This can't be undone.
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm btn-danger" onClick={() => { act("reset"); setConfirmReset(false); }}>Delete everything</button>
              <button className="btn btn-sm btn-quiet" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          </Notice>
        )}
      </Section>
      {update?.state === "ready" && (
        <Notice icon="download">
          <div className="row" style={{ gap: 12 }}>
            <span className="grow">Tenax {update.version} is ready. It installs the next time you close the app.</span>
            <button className="btn btn-sm" onClick={installUpdate}>Restart now</button>
          </div>
        </Notice>
      )}
      {version && <p className="muted small" style={{ textAlign: "center", marginTop: 16 }}>Tenax {version}{update?.state === "downloading" ? ` · downloading ${update.version}` : ""}</p>}
    </div>
  );
}

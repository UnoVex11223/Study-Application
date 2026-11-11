// Settings: a list of group names; click one to open its controls (one open at a time).

import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useSync } from "../../state/sync.jsx";
import Icon from "../../ui/Icon.jsx";
import { Page, PageHeader } from "../../ui/layout.jsx";
import { Field, Segmented, Confirm } from "../../ui/controls.jsx";
import { Notice, Spinner } from "../../ui/display.jsx";
import { getApiKeySet, setApiKey, flush } from "../../lib/persist.js";
import { aiBridge, callAi, WRITERS } from "../../lib/ai.js";
import { questionsPerDay, MIX } from "../../lib/planner.js";
import { plural, pluralWord, shortDate, clockTime, dateTime } from "../../lib/format.js";
import { play } from "../../ui/sound.js";
import { cx } from "../../ui/cx.js";

const MIX_OPTIONS = Object.entries(MIX).map(([v, m]) => [v, m.label]);
const RETENTION_OPTIONS = [[0.85, "85%, lighter"], [0.9, "90%, recommended"], [0.95, "95%, thorough"]];
const ON_OFF = [[true, "On"], [false, "Off"]];
const THEME_OPTIONS = [["dark", "Dark"], ["light", "Light"], ["system", "Match system"]];
const IMPORT_OPTIONS = [[true, "Half price"], [false, "Faster"]];
const WRITER_OPTIONS = Object.entries(WRITERS).map(([k, w]) => [k, w.label, w.blurb]);
const dollars = (x) => (x >= 10 ? `$${x.toFixed(0)}` : x >= 0.995 ? `$${x.toFixed(2)}` : `${Math.max(0, Math.round(x * 100))}¢`);

/** What the AI cost over the last 30 days, by what it was doing (from the app's own log of each call). */
function AiUsage() {
  const [usage, setUsage] = useState(null);
  useEffect(() => { if (aiBridge()) callAi("usage", { days: 30 }).then(r => setUsage(r.ok ? r : null)); }, []);
  if (!usage) return null;
  if (!usage.calls) return <p className="muted small">Nothing yet. What each AI call costs is noted from now on and shows here.</p>;
  return (
    <div className="stack gap-2">
      <div className="row"><strong className="grow">Last 30 days</strong><span className="num strong">{dollars(usage.total)}</span></div>
      <div className="usage-rows">
        {usage.byActivity.map(a => (
          <div key={a.kind} className="row small">
            <span className="grow">{a.label}</span>
            <span className="muted num">{plural(a.calls, "call")}</span>
            <span className="num usage-cost">{dollars(a.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
const ROLLOVER_HOURS = [0, 1, 2, 3, 4, 5, 6];

/** One group of settings: its name as a row you click to open, its controls under it while open. */
function Group({ title, open, onToggle, children }) {
  return (
    <section className={cx("settings-group", open === title && "open")}>
      <h2 className="settings-title">
        <button className="settings-head" aria-expanded={open === title} onClick={() => onToggle(open === title ? null : title)}>
          {title}<Icon name="chevron"/>
        </button>
      </h2>
      {open === title && <div className="form settings-body enter">{children}</div>}
    </section>
  );
}

function ApiKey() {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [replacing, setReplacing] = useState(false);
  useEffect(() => { getApiKeySet().then(setHasKey); }, []);

  const save = async () => { await setApiKey(key.trim()); setKey(""); setHasKey(Boolean(key.trim())); setReplacing(false); };
  const cancel = () => { setKey(""); setReplacing(false); };
  const remove = async () => { await setApiKey(null); setHasKey(false); };

  return (
    <>
      {!aiBridge() && <Notice>AI features run in the desktop app.</Notice>}
      {hasKey && !replacing ? (
        <div className="row">
          <span className="key-mask grow" aria-label="An API key is saved">sk-ant-••••••••••••••••</span>
          <button className="btn" onClick={() => setReplacing(true)}><Icon name="plus"/>New key</button>
          <button className="btn btn-danger" onClick={remove}>Remove</button>
        </div>
      ) : (
        <div className="row">
          <input className="input grow" type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…"
            aria-label="Anthropic API key" autoFocus={replacing}
            onKeyDown={e => { if (e.key === "Enter" && key.trim()) save(); if (e.key === "Escape") cancel(); }}/>
          <button className="btn btn-primary" onClick={save} disabled={!key.trim()}>Save key</button>
          {replacing && <button className="btn btn-quiet" onClick={cancel}>Cancel</button>}
          <a className="btn btn-quiet" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">Create a key</a>
        </div>
      )}
    </>
  );
}

function Sync() {
  const sync = useSync();
  if (!sync?.status) return <p className="muted small">Sync is available in the desktop app.</p>;
  if (!sync.status.enabled) {
    return (
      <div className="row wrap">
        {/onedrive/i.test(sync.status.suggested) && <button className="btn btn-primary" onClick={sync.useSuggested}>Use OneDrive</button>}
        <button className="btn" onClick={sync.choose}>Choose a folder…</button>
      </div>
    );
  }
  const { status, info } = sync;
  return (
    <>
      <dl className="facts">
        <dt>Folder</dt><dd className="mono-path">{status.dir}</dd>
        <dt>This computer</dt><dd>{status.device?.name}</dd>
        <dt>Other computers</dt>
        <dd>{status.others.length === 0 ? "None yet" : status.others.map(o => `${o.name} (saved ${dateTime(o.savedAt)})`).join(", ")}</dd>
        <dt>Last checked</dt><dd>{info.busy ? <Spinner/> : info.lastSync ? clockTime(info.lastSync) : "not yet"}</dd>
      </dl>
      {info.error && <Notice tone="warn" icon="alert">{info.error}</Notice>}
      {info.skipped.length > 0 && (
        <Notice tone="warn" icon="alert">
          {info.skipped.join(", ")} {pluralWord(info.skipped.length, "has", "have")} a newer version of Tenax. Update this computer to sync with {pluralWord(info.skipped.length, "it", "them")}.
        </Notice>
      )}
      <div className="row wrap">
        <button className="btn" onClick={sync.syncNow} disabled={info.busy}>Sync now</button>
        <button className="btn btn-quiet" onClick={sync.choose}>Change folder</button>
        <button className="btn btn-quiet" onClick={sync.stop}>Stop syncing</button>
      </div>
    </>
  );
}

function YourData() {
  const { state, act } = useStore();
  const syncing = Boolean(useSync()?.status?.enabled);
  const [backups, setBackups] = useState(null);
  const [restore, setRestore] = useState(null);
  const [restoreError, setRestoreError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef(null);
  const backupApi = typeof window !== "undefined" ? window.tenax?.backup : null;
  useEffect(() => { backupApi?.info().then(setBackups).catch(() => {}); }, [backupApi]);

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
  const everywhere = syncing ? ", on your other computers too" : "";

  return (
    <>
      {backups && (
        <div className="row">
          <Icon name="check"/>
          <span className="grow">Daily backups{backups.latest && <span className="muted">, latest {shortDate(`${backups.latest}T12:00:00`)}</span>}</span>
          <button className="btn btn-sm btn-quiet" onClick={() => backupApi.open()}>Open folder</button>
        </div>
      )}
      <div className="row wrap">
        <button className="btn" onClick={exportData}><Icon name="download"/>Export backup</button>
        <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload"/>Restore from backup</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { readBackup(e.target.files?.[0]); e.target.value = ""; }}/>
      </div>
      {restoreError && <p className="error-text">{restoreError}</p>}
      {restore && (
        <Confirm action="Replace my data" onCancel={() => setRestore(null)} onConfirm={() => { act("replace", { state: restore }); setRestore(null); }}>
          Replace everything with this backup ({plural(restore.courses.length, "course")}, {plural(restore.items.length, "question")})? Current data will be lost{everywhere}.
        </Confirm>
      )}
      <div className="rule-top">
        {confirmReset ? (
          <Confirm action="Delete everything" onCancel={() => setConfirmReset(false)} onConfirm={() => { act("reset"); setConfirmReset(false); }}>
            Delete all {plural(state.courses.length, "course")}, {plural(state.items.length, "question")}, your shelf and your whole review history{syncing ? " on every computer you sync with" : ""}? Settings and your API key are kept. This can't be undone.
          </Confirm>
        ) : (
          <button className="btn btn-danger" onClick={() => setConfirmReset(true)}><Icon name="trash"/>Reset all progress</button>
        )}
      </div>
    </>
  );
}

export default function Settings() {
  const { state, act } = useStore();
  const s = state.settings;
  const set = (patch) => act("settings", { patch });
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState(null);
  useEffect(() => {
    window.tenax?.version?.().then(setVersion).catch(() => {});
    window.tenax?.update?.status().then(setUpdate).catch(() => {});
  }, []);
  const installUpdate = async () => { flush(); await window.tenax?.update?.install(); };
  const mix = s.mix || "even";
  const [open, setOpen] = useState(null); // the open group's title
  const group = { open, onToggle: setOpen };

  return (
    <Page width="narrow" className="settings-page">
      <PageHeader center title="Settings"/>

      {update?.state === "ready" && (
        <Notice icon="download">
          <div className="row">
            <span className="grow">Tenax {update.version} is ready. It installs the next time you close the app.</span>
            <button className="btn btn-sm" onClick={installUpdate}>Restart now</button>
          </div>
        </Notice>
      )}

      <div className="settings">
        <Group title="Study" {...group}>
          <Field label="Questions per day" htmlFor="st-per-day" value={questionsPerDay(s)}>
            <input id="st-per-day" type="range" min={5} max={60} step={5} value={questionsPerDay(s)} onChange={e => set({ dailyQuestions: Number(e.target.value) })}/>
          </Field>
          <Field label="Daily mix">
            <Segmented label="Daily mix" options={MIX_OPTIONS} value={mix} onChange={(v) => set({ mix: v })}/>
          </Field>
          <Field label="New concepts per day, at most" htmlFor="st-new" value={s.maxNewPerDay}>
            <input id="st-new" type="range" min={0} max={20} step={1} value={s.maxNewPerDay} onChange={e => set({ maxNewPerDay: Number(e.target.value) })}/>
          </Field>
          <Field label="Memory target">
            <Segmented label="Memory target" options={RETENTION_OPTIONS} value={s.retention} onChange={(v) => set({ retention: v })}/>
          </Field>
          <Field label="Fresh versions">
            <Segmented label="Fresh versions" options={ON_OFF} value={s.freshVersions !== false} onChange={(v) => set({ freshVersions: v })}/>
          </Field>
          <Field label="A new study day starts at" htmlFor="st-roll">
            <select id="st-roll" className="select settings-select" value={s.rolloverHour} onChange={e => set({ rolloverHour: Number(e.target.value) })}>
              {ROLLOVER_HOURS.map(h => <option key={h} value={h}>{h === 0 ? "Midnight" : `${h}:00 am`}</option>)}
            </select>
          </Field>
        </Group>

        <Group title="Anthropic API key" {...group}><ApiKey/></Group>

        <Group title="AI and cost" {...group}>
          <Field label="Question writing">
            <Segmented label="Question writing" options={WRITER_OPTIONS} value={WRITERS[s.questionWriting] ? s.questionWriting : "thorough"} onChange={(v) => set({ questionWriting: v })}/>
          </Field>
          <Field label="Book imports and rebuilds">
            <Segmented label="Book imports and rebuilds" options={IMPORT_OPTIONS} value={s.batchImports !== false} onChange={(v) => set({ batchImports: v })}/>
          </Field>
          <Field label="What it has cost"><AiUsage/></Field>
        </Group>

        <Group title="Sync across computers" {...group}><Sync/></Group>

        <Group title="Look and sound" {...group}>
          <Field label="Theme">
            <Segmented label="Theme" options={THEME_OPTIONS} value={s.theme} onChange={(v) => set({ theme: v })}/>
          </Field>
          <Field label="Sounds">
            <Segmented label="Sounds" options={[[false, "Off"], [true, "On"]]} value={Boolean(s.sounds)}
              onChange={(v) => { set({ sounds: v }); if (v) play("chime", { force: true }); }}/>
          </Field>
        </Group>

        <Group title="Your data" {...group}><YourData/></Group>
      </div>

      {version && <p className="settings-version muted small">Tenax {version}{update?.state === "downloading" ? `, downloading ${update.version}` : ""}</p>}
    </Page>
  );
}

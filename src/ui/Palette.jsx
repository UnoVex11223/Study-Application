// The command palette (Ctrl+K, or the search box in the title bar): type to
// find any course, chapter, concept, book or note, or run an action. Arrow
// keys move, Enter opens, Escape closes. What it can find is lib/commands.js;
// how it matches is lib/search.js.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useSync } from "../state/sync.jsx";
import { useNav } from "./nav.js";
import Icon from "./Icon.jsx";
import { stillMotion } from "./motion.js";
import { play } from "./sound.js";
import { commandEntries, groupResults } from "../lib/commands.js";
import { rank, highlight } from "../lib/search.js";
import { courseInk } from "../lib/model.js";

function Title({ text, hits }) {
  return <>{highlight(text, hits).map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>))}</>;
}

export default function Palette({ plan, onClose }) {
  const { state, act } = useStore();
  const nav = useNav();
  const sync = useSync();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const syncing = Boolean(sync?.status?.enabled);

  const [at] = useState(() => Date.now());
  const entries = useMemo(() => commandEntries(state, { plan, now: nav.now, syncing, at }), [state, plan, nav.now, syncing, at]);
  const typed = query.trim().length > 0;
  const groups = useMemo(() => {
    const results = typed ? rank(entries, query, 80) : entries.filter(e => e.suggest).map(e => ({ ...e, hits: [] }));
    return groupResults(results, { typed, per: typed ? 6 : 8 });
  }, [entries, query, typed]);
  const rows = groups.flatMap(g => g.rows);
  const current = Math.min(sel, Math.max(0, rows.length - 1));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, query]);

  const close = (then) => {
    if (stillMotion() || then) { onClose(); then?.(); return; }
    setLeaving(true);
    setTimeout(onClose, 120);
  };

  const run = (e) => {
    if (!e) return;
    close(() => {
      if (e.to) { nav.go(e.to.view, e.to.params || {}); return; }
      if (e.action === "session" && plan?.tasks.length) nav.startSession({ tasks: plan.tasks, mode: "session", daily: true });
      if (e.action === "theme") act("settings", { patch: { theme: state.settings.theme === "light" ? "dark" : "light" } });
      if (e.action === "sounds") {
        const on = !state.settings.sounds;
        act("settings", { patch: { sounds: on } });
        if (on) play("correct", { force: true });
      }
      if (e.action === "sync") sync?.syncNow?.();
    });
  };

  const onKey = (ev) => {
    if (ev.key === "ArrowDown" || (ev.ctrlKey && ev.key === "n")) { ev.preventDefault(); setSel((current + 1) % Math.max(1, rows.length)); }
    else if (ev.key === "ArrowUp" || (ev.ctrlKey && ev.key === "p")) { ev.preventDefault(); setSel((current - 1 + rows.length) % Math.max(1, rows.length)); }
    else if (ev.key === "Enter") { ev.preventDefault(); run(rows[current]); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
  };

  let n = -1;
  return (
    <>
      <div className={`scrim palette-scrim${leaving ? " leaving" : ""}`} onClick={() => close()}/>
      <div className={`palette${leaving ? " leaving" : ""}`} role="dialog" aria-label="Search and commands" onKeyDown={onKey}>
        <div className="palette-input">
          <Icon name="search" size={17}/>
          <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setSel(0); }}
            aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
            aria-activedescendant={rows[current] ? `pal-${rows[current].id}` : undefined} spellCheck={false}/>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {groups.map(g => (
            <div key={g.kind} className="palette-group" role="group" aria-label={g.label}>
              <div className="palette-group-label">{g.label}</div>
              {g.rows.map(r => {
                n++;
                const i = n, on = i === current;
                return (
                  <div key={r.id} id={`pal-${r.id}`} role="option" aria-selected={on} className={`palette-row${on ? " on" : ""}`}
                    onMouseMove={() => { if (!on) setSel(i); }} onClick={() => run(r)}>
                    <span className="palette-icon">
                      {r.icon ? <Icon name={r.icon} size={15}/> : <span className="palette-dot" style={{ background: courseInk(r.color) }}/>}
                    </span>
                    <span className="palette-text">
                      <span className="palette-title"><Title text={r.title} hits={r.hits}/></span>
                      {r.sub && <span className="palette-sub">{r.sub}</span>}
                    </span>
                    {r.keys && <kbd className="palette-keys">{r.keys}</kbd>}
                    {on && <Icon name="arrow" size={14} className="palette-go"/>}
                  </div>
                );
              })}
            </div>
          ))}
          {rows.length === 0 && <div className="palette-empty">Nothing matches “{query.trim()}”.</div>}
        </div>
      </div>
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './context.js';
import { newSrs } from '../lib/fsrs.js';
import { CONTENT_PROFILES, MAX_SOURCE_CHARS, MAX_SOURCE_CHUNKS, profileFor, remainingCapacity,
  parseSources, selectCore, draftCoreSet, acceptDraft } from '../../content-engine.mjs';

const SKILLS = { recall: 'Recall', explain: 'Explain', apply: 'Apply', distinguish: 'Distinguish' };

export default function ContentStudio() {
  const { topics, topicId, updateTopics, setView } = useApp();
  const topic = topics.find(t => t.id === topicId);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(null);
  const [reading, setReading] = useState(false);
  const running = useRef(false), job = useRef(0), fileInput = useRef(null), readingRef = useRef(false);
  useEffect(() => () => { job.current++; running.current = false; }, []);
  const cards = topic?.cards || [];
  const profileKey = topic?.contentProfile || 'balanced';
  const profile = profileFor(profileKey);
  const capacity = remainingCapacity(cards, profileKey);
  const draft = topic?.contentDraft;
  const sources = useMemo(() => [{ name: 'Pasted notes', content: notes }, ...files].filter(f => f.content.trim()), [notes, files]);
  const { sections, chunks } = useMemo(() => parseSources(sources), [sources]);
  const sourceLength = sources.reduce((sum, s) => sum + s.content.length, 0);
  const tooLarge = sourceLength > MAX_SOURCE_CHARS || chunks.length > MAX_SOURCE_CHUNKS;
  const selected = selectCore((draft?.cards || []).filter(c => !c.excluded), cards, profileKey);
  const plannedSections = draft?.sections || sections;
  const represented = new Set([...cards, ...selected].map(c => c.sectionId));
  const unrepresented = plannedSections.filter(s => !represented.has(s.id));
  const busy = !!progress || reading;
  const update = fields => updateTopics(prev => prev.map(t => t.id === topicId ? { ...t, ...fields } : t));

  async function readFiles(list) {
    if (running.current || readingRef.current || draft) return;
    readingRef.current = true; setReading(true); setError('');
    const token = job.current;
    try {
      for (const file of list) {
        if (!/\.(md|txt|markdown)$/i.test(file.name)) throw new Error('Choose Markdown or text files for this import.');
        if (file.size > MAX_SOURCE_CHARS * 4) throw new Error('That file is too large. Import the chapter you are studying.');
        const content = await file.text();
        if (token !== job.current) return;
        if (content.length > MAX_SOURCE_CHARS) throw new Error('Import a chapter or a few sections at a time (up to 180,000 characters).');
        setFiles(prev => [...prev.filter(f => f.name !== file.name), { name: file.name, content }]);
      }
    } catch (err) { if (token === job.current) setError(err.message); }
    finally { readingRef.current = false; if (token === job.current) setReading(false); }
  }

  async function generate() {
    if (running.current || readingRef.current || !chunks.length || draft || tooLarge || !capacity) return;
    const ai = window.aeroflash?.ai;
    if (!ai) { setError('Open AeroFlash on your desktop and add your API key in Settings to generate a core set.'); return; }
    running.current = true;
    const token = ++job.current;
    setError(''); setMessage('');
    const cancelled = () => job.current !== token;
    setProgress({ current: 0, total: chunks.length, section: 'Preparing your source' });
    try {
      const result = await draftCoreSet({ chunks, sections, existing: cards, profileKey,
        goal: topic.learningGoal?.trim() || `Understand and apply the core ideas in ${topic.name}.`,
        generate: payload => ai.generateCards(payload), cancelled,
        onProgress: setProgress,
        onDraft: contentDraft => update({ contentDraft }),
      });
      if (!cancelled()) setMessage(result.cards.length
        ? 'Your core set is ready. It is saved here until you add it or start over.'
        : 'No new source-supported concepts were selected. Your existing questions may already cover this material.');
    } catch (err) {
      if (!cancelled()) setError(`${err.message} Any completed suggestions are saved below. You can add a partial set or start over.`);
    } finally {
      if (!cancelled()) { setProgress(null); running.current = false; }
    }
  }

  function stop() {
    job.current++; running.current = false; setProgress(null);
    setMessage('Stopped. Completed suggestions are saved. A request already sent may still finish, but its result will not be added.');
  }

  function addCore() {
    if (running.current || !selected.length) return;
    updateTopics(prev => prev.map(t => t.id === topicId ? acceptDraft(t, () => crypto.randomUUID(), newSrs) : t));
    setView('topic');
  }

  return <div className="content-layout">
    <div className="content-main">
      <section className="studio-panel source-panel">
        <div className="panel-heading"><span className="step-number">01</span><div><h2>Bring what you’re learning</h2><p>One chapter or a few sections at a time.</p></div></div>
        <button className="source-drop" disabled={busy || !!draft} onClick={() => fileInput.current?.click()}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy && !draft) readFiles([...e.dataTransfer.files]); }}>
          <span className="source-symbol" aria-hidden="true">↥</span><strong>Drop your chapter notes here</strong><span>Markdown or text · click to browse</span>
        </button>
        <input ref={fileInput} type="file" accept=".md,.markdown,.txt" multiple hidden disabled={busy || !!draft}
          onChange={e => { readFiles([...e.target.files]); e.target.value = ''; }}/>
        {files.length > 0 && <div className="source-files">{files.map(f => <span key={f.name}>{f.name}<button disabled={busy || !!draft} aria-label={`Remove ${f.name}`} onClick={() => setFiles(prev => prev.filter(x => x.name !== f.name))}>×</button></span>)}</div>}
        <label className="studio-label" htmlFor="source-notes">Or paste your notes</label>
        <textarea className="studio-input source-text" id="source-notes" value={notes} disabled={busy || !!draft} onChange={e => setNotes(e.target.value)}/>
        <details className="focus-details"><summary>Give the selection a focus <span>optional</span></summary>
          <label className="studio-label" htmlFor="learning-focus">What would you like to understand or do?</label>
          <input id="learning-focus" className="studio-input" maxLength={1500} value={topic?.learningGoal || ''} disabled={busy || !!draft} onChange={e => update({ learningGoal: e.target.value })}/>
        </details>
        {tooLarge && <p className="studio-warning">This import is too large. Choose fewer sections: up to 180,000 characters and 48 source segments at a time.</p>}
      </section>

      <section className="studio-panel">
        <div className="panel-heading"><span className="step-number">02</span><div><h2>Keep the workload comfortable</h2><p>Choose a ceiling. We only add ideas worth practicing.</p></div></div>
        <div className="depth-options" role="group" aria-label="Content depth">{Object.entries(CONTENT_PROFILES).map(([key, p]) => <button key={key} aria-pressed={key === profileKey}
          className={`depth-option${key === profileKey ? ' active' : ''}`} disabled={!!progress} onClick={() => update({ contentProfile: key })}>
          <span className="depth-name">{p.label}{key === 'balanced' && <span className="recommended-dot" aria-label="Recommended"/>}</span>
          <strong>{p.perImport}<small> / import</small></strong><span>{p.description}</span>
        </button>)}</div>
        <div className="budget-facts"><span><b>{profile.perSection}</b> max per section</span><span><b>{profile.perTopic}</b> max in this topic</span><span><b>1</b> question per concept</span></div>
        {capacity === 0 && <p className="studio-warning">This topic is at its core-set limit. Existing cards and progress are kept. You can choose a broader set or put a new area of study in its own topic.</p>}
        <p className="studio-muted">Useful coverage comes first. Definitions, explanations and applications share one budget. These counts measure workload, not mastery.</p>
      </section>

      <div className="generation-actions">
        {!draft && <button className="studio-primary" onClick={generate} disabled={busy || !chunks.length || tooLarge || !capacity}>{progress ? `Reading ${progress.current} of ${progress.total}…` : 'Find the core ideas'}<span aria-hidden="true">↗</span></button>}
        {progress && <button className="studio-secondary" onClick={stop}>Stop generation</button>}
        {!progress && draft && <button className="studio-secondary" onClick={() => { if (window.confirm('Discard this draft and start another import? Your saved study cards are kept.')) { update({ contentDraft: null }); setError(''); setMessage(''); } }}>Start a new import</button>}
        <p className="studio-muted">{reading ? 'Reading your files…' : 'Source text is sent to Anthropic using your API key. Suggestions are saved after each segment.'}</p>
      </div>
      {error && <p className="studio-warning" role="alert">{error}</p>}
      {message && <p className="studio-message" role="status">{message}</p>}
      {progress && <div className="generation-progress" role="status"><span>{progress.section}</span><progress max={progress.total} value={progress.current}/></div>}

      {draft && <section className="studio-panel draft-preview">
        <div className="panel-heading"><span className="step-number">03</span><div><h2>Your core set</h2><p>{selected.length} new questions · {new Set(selected.map(c => c.concept)).size} distinct concepts</p></div><span className="saved-badge">Saved draft</span></div>
        {draft.processed < draft.total && <p className="studio-warning">Partial import: {draft.processed} of {draft.total} source segments completed. The remaining material has not been assessed.</p>}
        {selected.length ? <div className="suggestion-list">{selected.map((card, index) => <article className="suggestion" key={`${card.sectionId}:${card.front}`}>
          <div className="suggestion-top"><span className="question-index">{String(index + 1).padStart(2, '0')}</span><div><span className="concept-label">{card.concept}</span><h3>{card.front}</h3></div><span className="skill-tag">{SKILLS[card.skill]}</span></div>
          <p className="suggestion-why">{card.why}</p>
          <details className="answer-details"><summary>Answer & source</summary><p>{card.back}</p><span className="studio-muted">{card.source.name} · {card.source.section}</span><blockquote>{card.source.quote}</blockquote></details>
          <button className="omit-button" disabled={!!progress} onClick={() => update({ contentDraft: { ...draft, cards: draft.cards.map(c => c === card ? { ...c, excluded: true } : c) } })}>Leave this one out</button>
        </article>)}</div> : <p className="studio-muted">No additional questions fit the current selection. You can change the depth or start another import.</p>}
        {draft.cards.some(c => c.excluded) && <button className="studio-secondary" disabled={!!progress} onClick={() => update({ contentDraft: { ...draft, cards: draft.cards.map(c => ({ ...c, excluded: false })) } })}>Restore omitted suggestions</button>}
        {draft.rejected > 0 && <p className="studio-muted">{draft.rejected} duplicate, invalid or unsupported suggestions were filtered out.</p>}
        <div className="draft-footer"><p>Check an answer whenever you need to. Matching a source passage does not guarantee a correct answer.</p><button className="studio-primary" disabled={!!progress || !selected.length} onClick={addCore}>Add {selected.length} questions <span aria-hidden="true">→</span></button></div>
      </section>}
    </div>

    <aside className="content-sidebar">
      <div className="set-summary"><span className="studio-eyebrow">ROOM TO LEARN</span><div className="set-number">{Math.min(profile.perImport, capacity)}<span>new questions at most</span></div><p>A useful study set that stays within reach.</p><div className="capacity-track"><span style={{ width: `${Math.min(100, cards.length / profile.perTopic * 100)}%` }}/></div><div className="capacity-label"><span>{cards.length} already in this topic</span><span>{profile.perTopic} limit</span></div></div>
      <section className="outline-panel"><div className="outline-heading"><h2>Section outline</h2><span>{plannedSections.length}</span></div>
        {plannedSections.length ? <ul>{plannedSections.map((s, i) => {
          const count = [...cards, ...selected].filter(c => c.sectionId === s.id).length;
          return <li key={s.id}><span className={`outline-dot${count ? ' included' : ''}`}>{i + 1}</span><div><strong>{s.title}</strong><span>{count ? `${count} questions in the set` : draft ? 'No question selected' : 'Detected from your notes'}</span></div></li>;
        })}</ul> : <div className="outline-empty"><span aria-hidden="true">≡</span><p>Your sections will appear here automatically.</p></div>}
        {draft && unrepresented.length > 0 && <p className="coverage-note">{unrepresented.length} section{unrepresented.length === 1 ? '' : 's'} without a selected question. This core set does not claim complete coverage of the source.</p>}
      </section>
      <div className="studio-footnote"><span aria-hidden="true">✦</span><p>Learn a useful range of ideas. Revisit them over time. Let the set grow deliberately.</p></div>
    </aside>
  </div>;
}

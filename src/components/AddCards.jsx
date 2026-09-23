import { useRef, useState } from 'react';
import { useApp } from './context.js';
import { Screen } from './shared.jsx';
import { newSrs } from '../lib/fsrs.js';
import { clozeParts } from '../lib/cards.js';
import ContentStudio from './ContentStudio.jsx';
import '../content-studio.css';

export default function AddCards() {
  const { topics, topicId, updateTopics, setView } = useApp();
  const topic = topics.find(t => t.id === topicId);
  const [tab, setTab] = useState('notes');
  const [front, setFront] = useState(''), [back, setBack] = useState('');
  const [clozeText, setClozeText] = useState(''), [message, setMessage] = useState('');
  const clozeRef = useRef(null);
  const add = fields => {
    const card = { id: crypto.randomUUID(), wrong: [], ...fields, srs: newSrs() };
    updateTopics(prev => prev.map(t => t.id !== topicId ? t : { ...t, cards: [...t.cards, card] }));
    setMessage('Card added.');
  };

  return <Screen className="focus-workspace">
    <div className="workspace-topbar"><button className="workspace-back" onClick={() => setView('topic')}>← {topic?.name}</button><span className="workspace-brand">AERO<span>FLASH</span></span></div>
    <header className="workspace-header"><span className="studio-eyebrow">BUILD YOUR STUDY SET</span><h1>Make room for what matters.</h1><p>Turn your reading into a focused collection of ideas worth remembering.</p></header>
    <div className="studio-tabs" role="group" aria-label="Add content method">{[['notes', 'From your reading'], ['manual', 'Write a question'], ['cloze', 'Fill in the blank']].map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} aria-pressed={tab === key} onClick={() => { setTab(key); setMessage(''); }}>{label}</button>)}</div>
    {tab === 'notes' && <ContentStudio key={topicId}/>}
    {tab === 'manual' && <section className="studio-panel manual-panel"><h2>One clear question</h2><p className="studio-muted">Manual additions are yours to choose. Automatic content limits apply to generated sets.</p>
      <label className="studio-label" htmlFor="manual-front">Question</label><textarea id="manual-front" className="studio-input" value={front} onChange={e => setFront(e.target.value)}/>
      <label className="studio-label" htmlFor="manual-back">Answer</label><textarea id="manual-back" className="studio-input" value={back} onChange={e => setBack(e.target.value)}/>
      <button className="studio-primary" disabled={!front.trim() || !back.trim()} onClick={() => { add({ type: 'basic', front: front.trim(), back: back.trim() }); setFront(''); setBack(''); }}>Add question</button>
    </section>}
    {tab === 'cloze' && <section className="studio-panel manual-panel"><h2>Recall the missing piece</h2><label className="studio-label" htmlFor="cloze-text">Sentence with one blank</label>
      <textarea id="cloze-text" ref={clozeRef} className="studio-input" value={clozeText} onChange={e => setClozeText(e.target.value)}/>
      <p className="studio-muted">Select a term and choose “Blank selection”, or wrap it in {'{{c1::term}}'}.</p>
      <div className="generation-actions"><button className="studio-secondary" onClick={() => { const { selectionStart: s, selectionEnd: e } = clozeRef.current; if (s !== e) setClozeText(t => `${t.slice(0, s)}{{c1::${t.slice(s, e)}}}${t.slice(e)}`); }}>Blank selection</button>
        <button className="studio-primary" disabled={!clozeParts(clozeText)} onClick={() => { add({ type: 'cloze', front: '', back: clozeParts(clozeText).answer, text: clozeText.trim() }); setClozeText(''); }}>Add cloze</button></div>
    </section>}
    {message && <p className="studio-message" role="status">{message}</p>}
  </Screen>;
}

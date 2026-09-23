import { useState } from 'react';
import { useApp } from './context.js';
import { Screen, ClozeText } from './shared.jsx';
import { dueCount } from '../lib/fsrs.js';
import { isCloze, isQuizzable } from '../lib/cards.js';
import { profileFor } from '../../content-engine.mjs';
import '../content-studio.css';

function srsLabel(srs) {
  if (!srs || srs.state === 'new') return 'New';
  if (srs.state === 'learning' || srs.state === 'relearning') return 'Learning';
  const days = Math.round((srs.due - Date.now()) / 864e5);
  return days <= 0 ? 'Due' : `In ${days}d`;
}

export default function TopicView() {
  const { topics, topicId, updateTopics, setView, startReview } = useApp();
  const [query, setQuery] = useState('');
  const topic = topics.find(t => t.id === topicId);
  const cards = topic?.cards || [];
  const dc = dueCount(cards);
  const profile = profileFor(topic?.contentProfile);
  const quizzable = cards.filter(isQuizzable).length;
  const sections = topic?.sections || [];
  const knownSections = new Set(sections.map(s => s.id));
  const groups = [...sections, ...(cards.some(c => !knownSections.has(c.sectionId))
    ? [{ id: null, title: 'Your existing & manual questions', name: 'Preserved with their review history' }] : [])];
  const matches = c => `${c.concept || ''} ${c.front || ''} ${c.back || ''} ${c.text || ''}`.toLowerCase().includes(query.trim().toLowerCase());
  const deleteCard = cid => {
    if (window.confirm('Delete this question and its scheduling state?')) updateTopics(prev => prev.map(t => t.id !== topicId ? t : { ...t, cards: t.cards.filter(c => c.id !== cid) }));
  };

  return <Screen className="focus-workspace">
    <div className="workspace-topbar"><button className="workspace-back" onClick={() => setView('home')}>← All topics</button><span className="workspace-brand">AERO<span>FLASH</span></span></div>
    <header className="topic-hero"><div><span className="studio-eyebrow">YOUR LEARNING SPACE</span><h1>{topic?.name}</h1><p>A focused collection. A little stronger with every return.</p><div className="topic-metrics"><span><b>{cards.length}</b> questions</span><span><b>{sections.length}</b> source sections</span><span><b>{dc}</b> due</span></div></div><div className="topic-art" aria-hidden="true"><span/><span/><span/><i>✦</i></div></header>
    <div className="topic-workspace-grid">
      <main>
        <div className="topic-action-row"><button className="studio-primary" onClick={() => setView('typedQuiz')} disabled={!cards.length}>Practice recall <span aria-hidden="true">→</span></button><button className="studio-secondary" onClick={() => setView('addCards')}>+ Add from your reading</button></div>
        {topic?.contentDraft && <button className="saved-draft-callout" onClick={() => setView('addCards')}><span>✦</span><div><strong>You have a saved core-set draft</strong><span>Continue where you left off</span></div><span>→</span></button>}
        <div className="section-list-heading"><h2>Your sections</h2><label className="section-search"><span className="sr-only">Search questions</span><input className="studio-input" type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search questions"/></label></div>
        {!cards.length && !sections.length && <div className="topic-empty"><span aria-hidden="true">↗</span><h2>Start with one useful chapter.</h2><p>Import your notes. We’ll find a small set of core ideas and organize the sections for you.</p><button className="studio-primary" onClick={() => setView('addCards')}>Build a core set</button></div>}
        {query && !cards.some(matches) && <p className="studio-muted">No questions match your search.</p>}
        <div className="topic-section-list">{groups.map((section, index) => {
          const inSection = cards.filter(c => section.id === null ? !knownSections.has(c.sectionId) : c.sectionId === section.id);
          const visible = inSection.filter(matches);
          if (query && !visible.length) return null;
          return <details className="topic-section" key={section.id || 'legacy'} open={query ? true : undefined}>
            <summary><span className="section-order">{String(index + 1).padStart(2, '0')}</span><div><h3>{section.title}</h3><span>{section.name}</span></div><span className="section-count">{inSection.length} questions</span><span className="section-toggle" aria-hidden="true">+</span></summary>
            {!inSection.length && <p className="empty-section-note">No question was selected for this section. It is visible here so you can see the limits of this set’s coverage.</p>}
            {visible.map(card => <article className="topic-question" key={card.id}><div><span className="concept-label">{card.concept || (isCloze(card) ? 'Fill in the blank' : 'Recall')}</span><h4>{isCloze(card) ? <ClozeText text={card.text} revealed/> : card.front}</h4><p>{card.back}</p>
              <div className="question-tags"><span>{srsLabel(card.srs)}</span>{card.priority && <span>{card.priority}</span>}{card.skill && <span>{card.skill}</span>}</div>
              {card.source && <details className="answer-details"><summary>Why this question & source</summary><p>{card.why}</p><blockquote>{card.source.quote}</blockquote></details>}
            </div><button className="question-delete" aria-label={`Delete question: ${card.front || card.text}`} onClick={() => deleteCard(card.id)}>×</button></article>)}
          </details>;
        })}</div>
      </main>
      <aside className="topic-sidebar"><div className="set-summary"><span className="studio-eyebrow">YOUR CORE SET</span><div className="topic-set-number">{cards.length}<span> / {profile.perTopic}</span></div><p>{cards.length >= profile.perTopic ? 'Your set has reached its automatic content limit.' : 'Room to grow, without an endless queue.'}</p><div className="capacity-track"><span style={{ width: `${Math.min(100, cards.length / profile.perTopic * 100)}%` }}/></div><span className="capacity-label">{profile.label} · workload limit</span></div>
        <section className="practice-options"><h2>Choose your practice</h2><button disabled={!dc} onClick={() => startReview(topicId)}><span>Due review</span><b>{dc}</b></button><button disabled={!cards.length} onClick={() => setView('flashcard')}><span>Flip cards</span><b>↗</b></button><button disabled={quizzable < 2} onClick={() => setView('quiz')}><span>Multiple choice</span><b>↗</b></button></section>
        <p className="studio-footnote">Section counts show the size of your study set. Recall, application and mastery tracking will be added in the next stages.</p>
      </aside>
    </div>
  </Screen>;
}

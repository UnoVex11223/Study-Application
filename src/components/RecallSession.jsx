import { useEffect, useRef, useState } from 'react';
import { useApp } from './context.js';
import { Screen } from './shared.jsx';
import { cardPromptText, cardAnswer, isCloze } from '../lib/cards.js';
import { inputForCard, failedRecallAssessment, selectRecallCards, RECALL_SESSION_LIMIT } from '../lib/recall.js';
import { assessAnswer, MAX_ANSWER_CHARS } from '../../assessment-engine.mjs';
import '../content-studio.css';
import '../recall.css';

const SKILL_LABELS = { recall: 'Recall', explain: 'Explain', apply: 'Apply', distinguish: 'Compare' };
const CUES = {
  recall: 'Name the idea, then describe its meaning and defining feature in your own words.',
  explain: 'Describe what happens, why it happens, and any condition that matters.',
  apply: 'State the method, show your reasoning, and give the result.',
  distinguish: 'Describe the defining difference and when each idea applies.',
};
const CHECK_LABELS = { met: 'Present', missing: 'Missing', contradicted: 'Contradicted', uncertain: 'Unclear' };

function RecallRound({ card, sessionId, last, onComplete }) {
  const { beginRecall, completeRecall, recordRecallFeedback, log } = useApp();
  const [answer, setAnswer] = useState('');
  const [hinted, setHinted] = useState(false);
  const [phase, setPhase] = useState('typing');
  const [assessment, setAssessment] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [difficult, setDifficult] = useState(false);
  const [disputed, setDisputed] = useState(false);
  const [selfAssessment, setSelfAssessment] = useState('');
  const [retried, setRetried] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef('typing');
  const active = useRef(true);
  const feedbackTitle = useRef(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (phase === 'feedback') feedbackTitle.current?.focus(); }, [phase]);

  const checkAnswer = async (id) => {
    const ai = window.aeroflash?.ai;
    const result = await assessAnswer(inputForCard(card, answer), {
      isCloze: isCloze(card), gradeAnswer: ai?.gradeAnswer ? payload => ai.gradeAnswer(payload) : undefined,
    });
    if (!active.current) return;
    recordRecallFeedback(id, result);
    gate.current = 'feedback';
    setAssessment(result); setPhase('feedback');
  };

  const submit = async (declaredFailure = false) => {
    if (gate.current !== 'typing' || (!declaredFailure && !answer.trim())) return;
    gate.current = 'grading';
    setError('');
    const id = crypto.randomUUID();
    if (!beginRecall(card, { id, sessionId, answer, hinted, declaredFailure })) {
      gate.current = 'typing'; setError('Your attempt could not be recorded. Please try again.'); return;
    }
    setAttemptId(id);
    if (declaredFailure) {
      const result = failedRecallAssessment();
      recordRecallFeedback(id, result);
      gate.current = 'feedback'; setAssessment(result); setPhase('feedback'); return;
    }
    setPhase('grading');
    await checkAnswer(id);
  };

  const retry = async () => {
    if (gate.current !== 'feedback' || retried || assessment?.outcome !== 'uncertain') return;
    gate.current = 'grading'; setPhase('grading'); setRetried(true);
    setSelfAssessment(''); setDisputed(false);
    await checkAnswer(attemptId);
  };

  const finish = () => {
    if (gate.current !== 'feedback') return;
    gate.current = 'saved';
    const entry = completeRecall(attemptId, { assessment, difficult, disputed, selfAssessment });
    if (!entry) { gate.current = 'feedback'; setError('This attempt could not be completed. Your schedule has not been changed.'); return; }
    onComplete(entry);
  };

  const pending = log.entries.find(entry => entry.attempt?.id === attemptId)?.attempt;
  const practiceOnly = Boolean(pending && (!pending.scheduled || pending.assistance.length));
  const ungraded = assessment?.outcome === 'uncertain' || disputed;
  const outcomeLabel = ungraded ? 'Ungraded' : assessment?.outcome === 'correct' ? 'Essential points covered' : 'Not yet';
  const cue = typeof card.hint === 'string' && card.hint.trim() ? card.hint
    : isCloze(card) ? 'Read the whole sentence and identify the role of the missing term.' : CUES[card.skill] || CUES.recall;

  return <div className="recall-layout">
    <main className="recall-main">
      <article className="recall-question">
        <div className="recall-question-meta"><span className="skill-tag">{isCloze(card) ? 'Fill the blank' : SKILL_LABELS[card.skill] || 'Recall'}</span><span>{card.topicName}</span></div>
        <h1>{cardPromptText(card)}</h1>
      </article>
      <div className="recall-answer-panel">
        <label htmlFor="recall-answer" className="recall-label">Your explanation <span>In your own words</span></label>
        <textarea id="recall-answer" className="studio-input recall-input" value={answer} maxLength={MAX_ANSWER_CHARS}
          autoFocus readOnly={phase !== 'typing'} aria-describedby="recall-answer-help"
          placeholder={isCloze(card) ? 'Type the missing term…' : 'Start with the main idea. A few clear sentences are enough.'}
          onChange={event => setAnswer(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } }}/>
        <div className="recall-input-meta" id="recall-answer-help"><span>{phase === 'typing' ? 'Ctrl / ⌘ + Enter to check · no time limit' : 'Your original answer is saved and locked.'}</span><span>{answer.length.toLocaleString()} / {MAX_ANSWER_CHARS.toLocaleString()}</span></div>
        {hinted && <div className="recall-cue"><strong>Writing cue · assisted practice</strong><p>{cue}</p></div>}
        {phase === 'typing' && <>
          <div className="recall-actions"><button className="studio-primary" disabled={!answer.trim()} onClick={() => submit()}>Check explanation <span aria-hidden="true">→</span></button><button className="studio-secondary" onClick={() => submit(true)}>I don’t know</button></div>
          <button className="recall-link" disabled={hinted} onClick={() => { if (gate.current === 'typing') setHinted(true); }}>{hinted ? 'Cue used · schedule will stay unchanged' : 'Use a writing cue · counts as assisted practice'}</button>
        </>}
      </div>
      {phase === 'grading' && <div className="recall-checking" role="status"><span className="recall-pulse"/><div><strong>Checking the essential points</strong><p>Comparing meaning, reasoning and contradictions.</p></div></div>}
      {phase === 'feedback' && assessment && <section className={`recall-feedback ${ungraded ? 'uncertain' : assessment.outcome}`}>
        <div className="recall-feedback-heading"><div><span className="studio-eyebrow">{disputed ? 'GRADE DISPUTED' : assessment.method === 'ai' ? 'AI ASSESSMENT' : assessment.method === 'exact' ? 'EXACT CLOZE CHECK' : assessment.method === 'self-report' ? 'SELF-REPORTED MISS' : 'ASSESSMENT UNAVAILABLE'}</span><h2 tabIndex={-1} ref={feedbackTitle}>{outcomeLabel}</h2></div><span className="recall-outcome-mark" aria-hidden="true">{ungraded ? '—' : assessment.outcome === 'correct' ? '✓' : '↗'}</span></div>
        <p className="recall-feedback-copy">{assessment.feedback}</p>
        {!!assessment.checks.length && <ul className="recall-checks">{assessment.checks.map(check => <li key={check.index} className={`check-${check.status}`}><div><span className="recall-check-status">{CHECK_LABELS[check.status]}</span><strong>{check.point}</strong></div><p>{check.reason}</p>{check.evidence && <blockquote>“{check.evidence}”</blockquote>}</li>)}</ul>}
        {!!assessment.errors.length && <div className="recall-errors"><h3>Also check this claim</h3>{assessment.errors.map((item, index) => <div key={index}><blockquote>“{item.evidence}”</blockquote><p>{item.reason}</p></div>)}</div>}
        <div className="recall-reference"><h3>Reference answer</h3><p>{cardAnswer(card)}</p></div>
        {card.source?.quote && <details className="answer-details"><summary>Read the source passage</summary><blockquote>{card.source.quote}</blockquote><p>{card.source.name} · {card.source.section}{card.source.startLine ? ` · source segment starts at line ${card.source.startLine}` : ''}</p></details>}
        {ungraded ? <div className="recall-self-check"><label htmlFor="self-check">Optional self-check <span>Recorded separately; does not change your schedule</span></label><select id="self-check" value={selfAssessment} onChange={event => setSelfAssessment(event.target.value)}><option value="">Leave ungraded</option><option value="complete">I think I covered the essential points</option><option value="partial">I missed part of the explanation</option><option value="missed">I did not recall it</option></select></div>
          : assessment.outcome === 'correct' && !practiceOnly && <label className="recall-difficulty"><input type="checkbox" checked={difficult} onChange={event => setDifficult(event.target.checked)}/>I recalled it correctly, but it took effort <span>Use a shorter interval</span></label>}
        <p className="recall-schedule-note">{ungraded ? 'This attempt will stay ungraded. No scheduling or accuracy penalty.' : practiceOnly ? 'Practice recorded separately. Hints, immediate repeats and extra practice do not extend your review interval.' : assessment.outcome === 'correct' ? 'Saving updates your review schedule. Speed never earns a longer interval.' : 'Saving schedules another attempt soon. The question will not repeat inside this session.'}</p>
        <div className="recall-actions"><button className="studio-primary" onClick={finish}>{last ? 'Save & finish' : 'Save & continue'} <span aria-hidden="true">→</span></button>
          {assessment.outcome === 'uncertain' && !retried && <button className="studio-secondary" onClick={retry}>Retry original answer</button>}
          {assessment.method === 'ai' && assessment.outcome !== 'uncertain' && <label className="recall-dispute"><input type="checkbox" checked={disputed} onChange={event => setDisputed(event.target.checked)}/>Dispute this grade</label>}
        </div>
      </section>}
      {error && <p className="studio-error" role="alert">{error}</p>}
    </main>
    <aside className="recall-sidebar">
      <span className="studio-eyebrow">MAKE IT STICK</span><h2>Recall.<br/>Refine.<br/>Return.</h2>
      <ol><li><b>01</b><div><strong>Retrieve first</strong><p>Try before seeing the answer.</p></div></li><li><b>02</b><div><strong>Find the gap</strong><p>Compare the essential points and their meaning.</p></div></li><li><b>03</b><div><strong>Leave some space</strong><p>Let the review schedule bring the idea back.</p></div></li></ol>
      <div className="recall-sidebar-note">A correct answer is one observation. Durable mastery needs successful recall after a delay.</div>
      <p className="studio-footnote">AI judgments can be wrong. Dispute a grade to leave the attempt ungraded.</p>
    </aside>
  </div>;
}

export default function RecallSession({ mode = 'topic' }) {
  const { topics, topicId, reviewQueue, log, setView } = useApp();
  const topic = topics.find(item => item.id === topicId);
  const [session] = useState(() => {
    const available = mode === 'review' ? reviewQueue : (topic?.cards ?? []).map(card => ({ ...card, topicId, topicName: topic.name }));
    return { id: crypto.randomUUID(), cards: selectRecallCards(available, log), available: available.length };
  });
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState([]);
  const completedIds = useRef(new Set());
  const card = session.cards[index];
  const done = !card;
  const back = () => setView(mode === 'review' ? 'home' : 'topic');
  const onComplete = entry => {
    if (completedIds.current.has(entry.attempt.id)) return;
    completedIds.current.add(entry.attempt.id);
    setResults(previous => [...previous, entry]); setIndex(previous => previous + 1);
  };
  const correct = results.filter(entry => entry.attempt.evidence === 'unaided' && entry.attempt.outcome === 'correct').length;
  const missed = results.filter(entry => entry.attempt.evidence === 'unaided' && entry.attempt.outcome === 'incorrect').length;
  const remaining = Math.max(0, session.available - session.cards.length);

  return <Screen className="focus-workspace recall-workspace">
    <div className="workspace-topbar"><button className="workspace-back" onClick={back}>← {mode === 'review' ? 'All topics' : topic?.name || 'Topic'}</button><span className="workspace-brand">AERO<span>FLASH</span></span></div>
    <header className="recall-session-header"><div><span className="studio-eyebrow">{mode === 'review' ? 'DAILY RECALL' : 'RECALL STUDIO'}</span><p>{done ? 'A focused session, complete.' : `One idea at a time · up to ${RECALL_SESSION_LIMIT} questions`}</p></div><span className="recall-session-count">{String(done ? session.cards.length : index + 1).padStart(2, '0')}<span> / {String(session.cards.length).padStart(2, '0')}</span></span></header>
    <div className="recall-progress" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={session.cards.length || 1} aria-valuenow={index}><span style={{ width: `${session.cards.length ? index / session.cards.length * 100 : 0}%` }}/></div>
    {done ? <section className="recall-complete"><div className="recall-complete-symbol" aria-hidden="true">✦</div><span className="studio-eyebrow">ROOM TO LET IT SETTLE</span><h1>{results.length ? 'Good work. Take a breath.' : 'No questions in this session.'}</h1><p>{results.length} first attempts saved. Your next review will use the updated schedule.</p><div className="recall-result-grid"><div><strong>{correct}</strong><span>Unaided correct</span></div><div><strong>{missed}</strong><span>Not yet</span></div><div><strong>{results.length - correct - missed}</strong><span>Practice / ungraded</span></div></div><p className="recall-summary-note">{remaining ? `${remaining} more questions were outside this session’s limit. ` : ''}Missed and ungraded questions may still be due. Session completion does not mean subject mastery.</p><button className="studio-primary" onClick={back}>Back to {mode === 'review' ? 'your topics' : 'topic'} <span aria-hidden="true">→</span></button></section>
      : <RecallRound key={JSON.stringify([card.topicId, card.id])} card={card} sessionId={session.id} last={index === session.cards.length - 1} onComplete={onComplete}/>}
  </Screen>;
}

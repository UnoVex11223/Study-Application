import { useCallback, useEffect, useState } from "react";
import { AppCtx } from "./components/context.js";
import Home from "./components/Home.jsx";
import TopicView from "./components/TopicView.jsx";
import ReviewSession from "./components/ReviewSession.jsx";
import Flashcard from "./components/Flashcard.jsx";
import Quiz from "./components/Quiz.jsx";
import TypedQuiz from "./components/TypedQuiz.jsx";
import Sim from "./components/Sim.jsx";
import AddCards from "./components/AddCards.jsx";
import SettingsModal from "./components/Settings.jsx";
import { loadAll, saveTopics, saveXp, bumpStats, bumpNewCards, newAllowance, logReview, resetProgress as resetProgressStore } from "./lib/storage.js";
import { rate, newSrs, getDueCards } from "./lib/fsrs.js";
import { getLevel, getLvlData, XP_FOR_RATING } from "./lib/xp.js";

export default function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("home");
  const [homeTab, setHomeTab] = useState("topics");
  const [topics, setTopics] = useState([]);
  const [topicId, setTopicId] = useState(null);
  const [xp, setXp] = useState(0);
  const [stats, setStats] = useState({});
  const [log, setLog] = useState({ entries: [], daily: {} });

  const [reviewQueue, setReviewQueue] = useState([]);
  const [sessionNonce, setSessionNonce] = useState(0);

  const [xpPopups, setXpPopups] = useState([]);
  const [levelUpData, setLevelUpData] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [colorPickId, setColorPickId] = useState(null);
  const [deleteConfId, setDeleteConfId] = useState(null);

  useEffect(() => {
    loadAll().then(({ topics, xp, stats, log }) => {
      setTopics(topics); setXp(xp); setStats(stats); setLog(log); setReady(true);
    });
  }, []);

  const updateTopics = useCallback((fn) => {
    setTopics(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      saveTopics(next);
      return next;
    });
  }, []);

  const addXp = useCallback((amount) => {
    setXp(prev => {
      const next = prev + amount;
      saveXp(next);
      const ol = getLevel(prev), nl = getLevel(next);
      if (nl > ol) setTimeout(() => setLevelUpData(getLvlData(nl)), 400);
      return next;
    });
    const id = Date.now() + Math.random();
    setXpPopups(p => [...p, { id, amount }]);
    setTimeout(() => setXpPopups(p => p.filter(x => x.id !== id)), 1900);
  }, []);

  /** Every answer in every mode lands here: reschedule the card, log it, count it, pay XP. */
  const applyRating = useCallback((card, rating, mode) => {
    const wasNew = !card.srs || card.srs.state === "new";
    const updated = rate(card.srs ?? newSrs(), rating);
    updateTopics(p => p.map(t => t.id !== card.topicId ? t : {
      ...t, cards: t.cards.map(c => c.id !== card.id ? c : { ...c, srs: updated }),
    }));
    setStats(s => {
      let ns = bumpStats(s);
      if (wasNew) ns = bumpNewCards(ns);
      return ns;
    });
    setLog(l => logReview(l, { cardId: card.id, topicId: card.topicId, rating, mode }));
    const amt = XP_FOR_RATING[rating];
    if (amt) addXp(amt);
    return updated;
  }, [updateTopics, addXp]);

  const goTopic = useCallback((id) => {
    setTopicId(id); setView("topic"); setColorPickId(null); setDeleteConfId(null);
  }, []);

  const startReview = useCallback((maybeTopicId) => {
    const scopeId = typeof maybeTopicId === "number" ? maybeTopicId : null;
    const scope = scopeId ? topics.filter(t => t.id === scopeId) : topics;
    const queue = getDueCards(scope, { newAllowance: scopeId ? 0 : newAllowance(stats) });
    if (!queue.length) return;
    setReviewQueue(queue);
    setSessionNonce(n => n + 1);
    setView("review");
  }, [topics, stats]);

  const startSim = useCallback(() => { setSessionNonce(n => n + 1); setView("sim"); }, []);

  const clearPickers = useCallback(() => { setColorPickId(null); setDeleteConfId(null); }, []);

  const resetProgress = useCallback(() => {
    const fresh = resetProgressStore();
    setTopics(fresh.topics); setXp(fresh.xp); setStats(fresh.stats); setLog(fresh.log);
    setTopicId(null); setView("home"); setHomeTab("topics"); setSettingsOpen(false);
  }, []);

  if (!ready) return <div className="af"/>;

  const ctx = {
    view, setView, homeTab, setHomeTab,
    topics, updateTopics, topicId, goTopic,
    xp, addXp, stats, setStats, log,
    xpPopups, levelUpData, setLevelUpData,
    applyRating, startReview, reviewQueue, startSim,
    settingsOpen, openSettings: () => setSettingsOpen(true), closeSettings: () => setSettingsOpen(false), resetProgress,
    colorPickId, setColorPickId, deleteConfId, setDeleteConfId, clearPickers,
  };

  return (
    <AppCtx.Provider value={ctx}>
      {view === "home" && <Home/>}
      {view === "topic" && <TopicView/>}
      {view === "review" && <ReviewSession key={`r${sessionNonce}`}/>}
      {view === "flashcard" && <Flashcard key={topicId}/>}
      {view === "quiz" && <Quiz key={topicId}/>}
      {view === "typedQuiz" && <TypedQuiz key={topicId}/>}
      {view === "sim" && <Sim key={`s${sessionNonce}`}/>}
      {view === "addCards" && <AddCards/>}
      <SettingsModal/>
    </AppCtx.Provider>
  );
}

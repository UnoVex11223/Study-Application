// Ranks, level math, and XP reward amounts.

export const RANKS = [
  { level: 1,  name: "Newcomer",     xpNeeded: 0,       color: "#b0bec5", emoji: "🌱", badge: "🪨", desc: "Every expert was once a beginner. Start flipping." },
  { level: 2,  name: "Learner",      xpNeeded: 500,     color: "#90caf9", emoji: "📖", badge: "📗", desc: "You've taken your first real steps. Keep going." },
  { level: 3,  name: "Apprentice",   xpNeeded: 1500,    color: "#64b5f6", emoji: "🔎", badge: "📘", desc: "Patterns are starting to form. Stay consistent." },
  { level: 4,  name: "Journeyman",   xpNeeded: 3000,    color: "#42a5f5", emoji: "🧭", badge: "🗺️", desc: "You know how to study. Now push your limits." },
  { level: 5,  name: "Scholar",      xpNeeded: 5500,    color: "#29b6f6", emoji: "🎓", badge: "🏅", desc: "A true scholar. Knowledge is your foundation." },
  { level: 6,  name: "Researcher",   xpNeeded: 9000,    color: "#26c6da", emoji: "🔬", badge: "🔭", desc: "You dig deep. Surface-level answers don't satisfy you." },
  { level: 7,  name: "Analyst",      xpNeeded: 14000,   color: "#26a69a", emoji: "📊", badge: "📐", desc: "You break things down. Complexity doesn't scare you." },
  { level: 8,  name: "Thinker",      xpNeeded: 20000,   color: "#66bb6a", emoji: "🧠", badge: "💡", desc: "Critical thinking is second nature to you now." },
  { level: 9,  name: "Academic",     xpNeeded: 28000,   color: "#d4e157", emoji: "📜", badge: "🖊️", desc: "Your dedication rivals those who do this for a living." },
  { level: 10, name: "Expert",       xpNeeded: 38000,   color: "#ffca28", emoji: "⚡", badge: "🥈", desc: "One in a hundred reaches this point. You're elite." },
  { level: 11, name: "Specialist",   xpNeeded: 50000,   color: "#ffa726", emoji: "🎯", badge: "🎖️", desc: "You don't just know the material — you own it." },
  { level: 12, name: "Authority",    xpNeeded: 65000,   color: "#ff7043", emoji: "🏛️", badge: "⚖️", desc: "Others would come to you with questions." },
  { level: 13, name: "Master",       xpNeeded: 83000,   color: "#ef5350", emoji: "🔥", badge: "🏆", desc: "Mastery is not a destination. You keep going anyway." },
  { level: 14, name: "Virtuoso",     xpNeeded: 104000,  color: "#ec407a", emoji: "🎻", badge: "🌟", desc: "Effortless execution built on thousands of reps." },
  { level: 15, name: "Prodigy",      xpNeeded: 130000,  color: "#ab47bc", emoji: "✨", badge: "💫", desc: "What you've built here is genuinely extraordinary." },
  { level: 16, name: "Sage",         xpNeeded: 160000,  color: "#7e57c2", emoji: "🌀", badge: "💎", desc: "Wisdom hard-won over countless study sessions." },
  { level: 17, name: "Oracle",       xpNeeded: 195000,  color: "#5c6bc0", emoji: "🔮", badge: "🌐", desc: "You see what others miss. Insight is your weapon." },
  { level: 18, name: "Legend",       xpNeeded: 237000,  color: "#ff6b6b", emoji: "🌟", badge: "👑", desc: "Spoken of in hushed tones. A rare breed entirely." },
  { level: 19, name: "Grandmaster",  xpNeeded: 285000,  color: "#ffd700", emoji: "🏆", badge: "🌠", desc: "The very top of the mountain. Almost no one gets here." },
  { level: 20, name: "Transcendent", xpNeeded: 340000,  color: "#fff9c4", emoji: "🌌", badge: "🌠", desc: "Beyond rank. Beyond comparison. You are the standard." },
];

export const getLevel      = (xp) => { let l = 1; for (const r of RANKS) { if (xp >= r.xpNeeded) l = r.level; } return l; };
export const getLvlData    = (l)  => RANKS.find(r => r.level === l) || RANKS[0];
export const getXpForLevel = (l)  => RANKS.find(r => r.level === l)?.xpNeeded ?? 0;
export const getNextXp     = (l)  => RANKS.find(r => r.level === l + 1)?.xpNeeded ?? (getXpForLevel(l) + 200);

// XP per rating in review sessions (Again earns nothing — honesty is free).
export const XP_FOR_RATING = { 1: 0, 2: 5, 3: 10, 4: 15 };
export const XP_QUEUE_CLEARED = 50;
export const XP_QUIZ_CORRECT = 15;
export const XP_SESSION_DONE = 10;

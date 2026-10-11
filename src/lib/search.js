// Fuzzy matching for the command palette. Every word of the query has to
// appear in the text: best as a whole substring (more so at the start of a
// word), otherwise as letters in order, where letters that start words count
// for more ("ptf" finds "Pointers to functions").

const SEPARATOR = /[\s\-_/.:,;()[\]'"&+]/;
const startsWord = (text, i) => i === 0 || SEPARATOR.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

function matchWord(word, text, lower) {
  let best = null;
  for (let i = lower.indexOf(word); i !== -1; i = lower.indexOf(word, i + 1)) {
    const score = 10 + word.length * 2 + (startsWord(text, i) ? 8 : 0) + (i === 0 ? 4 : 0);
    if (!best || score > best.score) best = { score, hits: Array.from({ length: word.length }, (_, k) => i + k) };
  }
  if (best) return best;
  // Letters in order: jump to the start of a word when one has the letter, unless it follows straight on.
  // Most letters have to start a word or follow straight on, so stray letters
  // scattered through a long title ("point" in "Programming Language") don't count.
  const hits = [];
  let score = 0, from = 0, prev = -2, good = 0;
  for (const ch of word) {
    let i = lower.indexOf(ch, from);
    if (i === -1) return null;
    if (i !== prev + 1) {
      for (let j = i; j !== -1; j = lower.indexOf(ch, j + 1)) if (startsWord(text, j)) { i = j; break; }
    }
    const kind = i === prev + 1 ? 3 : startsWord(text, i) ? 4 : 1;
    if (kind > 1) good++;
    score += kind;
    hits.push(i);
    prev = i;
    from = i + 1;
  }
  if (!startsWord(text, hits[0]) || good < Math.ceil(word.length * 0.6)) return null;
  const spread = hits[hits.length - 1] - hits[0] + 1 - hits.length;
  return { score: score - spread * 0.15, hits };
}

/** How well a query matches a text: { score, hits } (character positions), or null. */
export function fuzzy(query, text) {
  const q = String(query || "").toLowerCase().trim();
  const t = String(text || "");
  if (!q) return { score: 0, hits: [] };
  const lower = t.toLowerCase();
  let score = 0;
  const hits = new Set();
  for (const w of q.split(/\s+/)) {
    const m = matchWord(w, t, lower);
    if (!m) return null;
    score += m.score;
    for (const h of m.hits) hits.add(h);
  }
  if (lower === q) score += 20;
  else if (lower.startsWith(q)) score += 12;
  return { score: score - t.length * 0.02, hits: [...hits].sort((a, b) => a - b) };
}

/**
 * The items that match, best first, each with { score, hits }. An item is
 * { title, sub?, boost? }: the title is what's matched (and highlighted); if it
 * doesn't match on its own, the title with the sub ("Pointers C Programming")
 * is tried at a discount.
 */
export function rank(items, query, limit = 60) {
  const out = [];
  for (const it of items) {
    let m = fuzzy(query, it.title);
    if (m) m = { score: m.score, hits: m.hits };
    else if (it.sub) {
      const both = fuzzy(query, `${it.title} ${it.sub}`);
      if (both) m = { score: both.score * 0.7, hits: both.hits.filter(h => h < it.title.length) };
    }
    if (m) out.push({ ...it, score: m.score + (it.boost || 0), hits: m.hits });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The text in runs of plain and matched characters, for highlighting: [{ text, hit }]. */
export function highlight(text, hits = []) {
  const on = new Set(hits);
  const runs = [];
  for (let i = 0; i < text.length; i++) {
    const hit = on.has(i);
    if (runs.length && runs[runs.length - 1].hit === hit) runs[runs.length - 1].text += text[i];
    else runs.push({ text: text[i], hit });
  }
  return runs;
}

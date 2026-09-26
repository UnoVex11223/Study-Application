// Study-day helpers. A "study day" starts at a rollover hour (default 4am local),
// so a late-night session still counts toward the day you started it.

export const DAY_MS = 864e5;
const pad = (n) => String(n).padStart(2, "0");

let defaultRollover = 4;
export const setRolloverHour = (h) => { defaultRollover = Number.isFinite(h) ? h : 4; };

/** Local YYYY-MM-DD of the study day containing `ts`. */
export function dayKey(ts = Date.now(), rolloverHour = defaultRollover) {
  const d = new Date(ts - rolloverHour * 3600e3);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Epoch ms when the study day containing `ts` began. */
export function dayStartTs(ts = Date.now(), rolloverHour = defaultRollover) {
  const d = new Date(ts - rolloverHour * 3600e3);
  d.setHours(rolloverHour, 0, 0, 0);
  return d.getTime();
}

/** Epoch ms when the study day containing `ts` ends (next rollover). */
export function dayEndTs(ts = Date.now(), rolloverHour = defaultRollover) {
  const d = new Date(dayStartTs(ts, rolloverHour));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Parse a day key back to local midnight. */
export const keyToDate = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from key a to key b (b - a). */
export const daysBetween = (a, b) => Math.round((keyToDate(b) - keyToDate(a)) / DAY_MS);

export function formatMinutes(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function relativeDays(ts, now = Date.now()) {
  const days = Math.round((ts - now) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 31) return `in ${days} days`;
  if (days < 365) return `in ${Math.round(days / 30.4)} months`;
  return `in ${(days / 365).toFixed(1)} years`;
}

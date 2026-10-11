// The map's time-lapse: how every concept's status changed, day by day, from
// the first thing you added to today. A concept appears on the day it was
// added (or first answered, if that was earlier) and changes status on the
// days its answers changed it, using the same rule as everywhere else
// (statusFrom in lib/mastery.js), so the last day matches the map as it is.

import { index } from "./model.js";
import { statusFrom, TRANSFER } from "./mastery.js";
import { dayKey, addDays, daysBetween } from "./time.js";

/** { start, end (day keys), days (how many), appear: { id: day }, changes: { id: [{ day, status }] } } */
export function lapseTimeline(state, now = Date.now(), rolloverHour) {
  const ix = index(state);
  const today = dayKey(now, rolloverHour);
  const appear = {}, changes = {};
  let start = today;
  for (const c of state.concepts) {
    if (c.suspended) continue;
    const atts = (ix.attemptsByConcept[c.id] || []).slice().sort((a, b) => a.ts - b.ts);
    const created = c.createdAt ? dayKey(c.createdAt, rolloverHour) : today;
    const first = atts.length && atts[0].day < created ? atts[0].day : created;
    appear[c.id] = first > today ? today : first;
    if (appear[c.id] < start) start = appear[c.id];
    const hasTransferItem = (ix.itemsByConcept[c.id] || []).some(i => !i.flag && TRANSFER.has(i.ability));
    const list = [];
    let prev = "new";
    for (const d of [...new Set(atts.map(a => a.day))].sort()) {
      const st = statusFrom(atts.filter(a => a.day <= d), { hasTransferItem }).status;
      if (st !== prev) { list.push({ day: d, status: st }); prev = st; }
    }
    changes[c.id] = list;
  }
  return { start, end: today, days: daysBetween(start, today) + 1, appear, changes };
}

/** A concept's status on a day, from its list of changes. */
export function statusOn(list, day) {
  let s = "new";
  for (const ch of list || []) {
    if (ch.day > day) break;
    s = ch.status;
  }
  return s;
}

/** The day key `n` days after the timeline's start. */
export const lapseDay = (timeline, n) => addDays(timeline.start, Math.max(0, Math.min(timeline.days - 1, Math.round(n))));

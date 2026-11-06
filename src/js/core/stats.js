import { CATEGORIES } from './schema.js';
import { daysBetween, financialYear, isoWeek, lastTwelveMonths, monthOf, todayIst } from './dates.js';
import { sumPaise } from './money.js';
import { passwordReport } from './passwords.js';

/** Every dashboard figure, computed in one pass. Time O(n + a), memory O(c + y) for c categories, y years. */
export function computeStats(items, attachments, customCats, nowMs) {
  const today = todayIst(nowMs);
  const live = items.filter((i) => i.trash === undefined);
  const liveIds = new Set(live.map((i) => i.id));
  const liveAtts = attachments.filter((a) => liveIds.has(a.item));

  const byCat = new Map([...CATEGORIES, ...customCats].map((c) => [c.id, { id: c.id, label: c.label, count: 0 }]));
  const months = new Map(lastTwelveMonths(today).map((k) => [k, 0]));
  const byFy = new Map();
  const due = { overdue: 0, in30: 0, in90: 0, in365: 0, later: 0 };
  const amountByTemplate = new Map();
  const nowWeek = isoWeek(today);
  let addedThisWeek = 0;

  for (const it of live) {
    if (byCat.has(it.c)) byCat.get(it.c).count += 1;
    const added = todayIst(it.cr);
    const addedMonth = monthOf(added).key;
    if (months.has(addedMonth)) months.set(addedMonth, months.get(addedMonth) + 1);
    const w = isoWeek(added);
    if (w.year === nowWeek.year && w.week === nowWeek.week) addedThisWeek += 1;
    const fy = financialYear(it.doc || added);
    byFy.set(fy.start, { label: fy.label, count: (byFy.get(fy.start)?.count ?? 0) + 1 });
    if (it.exp) {
      const left = daysBetween(today, it.exp);
      if (left < 0) due.overdue += 1;
      else if (left <= 30) due.in30 += 1;
      else if (left <= 90) due.in90 += 1;
      else if (left <= 365) due.in365 += 1;
      else due.later += 1;
    }
    if (typeof it.amt === 'number') {
      if (!amountByTemplate.has(it.t)) amountByTemplate.set(it.t, []);
      amountByTemplate.get(it.t).push(it.amt);
    }
  }

  const health = passwordReport(items, nowMs);
  const amounts = {};
  for (const [t, list] of amountByTemplate) amounts[t] = sumPaise(list);

  return {
    today,
    items: live.length,
    trashed: items.length - live.length,
    categoriesUsed: [...byCat.values()].filter((c) => c.count > 0).length,
    files: liveAtts.length,
    fileBytes: liveAtts.reduce((n, a) => n + a.size, 0),
    favourites: live.filter((i) => i.fav === 1).length,
    addedThisWeek,
    week: nowWeek.label,
    fy: financialYear(today).label,
    byCategory: [...byCat.values()],
    byMonth: [...months].map(([key, count]) => ({ key, count })),
    byFy: [...byFy].sort((a, b) => a[0] - b[0]).map(([start, v]) => ({ start, ...v })),
    due,
    amounts,
    totalAmount: sumPaise(live.map((i) => i.amt)),
    weak: health.weak.length,
    reused: health.reused.length,
    passwordsToFix: new Set([...health.weak, ...health.reused].map((i) => i.id)).size,
    old: health.old.length,
    passwordsChecked: health.checked,
  };
}

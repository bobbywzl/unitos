import type { Lang } from "@/lib/i18n/config";

// Date chips (SPEC.md §29): a date is a calendar day ("2026-09-25"), the
// same in every time zone, shown in one of Google Docs' four formats in the
// language of the person who inserted it. The label is written once, when
// the chip is made or its format changes, and it is the chip's words.

export type DateFormat = "mdy" | "md" | "monthDay" | "iso";

/** Jan 1, 1970 (the default) · Jan 1 · January 01 · 1970-01-01. */
export const DATE_FORMATS: DateFormat[] = ["md", "monthDay", "mdy", "iso"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type Day = { y: number; m: number; d: number };

export function dayOf(date: Date): Day {
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

export function today(): Day {
  return dayOf(new Date());
}

export function addDays(day: Day, n: number): Day {
  return dayOf(new Date(day.y, day.m, day.d + n));
}

export function isoOf(day: Day): string {
  return `${String(day.y).padStart(4, "0")}-${String(day.m + 1).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
}

export function dayFromIso(iso: string): Day | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const day = { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
  const check = new Date(day.y, day.m, day.d);
  return check.getMonth() === day.m && check.getDate() === day.d ? day : null;
}

export function sameDay(a: Day, b: Day): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

export function weekday(day: Day): number {
  return new Date(day.y, day.m, day.d).getDay();
}

/** Days from `from` to `to`. */
export function daysBetween(from: Day, to: Day): number {
  const a = Date.UTC(from.y, from.m, from.d);
  const b = Date.UTC(to.y, to.m, to.d);
  return Math.round((b - a) / 86_400_000);
}

export function monthName(m: number, lang: Lang, short = false): string {
  if (lang === "zh") return `${m + 1}月`;
  return short ? MONTHS[m].slice(0, 3) : MONTHS[m];
}

export function weekdayName(w: number, lang: Lang, short = false): string {
  if (lang === "zh") return `周${"日一二三四五六"[w]}`;
  return short ? WEEKDAYS[w].slice(0, 3) : WEEKDAYS[w];
}

/** "15:30" as the clock shows it: 3:30 PM, 下午3:30. */
export function timeLabel(time: string, lang: Lang): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return "";
  const h = Number(m[1]);
  const min = m[2];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (lang === "zh") return `${h < 12 ? "上午" : "下午"}${h12}:${min}`;
  return `${h12}:${min} ${h < 12 ? "AM" : "PM"}`;
}

/** A date chip's label: the day in its format, then the time when set. */
export function dateLabel(iso: string, format: DateFormat, time: string | null, lang: Lang): string {
  const day = dayFromIso(iso);
  if (!day) return iso;
  let text: string;
  if (format === "iso") text = isoOf(day);
  else if (lang === "zh") {
    text = format === "mdy" ? `${day.y}年${day.m + 1}月${day.d}日` : `${day.m + 1}月${day.d}日`;
  } else if (format === "md") text = `${monthName(day.m, lang, true)} ${day.d}`;
  else if (format === "monthDay") text = `${monthName(day.m, lang)} ${String(day.d).padStart(2, "0")}`;
  else text = `${monthName(day.m, lang, true)} ${day.d}, ${day.y}`;
  return time ? `${text} ${timeLabel(time, lang)}` : text;
}

/** The day in full, as the chip's card shows it: Fri, Sep 25, 2026. */
export function longDayLabel(iso: string, lang: Lang): string {
  const day = dayFromIso(iso);
  if (!day) return iso;
  if (lang === "zh") return `${day.y}年${day.m + 1}月${day.d}日 ${weekdayName(weekday(day), lang)}`;
  return `${weekdayName(weekday(day), lang, true)}, ${monthName(day.m, lang, true)} ${day.d}, ${day.y}`;
}

/** A typed time ("3pm", "15:30", "9:05 am") as "HH:MM", or null. */
export function parseTime(raw: string): string | null {
  const m = /^\s*(上午|下午)?\s*(\d{1,2})(?:[:：](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(raw);
  if (!m) return null;
  let h = Number(m[2]);
  const min = m[3] ? Number(m[3]) : 0;
  const ampm = m[1] ? (m[1] === "上午" ? "am" : "pm") : m[4]?.toLowerCase().replace(/\./g, "");
  if (min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === "pm" && h !== 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export type DateMatch = { iso: string; hint: string };

const WEEKDAY_WORDS = WEEKDAYS.map((w) => w.toLowerCase());

function weekdayIndex(word: string): number {
  if (word.length < 2) return -1;
  return WEEKDAY_WORDS.findIndex((w) => w.startsWith(word));
}

function monthIndex(word: string): number {
  if (word.length < 3) return -1;
  return MONTHS.findIndex((m) => m.toLowerCase().startsWith(word));
}

/** The days a query after "@" names, Google Docs' date words: today,
    tomorrow, yesterday, a weekday ("monday", "next tuesday", "last
    wednesday"), a month with or without a day ("jan", "july 14"), and a date
    written in numbers ("1/1/2021", "2021-01-01"). Newest first; the hint says
    how the day relates to today. */
export function matchDates(query: string, lang: Lang): DateMatch[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [];
  const now = today();
  const out: Day[] = [];
  const push = (day: Day | null) => {
    if (day && !out.some((d) => sameDay(d, day))) out.push(day);
  };
  const words: [string[], number][] = [
    [["today", "今天"], 0],
    [["tomorrow", "明天"], 1],
    [["yesterday", "昨天"], -1],
  ];
  for (const [names, offset] of words) {
    if (names.some((n) => n.startsWith(q) && (q.length >= 2 || /[一-鿿]/.test(q)))) push(addDays(now, offset));
  }
  const rel = /^(next|last) ?(\w*)$/.exec(q);
  if (rel && rel[2]) {
    const w = weekdayIndex(rel[2]);
    if (w >= 0) {
      const current = weekday(now);
      if (rel[1] === "next") push(addDays(now, 7 - current + w));
      else push(addDays(now, -(current - w + 7) % 7 || -7));
    }
  } else if (/^[a-z]+$/.test(q)) {
    const w = weekdayIndex(q);
    if (w >= 0) push(addDays(now, ((w - weekday(now) + 7) % 7) || 7));
  }
  const monthDay = /^([a-z]+)\.? ?(\d{1,2})?(?:,? (\d{4}))?$/.exec(q);
  if (monthDay) {
    const m = monthIndex(monthDay[1]);
    if (m >= 0) {
      const d = monthDay[2] ? Number(monthDay[2]) : 1;
      let y = monthDay[3] ? Number(monthDay[3]) : now.y;
      // A month without a year is the next one to come.
      if (!monthDay[3] && (m < now.m || (m === now.m && d < now.d))) y += 1;
      push(dayFromIso(isoOf({ y, m, d })));
    }
  }
  const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(q);
  if (numeric) {
    const y = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : now.y;
    push(dayFromIso(isoOf({ y, m: Number(numeric[1]) - 1, d: Number(numeric[2]) })));
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(q);
  if (iso) push(dayFromIso(isoOf({ y: Number(iso[1]), m: Number(iso[2]) - 1, d: Number(iso[3]) })));
  return out.map((day) => ({ iso: isoOf(day), hint: relativeLabel(isoOf(day), lang) }));
}

/** How a day relates to today: Today, Tomorrow, In 9 days, 3 days ago. */
export function relativeLabel(iso: string, lang: Lang): string {
  const day = dayFromIso(iso);
  if (!day) return "";
  const n = daysBetween(today(), day);
  if (lang === "zh") {
    if (n === 0) return "今天";
    if (n === 1) return "明天";
    if (n === -1) return "昨天";
    return n > 0 ? `${n} 天后` : `${-n} 天前`;
  }
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

import type { Lang } from "@/lib/i18n/config";

// Date chips (SPEC.md §29): a date is a calendar day ("2026-09-25"), shown
// in one of Google Docs' four formats in the language of the person who
// inserted it. The label is written when the chip is made or its format
// changes, and it is the chip's words.

export type DateFormat = "mdy" | "md" | "monthDay" | "iso";

/** Jan 1 · January 01 · Jan 1, 1970 (the default) · 1970-01-01. */
export const DATE_FORMATS: DateFormat[] = ["md", "monthDay", "mdy", "iso"];

const FORMAT_OPTIONS: Record<Exclude<DateFormat, "iso">, Intl.DateTimeFormatOptions> = {
  md: { month: "short", day: "numeric" },
  monthDay: { month: "long", day: "2-digit" },
  mdy: { month: "short", day: "numeric", year: "numeric" },
};

/** The English words a query can name a month or a weekday with. */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export type Day = { y: number; m: number; d: number };

function dayOf(date: Date): Day {
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

export function today(): Day {
  return dayOf(new Date());
}

function addDays(day: Day, n: number): Day {
  return dayOf(new Date(day.y, day.m, day.d + n));
}

function weekday(day: Day): number {
  return new Date(day.y, day.m, day.d).getDay();
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

/** A day in the page's language, as Intl writes it. */
export function formatDay(day: Day, lang: Lang, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", options).format(new Date(day.y, day.m, day.d, 12));
}

/** "15:30" as the clock shows it: 3:30 PM, 下午3:30. */
export function timeLabel(time: string, lang: Lang): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return "";
  const at = new Date(2000, 0, 1, Number(m[1]), Number(m[2]));
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(at);
}

/** A date chip's label: the day in its format, then the time when set. */
export function dateLabel(iso: string, format: DateFormat, time: string | null, lang: Lang): string {
  const day = dayFromIso(iso);
  if (!day) return iso;
  const text = format === "iso" ? isoOf(day) : formatDay(day, lang, FORMAT_OPTIONS[format]);
  return time ? `${text} ${timeLabel(time, lang)}` : text;
}

/** The day in full, as the chip's card shows it: Fri, Sep 25, 2026. */
export function longDayLabel(iso: string, lang: Lang): string {
  const day = dayFromIso(iso);
  return day ? formatDay(day, lang, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : iso;
}

/** How a day relates to today: Today, Tomorrow, In 9 days, 3 days ago. */
export function relativeLabel(iso: string, lang: Lang): string {
  const day = dayFromIso(iso);
  if (!day) return "";
  const n = Math.round((Date.UTC(day.y, day.m, day.d) - Date.UTC(today().y, today().m, today().d)) / 86_400_000);
  const text = new Intl.RelativeTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { numeric: "auto" }).format(n, "day");
  return text.charAt(0).toUpperCase() + text.slice(1);
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

function weekdayIndex(word: string): number {
  return word.length < 2 ? -1 : WEEKDAYS.findIndex((w) => w.startsWith(word));
}

function monthIndex(word: string): number {
  return word.length < 3 ? -1 : MONTHS.findIndex((m) => m.startsWith(word));
}

/** The days a query after "@" names, Google Docs' date words: today,
    tomorrow, yesterday, a weekday ("monday", "next tuesday", "last
    wednesday"), a month with or without a day ("jan", "july 14"), and a
    date in numbers ("1/1/2021", "2021-01-01"). */
export function matchDates(query: string, lang: Lang): { iso: string; hint: string }[] {
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

"use client";

import { useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon } from "@/components/docs/insert/icons";
import { dayFromIso, isoOf, monthName, parseTime, sameDay, timeLabel, today, weekdayName, type Day } from "@/components/docs/insert/dates";

// Google Docs' date picker (SPEC.md §29): the month with ‹ ›, the weekdays,
// six weeks of days (other months' days gray, the chosen day a blue circle),
// Today, then Set time, and OK.

export function DatePicker({
  initial,
  initialTime = null,
  onPick,
}: {
  initial?: string | null;
  initialTime?: string | null;
  onPick: (iso: string, time: string | null) => void;
}) {
  const t = useT();
  const lang = useLang();
  const start = (initial && dayFromIso(initial)) || today();
  const [chosen, setChosen] = useState<Day>(start);
  const [month, setMonth] = useState({ y: start.y, m: start.m });
  const [time, setTime] = useState(initialTime ? timeLabel(initialTime, lang) : "");
  const first = new Date(month.y, month.m, 1);
  const lead = first.getDay();
  const days: Day[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(month.y, month.m, 1 - lead + i);
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  });
  const now = today();
  const step = (n: number) =>
    setMonth((mo) => {
      const d = new Date(mo.y, mo.m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const title = lang === "zh" ? `${month.y}年${monthName(month.m, lang)}` : `${monthName(month.m, lang)} ${month.y}`;
  const parsedTime = time.trim() ? parseTime(time) : null;
  const timeBad = time.trim() !== "" && parsedTime === null;
  const ok = () => onPick(isoOf(chosen), parsedTime);

  return (
    <div
      className="docs-date-picker"
      onKeyDown={(e) => {
        if (e.key === "Enter" && !timeBad) {
          e.preventDefault();
          ok();
        }
      }}
    >
      <div className="docs-date-head">
        <span className="docs-date-title">{title}</span>
        <button type="button" className="docs-icon-btn" aria-label={t("docsInsert.previousMonth")} data-tip={t("docsInsert.previousMonth")} onClick={() => step(-1)}>
          <ChevronLeftIcon size={20} />
        </button>
        <button type="button" className="docs-icon-btn" aria-label={t("docsInsert.nextMonth")} data-tip={t("docsInsert.nextMonth")} onClick={() => step(1)}>
          <ChevronRightIcon size={20} />
        </button>
      </div>
      <div className="docs-date-grid" role="grid">
        {Array.from({ length: 7 }, (_, w) => (
          <span key={`w${w}`} className="docs-date-weekday" aria-hidden>
            {lang === "zh" ? weekdayName(w, lang).slice(1) : weekdayName(w, lang).slice(0, 1)}
          </span>
        ))}
        {days.map((day) => {
          const other = day.m !== month.m;
          const on = sameDay(day, chosen);
          const isToday = sameDay(day, now);
          return (
            <button
              key={isoOf(day)}
              type="button"
              className={`docs-date-day${other ? " is-other" : ""}${on ? " is-on" : ""}${isToday ? " is-today" : ""}`}
              aria-pressed={on}
              aria-label={isoOf(day)}
              onClick={() => {
                setChosen(day);
                if (other) setMonth({ y: day.y, m: day.m });
              }}
              onDoubleClick={() => onPick(isoOf(day), parsedTime)}
            >
              {day.d}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="docs-text-btn docs-date-today"
        onClick={() => {
          setChosen(now);
          setMonth({ y: now.y, m: now.m });
        }}
      >
        {t("docsInsert.today")}
      </button>
      <div className="docs-date-time">
        <ClockIcon size={20} />
        <input
          className={`docs-field docs-date-time-field${timeBad ? " is-bad" : ""}`}
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder={t("docsInsert.timePlaceholder")}
          aria-label={t("docsInsert.setTime")}
          aria-invalid={timeBad}
        />
      </div>
      <div className="docs-date-actions">
        <button type="button" className="docs-button-primary" disabled={timeBad} onClick={ok}>
          {t("docs.ok")}
        </button>
      </div>
    </div>
  );
}

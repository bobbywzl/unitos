"use client";

import { useSyncExternalStore } from "react";
import { useLang } from "@/components/lang-provider";

// A stored time drawn in the viewer's own time zone, with the zone named
// ("Oct 20, 2026, 4:20 PM PDT"). A server page cannot know the viewer's
// zone, so the server draws the time in UTC and the browser draws it again
// in its zone once the page is live.

const noop = () => () => {};

export function LocalTime({ at, dateOnly = false }: { at: Date | string; dateOnly?: boolean }) {
  const lang = useLang();
  const live = useSyncExternalStore(noop, () => true, () => false);
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { year: "numeric", month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  const text = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", live ? options : { ...options, timeZone: "UTC" }).format(date);
  return <time dateTime={date.toISOString()}>{text}</time>;
}

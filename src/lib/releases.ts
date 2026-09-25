import type { TKey } from "@/lib/i18n/dictionaries";

// Releases (SPEC.md §18): one entry per shipped set of new functions. A
// release does two things once it is deployed: the dashboard posts its
// update notification to every account that existed before it (the title
// and body from the dictionary, in the account's language), and every
// control it names glows — the New glow (components/new-feature.tsx) — until
// the reader presses it, for NEW_GLOW_DAYS after the release. Newest last.
// No database here: client components import this file.

export type Release = {
  /** The release's id: its date, and a suffix when a day ships twice. */
  id: string;
  /** The day it shipped, ISO: an account made after that day is never told. */
  date: string;
  titleKey: TKey;
  bodyKey: TKey;
  /** The controls that glow: each carries useNewFeature(<id>). */
  features: string[];
};

export const RELEASES: Release[] = [
  {
    id: "2026-09-24",
    date: "2026-09-24",
    titleKey: "works.release20260924Title",
    bodyKey: "works.release20260924Body",
    features: ["collapse", "annotationsFullPage", "byDocument", "conversations"],
  },
  {
    id: "2026-09-25",
    date: "2026-09-25",
    titleKey: "works.release20260925Title",
    bodyKey: "works.release20260925Body",
    features: ["define"],
  },
];

/** How long a release's controls glow after it shipped. */
export const NEW_GLOW_DAYS = 45;

/** The release that added the control, or null. */
export function releaseOfFeature(feature: string): Release | null {
  for (let i = RELEASES.length - 1; i >= 0; i--) {
    if (RELEASES[i].features.includes(feature)) return RELEASES[i];
  }
  return null;
}

/** The release notification's key: the release and the language it is written in. */
export function releaseKey(release: Release, lang: string): string {
  return `${release.id}:${lang}`;
}

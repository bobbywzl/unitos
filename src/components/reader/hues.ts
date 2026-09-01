import type { TKey } from "@/lib/i18n/dictionaries";

// The four highlight colors (SPEC.md §6), shared by the selection popover's
// color bubble and the Circle & ask card's lasso highlight (SPEC.md §16).
export const HIGHLIGHT_HUES = ["clay", "sage", "gold", "plum"] as const;
export type HighlightHue = (typeof HIGHLIGHT_HUES)[number];

export const HUE_DOT: Record<HighlightHue, string> = {
  clay: "var(--clay-400)",
  sage: "var(--sage-500)",
  gold: "#d9a54a",
  plum: "#a78bfa",
};

export const HUE_KEY: Record<HighlightHue, TKey> = {
  clay: "reader.colorClay",
  sage: "reader.colorSage",
  gold: "reader.colorGold",
  plum: "reader.colorPlum",
};

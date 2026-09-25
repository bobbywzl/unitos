import { emojis } from "@tiptap/extension-emoji";

// The emoji the picker and the ":" menu offer (SPEC.md §29): Tiptap's
// emoji list, in Google Docs' nine groups. Loaded on first use — the list
// is large — through a dynamic import.

export type EmojiGroup = "smileys" | "people" | "animals" | "food" | "travel" | "activities" | "objects" | "symbols" | "flags";

export const EMOJI_GROUPS: EmojiGroup[] = ["smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"];

export type EmojiEntry = { char: string; code: string; words: string; group: EmojiGroup };

const GROUP_OF: Record<string, EmojiGroup> = {
  "": "smileys",
  "people & body": "people",
  "animals & nature": "animals",
  "food & drink": "food",
  "travel & places": "travel",
  activities: "activities",
  objects: "objects",
  symbols: "symbols",
  flags: "flags",
};

export const EMOJIS: EmojiEntry[] = emojis.flatMap((e) => {
  const group = GROUP_OF[e.group ?? ""];
  if (!e.emoji || !group || e.name.startsWith("regional_indicator")) return [];
  const code = (e.shortcodes[0] ?? e.name).replace(/_/g, "-");
  const words = [e.name, ...e.shortcodes, ...e.tags].join(" ").toLowerCase().replace(/_/g, " ");
  return [{ char: e.emoji, code, words, group }];
});

/** The emoji whose name or words fit the query: name starts first. */
export function searchEmojis(query: string, limit = 60): EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!q) return EMOJIS.slice(0, limit);
  const spaced = q.replace(/-/g, " ");
  const starts: EmojiEntry[] = [];
  const words: EmojiEntry[] = [];
  const inside: EmojiEntry[] = [];
  for (const e of EMOJIS) {
    if (e.code.startsWith(q)) starts.push(e);
    else if (e.words.split(" ").some((w) => w.startsWith(spaced))) words.push(e);
    else if (e.words.includes(spaced)) inside.push(e);
    if (starts.length >= limit) break;
  }
  return [...starts, ...words, ...inside].slice(0, limit);
}

// A person as collaboration surfaces render them: the label on notes, edits,
// presence, and the share dialog. Dependency-free — imported from both server
// and client code.

export type NotebookRole = "owner" | "editor" | "viewer";

export type Person = {
  id: string;
  name: string;
  symbol: string; // 1–2 characters shown on the badge
  color: string; // badge background, hex
  picture: string; // "" = no picture; the badge shows the symbol
};

// Badge palette. Readable with white text in light and dark themes.
export const PERSON_COLORS = [
  "#c67139", // clay
  "#7a8a5e", // sage
  "#5c6bc0", // indigo
  "#9c5b8e", // plum
  "#3f8e7e", // teal
  "#a8862d", // gold
  "#647589", // slate
  "#b85c6b", // rose
] as const;

// Stable default color from the account id, so a person keeps one color
// everywhere without ever picking one.
export function personColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return PERSON_COLORS[hash % PERSON_COLORS.length];
}

// Default symbol: the name's first character. Array spread keeps a surrogate
// pair (emoji, CJK beyond the BMP) whole.
export function personSymbol(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}

// The stored account with defaults applied.
export function personOf(user: {
  id: string;
  name: string;
  symbol: string;
  color: string;
  picture: string;
}): Person {
  return {
    id: user.id,
    name: user.name,
    symbol: user.symbol.trim() || personSymbol(user.name),
    color: /^#[0-9a-fA-F]{6}$/.test(user.color) ? user.color : personColor(user.id),
    picture: user.picture,
  };
}

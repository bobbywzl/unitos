// The stored picture's palette (SPEC.md §20): what the diagram and the
// simulation draw with, and what the prompt gives the model for a picture or
// an animation. One place, so the dark re-tint below matches every value.

export const INK = "#2b2622";
export const MUTED = "#6b625a";
export const FILL = "#f3ede4";
export const ACCENT = "#b5563c";
export const PAPER = "#ffffff";
export const CHIP_LINE = "#e5ddd0";
// The prompt's other accents, for a picture that needs more than one.
export const SAGE = "#5f7d5a";
export const GOLD = "#b8912e";
export const PLUM = "#6b5b95";
export const ACCENTS = [ACCENT, SAGE, GOLD, PLUM];

// The reader has a dark theme (globals.css), and a visualization shows in an
// `<img>`, where the page's tokens do not reach it. So the stored SVG carries
// its own dark palette: one style block that re-points the exact values the
// server draws with and the prompt gives the model. Anything drawn in another
// color stays as drawn, and the light picture is untouched.
const DARK: Record<string, string> = {
  [PAPER]: "#221e1a",
  [INK]: "#f2e9dc",
  [MUTED]: "#a2988a",
  [FILL]: "#332d26",
  [CHIP_LINE]: "#3d372e",
  [ACCENT]: "#e08a6e",
  [SAGE]: "#9dba97",
  [GOLD]: "#dcb85e",
  [PLUM]: "#a596cf",
};

export const DARK_RULES = `@media (prefers-color-scheme:dark){${Object.entries(DARK)
  .map(
    ([light, dark]) =>
      `[fill="${light}"]{fill:${dark}}[stroke="${light}"]{stroke:${dark}}[stop-color="${light}"]{stop-color:${dark}}`,
  )
  .join("")}}`;

export const THEME_STYLE = `<style>${DARK_RULES}</style>`;

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

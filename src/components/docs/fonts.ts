import { FontFamily } from "@tiptap/extension-text-style";

// The page editor's fonts (SPEC.md §29): the faces Google Docs lists in its
// font menu. A run stores the face's plain name ("Arial"); the page draws it
// with a fallback of the same shape, so a computer without Arial draws Arimo,
// its metric twin, instead of the browser's default serif.

export type DocsFont = { name: string; fallback: string; web: boolean };

export const DOCS_FONTS: DocsFont[] = [
  { name: "Amatic SC", fallback: "cursive", web: true },
  { name: "Arial", fallback: "Arimo, 'Liberation Sans', Helvetica, sans-serif", web: false },
  { name: "Caveat", fallback: "cursive", web: true },
  { name: "Comfortaa", fallback: "sans-serif", web: true },
  { name: "Comic Sans MS", fallback: "'Comic Neue', 'Comic Sans', cursive", web: false },
  { name: "Courier New", fallback: "Cousine, 'Liberation Mono', monospace", web: false },
  { name: "EB Garamond", fallback: "Garamond, serif", web: true },
  { name: "Georgia", fallback: "Gelasio, serif", web: false },
  { name: "Impact", fallback: "Anton, 'Arial Black', sans-serif", web: false },
  { name: "Lexend", fallback: "sans-serif", web: true },
  { name: "Lobster", fallback: "cursive", web: true },
  { name: "Lora", fallback: "serif", web: true },
  { name: "Merriweather", fallback: "serif", web: true },
  { name: "Montserrat", fallback: "sans-serif", web: true },
  { name: "Nunito", fallback: "sans-serif", web: true },
  { name: "Oswald", fallback: "sans-serif", web: true },
  { name: "Pacifico", fallback: "cursive", web: true },
  { name: "Playfair Display", fallback: "serif", web: true },
  { name: "Roboto", fallback: "sans-serif", web: true },
  { name: "Roboto Mono", fallback: "monospace", web: true },
  { name: "Roboto Serif", fallback: "serif", web: true },
  { name: "Spectral", fallback: "serif", web: true },
  { name: "Times New Roman", fallback: "Tinos, 'Liberation Serif', Times, serif", web: false },
  { name: "Trebuchet MS", fallback: "'Fira Sans', sans-serif", web: false },
  { name: "Verdana", fallback: "'DejaVu Sans', sans-serif", web: false },
];

const BY_NAME = new Map(DOCS_FONTS.map((f) => [f.name.toLowerCase(), f]));

/** The CSS stack for a stored face. */
export function fontStack(name: string): string {
  const font = BY_NAME.get(name.toLowerCase());
  const quoted = /^[\w-]+$/.test(name) ? name : `'${name.replace(/'/g, "")}'`;
  return font ? `${quoted}, ${font.fallback}` : `${quoted}, sans-serif`;
}

/** The first face of a CSS font-family value, unquoted. */
export function firstFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  return first || null;
}

/** The Google Fonts stylesheet for every web face the menu lists, plus the
    metric twins of Arial, Times New Roman, and Courier New. The browser
    downloads a face only when a run uses it. */
export function docsFontsUrl(): string {
  const families = [
    ...DOCS_FONTS.filter((f) => f.web).map((f) => f.name),
    "Arimo",
    "Tinos",
    "Cousine",
    "Comic Neue",
    "Gelasio",
    "Anton",
    "Fira Sans",
  ];
  const query = families
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:ital,wght@0,400;0,700;1,400;1,700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

/** The font family mark with the fallback stack drawn around the stored face. */
export const DocsFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element: HTMLElement) => firstFamily(element.style.fontFamily),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.fontFamily === "string" && attributes.fontFamily
                ? { style: `font-family: ${fontStack(attributes.fontFamily)}` }
                : {},
          },
        },
      },
    ];
  },
});

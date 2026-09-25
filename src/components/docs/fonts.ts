import { FontFamily } from "@tiptap/extension-text-style";

// The page editor's fonts (SPEC.md §29): the faces Google Docs lists in its
// font menu, the reader's own (added with More fonts, kept in this browser),
// and the recent ones. A run stores the face's plain name ("Arial"); the
// page draws it with a fallback of the same shape, so a computer without
// Arial draws Arimo, its metric twin, instead of the browser's default serif.

type DocsFont = {
  name: string;
  fallback: string;
  /** Loaded from Google Fonts (the rest are the computer's own). */
  web: boolean;
  /** The weights it comes in; more than two opens a weight submenu. */
  weights: number[];
};

const W2 = [400, 700];

export const DOCS_FONTS: DocsFont[] = [
  { name: "Amatic SC", fallback: "cursive", web: true, weights: W2 },
  { name: "Arial", fallback: "Arimo, 'Liberation Sans', Helvetica, sans-serif", web: false, weights: W2 },
  { name: "Caveat", fallback: "cursive", web: true, weights: [400, 500, 600, 700] },
  { name: "Comfortaa", fallback: "sans-serif", web: true, weights: [300, 400, 500, 600, 700] },
  { name: "Comic Sans MS", fallback: "'Comic Neue', 'Comic Sans', cursive", web: false, weights: W2 },
  { name: "Courier New", fallback: "Cousine, 'Liberation Mono', monospace", web: false, weights: W2 },
  { name: "EB Garamond", fallback: "Garamond, serif", web: true, weights: [400, 500, 600, 700, 800] },
  { name: "Georgia", fallback: "Gelasio, serif", web: false, weights: W2 },
  { name: "Impact", fallback: "Anton, 'Arial Black', sans-serif", web: false, weights: [400] },
  { name: "Lexend", fallback: "sans-serif", web: true, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { name: "Lobster", fallback: "cursive", web: true, weights: [400] },
  { name: "Lora", fallback: "serif", web: true, weights: [400, 500, 600, 700] },
  { name: "Merriweather", fallback: "serif", web: true, weights: [300, 400, 500, 600, 700, 800, 900] },
  { name: "Montserrat", fallback: "sans-serif", web: true, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { name: "Nunito", fallback: "sans-serif", web: true, weights: [200, 300, 400, 500, 600, 700, 800, 900] },
  { name: "Oswald", fallback: "sans-serif", web: true, weights: [200, 300, 400, 500, 600, 700] },
  { name: "Pacifico", fallback: "cursive", web: true, weights: [400] },
  { name: "Playfair Display", fallback: "serif", web: true, weights: [400, 500, 600, 700, 800, 900] },
  { name: "Roboto", fallback: "sans-serif", web: true, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { name: "Roboto Mono", fallback: "monospace", web: true, weights: [100, 200, 300, 400, 500, 600, 700] },
  { name: "Roboto Serif", fallback: "serif", web: true, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { name: "Spectral", fallback: "serif", web: true, weights: [200, 300, 400, 500, 600, 700, 800] },
  { name: "Times New Roman", fallback: "Tinos, 'Liberation Serif', Times, serif", web: false, weights: W2 },
  { name: "Trebuchet MS", fallback: "'Fira Sans', sans-serif", web: false, weights: W2 },
  { name: "Verdana", fallback: "'DejaVu Sans', sans-serif", web: false, weights: W2 },
];

/** The weights by name, as the weight submenu lists them. */
export const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Normal",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

const BY_NAME = new Map(DOCS_FONTS.map((f) => [f.name.toLowerCase(), f]));

/** The generic family a Google Fonts category falls back to. */
export function categoryFallback(category: string): string {
  if (category === "serif") return "serif";
  if (category === "monospace") return "monospace";
  if (category === "handwriting") return "cursive";
  return "sans-serif";
}

// ── The reader's own fonts and the recent ones (this browser) ────────────

export type UserFont = { name: string; fallback: string; weights: number[] };

const MY_FONTS_KEY = "unitos-docs-my-fonts";
const RECENT_KEY = "unitos-docs-recent-fonts";
/** The font menu's RECENT section shows at most this many. */
const RECENT_MAX = 5;
const FONT_NAME = /^[\w\s'\-.]{1,80}$/;

function readList(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Private mode: the choice holds for this visit only.
  }
}

/** The fonts the reader added with More fonts. */
export function userFonts(): UserFont[] {
  return readList(MY_FONTS_KEY).flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const { name, fallback, weights } = v as Record<string, unknown>;
    if (typeof name !== "string" || !FONT_NAME.test(name)) return [];
    return [
      {
        name,
        fallback: typeof fallback === "string" && /^[a-z-]+$/.test(fallback) ? fallback : "sans-serif",
        weights: Array.isArray(weights) ? weights.filter((w): w is number => typeof w === "number" && w % 100 === 0) : W2,
      },
    ];
  });
}

export function setUserFonts(list: UserFont[]): void {
  writeList(MY_FONTS_KEY, list.slice(0, 200));
}

/** The recent fonts, most recent first. */
export function recentFonts(): string[] {
  return readList(RECENT_KEY)
    .filter((v): v is string => typeof v === "string" && FONT_NAME.test(v))
    .slice(0, RECENT_MAX);
}

/** A font picked from the menu moves to the front of RECENT. */
export function pushRecentFont(name: string): void {
  writeList(RECENT_KEY, [name, ...recentFonts().filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, RECENT_MAX));
}

/** The CSS stack for a stored face. */
export function fontStack(name: string): string {
  const clean = name.replace(/['"]/g, "");
  const quoted = /^[\w-]+$/.test(clean) ? clean : `'${clean}'`;
  const font = BY_NAME.get(clean.toLowerCase());
  if (font) return `${quoted}, ${font.fallback}`;
  if (typeof window !== "undefined") {
    const mine = userFonts().find((f) => f.name.toLowerCase() === clean.toLowerCase());
    if (mine) return `${quoted}, ${mine.fallback}`;
  }
  return `${quoted}, sans-serif`;
}

/** The first face of a CSS font-family value, unquoted. */
export function firstFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  return first || null;
}

/** The weights a face comes in: the menu's list, the reader's own, or
    regular and bold. */
export function fontWeights(name: string): number[] {
  const font = BY_NAME.get(name.toLowerCase());
  if (font) return font.weights;
  if (typeof window !== "undefined") {
    const mine = userFonts().find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (mine && mine.weights.length > 0) return mine.weights;
  }
  return W2;
}

function familyQuery(name: string, weights: number[], text?: string): string {
  const family = encodeURIComponent(name).replace(/%20/g, "+");
  const list = [...new Set(weights.length > 0 ? weights : W2)].sort((a, b) => a - b);
  const axis = `ital,wght@${[...list.map((w) => `0,${w}`), ...list.map((w) => `1,${w}`)].join(";")}`;
  return `family=${family}:${axis}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
}

/** The Google Fonts stylesheet for every web face the menu lists, the
    metric twins of the computer's faces, and the toolbar's own face. The
    browser downloads a face only when something on the page uses it. */
export function docsFontsUrl(): string {
  const faces = [
    ...DOCS_FONTS.filter((f) => f.web).map((f) => f.name),
    ...["Arimo", "Tinos", "Cousine", "Comic Neue", "Gelasio", "Anton", "Fira Sans"],
  ].map((f) => familyQuery(f, W2));
  return `https://fonts.googleapis.com/css2?${[...faces, "family=Google+Sans:wght@400;500"].join("&")}&display=swap`;
}

const loaded = new Set<string>();

/** Load a Google Fonts face that the font list at docsFontsUrl() leaves
    out (a font the reader added, or a weight past regular and bold).
    `preview` loads only the letters of its name, for a list that shows
    names in their faces. */
export function loadGoogleFont(name: string, weights: number[] = W2, preview = false): void {
  if (typeof document === "undefined" || !FONT_NAME.test(name)) return;
  const key = `${name}|${weights.join(",")}|${preview ? "p" : "f"}`;
  if (loaded.has(key)) return;
  loaded.add(key);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${familyQuery(name, preview ? [400] : weights, preview ? name : undefined)}&display=swap`;
  link.dataset.docsFont = name;
  document.head.appendChild(link);
}

/** Load a face the document uses when the default stylesheet leaves it out:
    a font the reader added, or a web face in a weight past regular and bold. */
export function loadFontInUse(name: string, weight?: number): void {
  const font = BY_NAME.get(name.toLowerCase());
  const mine = !font && userFonts().some((f) => f.name.toLowerCase() === name.toLowerCase());
  if (font ? !font.web || !weight || weight === 400 || weight === 700 : !mine) return;
  loadGoogleFont(font?.name ?? name, weight ? [400, 700, weight] : fontWeights(name));
}

const WEIGHTS = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]);

/** The font family mark with the fallback stack drawn around the stored
    face, and the face's weight (the weight submenu): a number from 100 to
    900 drawn through a variable, so a run's Bold still wins. */
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
          fontWeight: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const w = Number(element.getAttribute("data-font-weight"));
              return WEIGHTS.has(w) ? w : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.fontWeight === "number" && WEIGHTS.has(attributes.fontWeight)
                ? { "data-font-weight": String(attributes.fontWeight), style: `--docs-weight: ${attributes.fontWeight}` }
                : {},
          },
        },
      },
    ];
  },
});

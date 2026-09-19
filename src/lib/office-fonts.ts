// The fonts of slides and sheets (SPEC.md §27). A deck or a workbook names
// its typefaces; the reader's machine rarely has them all. Every typeface
// gets a web font: the metric-compatible stand-in for the Office and
// system fonts (Carlito for Calibri, Arimo for Arial, …), or the typeface
// itself when Google Fonts hosts it (Roboto, Lato, Montserrat, …). The
// declaration names the typeface first, so a machine that has it uses it,
// the stand-in second, a generic family last. Client-safe: the reader
// loads the fonts (components/reader/block-view.tsx), the server's picture
// render loads the same ones (lib/handwritten/slide-pictures.ts).

// Typeface (lowercase) → the Google Fonts family that stands in for it. An
// empty string: a symbol font with no stand-in worth loading.
const STAND_INS: Record<string, string> = {
  calibri: "Carlito",
  "calibri light": "Carlito",
  candara: "Carlito",
  corbel: "Carlito",
  cambria: "Caladea",
  constantia: "Caladea",
  arial: "Arimo",
  helvetica: "Arimo",
  "helvetica neue": "Arimo",
  "liberation sans": "Arimo",
  "arial black": "Archivo Black",
  "arial narrow": "Archivo Narrow",
  "times new roman": "Tinos",
  times: "Tinos",
  "liberation serif": "Tinos",
  "courier new": "Cousine",
  courier: "Cousine",
  "lucida console": "Cousine",
  georgia: "Gelasio",
  impact: "Anton",
  "comic sans ms": "Comic Neue",
  "trebuchet ms": "Fira Sans",
  verdana: "Open Sans",
  tahoma: "Open Sans",
  "segoe ui": "Open Sans",
  "segoe ui light": "Open Sans",
  aptos: "Inter",
  "century gothic": "Questrial",
  garamond: "EB Garamond",
  "book antiqua": "Crimson Pro",
  palatino: "Crimson Pro",
  "palatino linotype": "Crimson Pro",
  "gill sans": "Lato",
  "gill sans mt": "Lato",
  "lucida sans": "Lato",
  "lucida grande": "Lato",
  futura: "Jost",
  avenir: "Nunito Sans",
  "avenir next": "Nunito Sans",
  "franklin gothic": "Libre Franklin",
  "franklin gothic medium": "Libre Franklin",
  rockwell: "Zilla Slab",
  consolas: "Inconsolata",
  menlo: "Inconsolata",
  monaco: "Inconsolata",
  "bookman old style": "Libre Baskerville",
  baskerville: "Libre Baskerville",
  bahnschrift: "Barlow",
  "san francisco": "Inter",
  "sf pro": "Inter",
  "sf pro text": "Inter",
  "sf pro display": "Inter",
  "proxima nova": "Montserrat",
  "gotham": "Montserrat",
  "myriad pro": "PT Sans",
  "minion pro": "Crimson Pro",
  symbol: "",
  wingdings: "",
  "wingdings 2": "",
  "wingdings 3": "",
  webdings: "",
};

const SERIF_RX =
  /times|georgia|garamond|cambria|palatino|book antiqua|baskerville|didot|bodoni|playfair|merriweather|lora|serif|century|minion|constantia|charter|caslon|spectral|libre|crimson|noto serif|pt serif|source serif|cormorant|domine|vollkorn|bitter|caladea|tinos|gelasio|rockwell|zilla/i;
const MONO_RX = /courier|consolas|mono|menlo|monaco|code|inconsolata|fira code|lucida console|jetbrains|cousine/i;

/** The typeface as a key: lowercase, one space between words. */
function key(typeface: string): string {
  return typeface.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The Google Fonts family to load for a typeface: its stand-in, or the
    typeface itself (Google Fonts may host it; a family it does not host
    fails to load on its own and costs nothing). Null for a symbol font. */
export function webFontFamily(typeface: string): string | null {
  const k = key(typeface);
  if (!k) return null;
  if (k in STAND_INS) return STAND_INS[k] || null;
  return typeface.trim();
}

/** The generic family a typeface falls back to. */
export function genericFamily(typeface: string): string {
  return MONO_RX.test(typeface) ? "ui-monospace, monospace" : SERIF_RX.test(typeface) ? "serif" : "sans-serif";
}

/** A font-family declaration for the typeface: the typeface, its stand-in
    when it has one, the generic family. Single quotes: the declaration
    sits inside a double-quoted style attribute. The name is stripped of
    anything that could end the attribute or the declaration. */
export function fontFamilyDeclaration(typeface: string): string {
  const name = typeface.replace(/[;{}"'<>\\]/g, "").trim();
  if (!name) return "";
  const standIn = webFontFamily(name);
  const families = [name];
  if (standIn && standIn.toLowerCase() !== name.toLowerCase()) families.push(standIn);
  return `${families.map((f) => `'${f}'`).join(", ")}, ${genericFamily(name)}`;
}

/** The stylesheet URL that loads a family in regular, bold, italic, and
    bold italic. */
export function googleFontsUrl(family: string): string {
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
}

/** The typefaces a data-fonts attribute lists, one per family. */
export function parseFontList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split("|")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

/** The data-fonts attribute for a set of typefaces. */
export function fontListAttr(typefaces: Iterable<string>): string {
  return [...new Set([...typefaces].map((f) => f.replace(/[|"<>]/g, "").trim()).filter(Boolean))].join("|");
}

/** The web font families to load for the typefaces, each once. */
export function webFontFamilies(typefaces: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const typeface of typefaces) {
    const family = webFontFamily(typeface);
    if (family) out.add(family);
  }
  return [...out];
}

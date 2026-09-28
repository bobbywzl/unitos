// Glyphs and fonts: what a text item's string becomes (control characters
// dropped, radicals and spacing accents folded, a TeX math glyph read by its
// code) and what a font's name says (bold, italic, monospace, small caps,
// math, the TeX math family).

import type { Glyph } from "@/lib/parse/pdf/drawing";
import { mathGlyph } from "@/lib/parse/pdf/math-fonts";
import type { Flags } from "@/lib/parse/pdf/types";

export const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
// Some generators map common CJK glyphs to the Kangxi Radicals and CJK
// Radicals Supplement blocks (⼴州 for 广州): the glyph looks right and a
// search for the word finds nothing. NFKC folds the Kangxi block; the
// supplement has no decompositions, so a table covers its common members.
const RADICAL_RE = /[\u2E80-\u2FDF]/g;
const RADICAL_MAP: Record<string, string> = {
  "⺁": "厂", "⺄": "乙", "⺈": "刀", "⺊": "卜", "⺌": "小", "⺍": "小", "⺕": "彐", "⺗": "心",
  "⺘": "手", "⺙": "攴", "⺛": "无", "⺜": "日", "⺝": "月", "⺟": "母", "⺠": "民", "⺡": "水",
  "⺢": "水", "⺣": "火", "⺤": "爪", "⺥": "爪", "⺦": "爿", "⺧": "牛", "⺨": "犬", "⺩": "玉",
  "⺪": "疋", "⺫": "网", "⺬": "示", "⺭": "示", "⺮": "竹", "⺯": "糸", "⺰": "纟", "⺱": "网",
  "⺲": "网", "⺳": "网", "⺶": "羊", "⺷": "羊", "⺸": "羊", "⺹": "老", "⺺": "耒", "⺻": "聿",
  "⺼": "肉", "⺽": "臼", "⺾": "艸", "⺿": "艸", "⻀": "艸", "⻁": "虎", "⻂": "衣", "⻃": "西",
  "⻄": "西", "⻅": "见", "⻆": "角", "⻇": "角", "⻈": "讠", "⻉": "贝", "⻊": "足", "⻋": "车",
  "⻌": "辶", "⻍": "辶", "⻎": "辶", "⻏": "邑", "⻐": "钅", "⻑": "长", "⻒": "长", "⻓": "长",
  "⻔": "门", "⻕": "阜", "⻖": "阜", "⻗": "雨", "⻘": "青", "⻙": "韦", "⻚": "页", "⻛": "风",
  "⻜": "飞", "⻝": "食", "⻞": "食", "⻟": "饣", "⻠": "饣", "⻡": "首", "⻢": "马", "⻣": "骨",
  "⻤": "鬼", "⻥": "鱼", "⻦": "鸟", "⻧": "卤", "⻨": "麦", "⻩": "黄", "⻪": "黾", "⻫": "斉",
  "⻬": "齐", "⻭": "齿", "⻮": "齿", "⻯": "竜", "⻰": "龙", "⻱": "龟", "⻲": "龟", "⻳": "龟",
};
// What normalizeGlyphs changes; most strings hold none of it.
const NORMALIZED_RE = /[\u2E80-\u2FDF\u2012¨´`ˆ˜ˇ¸˚˝¯˘˙]/;
export function normalizeGlyphs(str: string): string {
  if (!NORMALIZED_RE.test(str)) return str;
  return str
    .replace(RADICAL_RE, (ch) => RADICAL_MAP[ch] ?? ch.normalize("NFKC"))
    .replace(/\u2012/g, "\u2013")
    .replace(/([¨´`ˆ˜ˇ¸˚˝¯˘˙])(\p{L})/gu, (_, accent: string, letter: string) =>
      (letter + SPACING_ACCENTS[accent]).normalize("NFC"),
    );
}
// A spacing accent drawn as its own glyph before the base letter (LaTeX's
// \"u): composed with the letter it overlaps.
export const SPACING_ACCENTS: Record<string, string> = {
  "¨": "\u0308", "´": "\u0301", "`": "\u0300", "ˆ": "\u0302", "^": "\u0302", "˜": "\u0303",
  "~": "\u0303", "ˇ": "\u030C", "¸": "\u0327", "˚": "\u030A", "˝": "\u030B", "¯": "\u0304",
  "˘": "\u0306", "˙": "\u0307",
};

// ── Font flags ──────────────────────────────────────────────────────────────

export type FontFlags = Omit<Flags, "href"> & { math: boolean };

export function fontFlags(name: string | null): FontFlags {
  const n = (name ?? "").replace(/^[A-Z]{6}\+/, ""); // subset prefix "HAAAAA+"
  const family = mathFamily(n);
  return {
    // Computer Modern (CMBX, CMTI, CMTT), Nimbus (-Medi, -ReguItal) and Latin
    // Modern names carry weight and shape in abbreviations, not words.
    bold: /bold|black|heavy|semi ?bold|demi|medi(?:ital|obli)?$|^CMBX|^CMB\d|^CMSSBX|^CMBSY|^LM(?:Roman|Sans|Mono)\d*-Bold/i.test(n),
    italic: /italic|oblique|ital$|obli$|^CMTI|^CMSL|^CMBXTI|^CMSSI|^CMITT|^CMSLTT|slanted/i.test(n),
    mono: /mono|courier|consolas|menlo|typewriter|^CMTT|^CMSLTT|^CMITT|cursor/i.test(n),
    // A small-caps font draws lowercase letters as small capitals; the text
    // layer gives them lowercase. Computer Modern's CMCSC, its T1 twins SFCC
    // and SFXC, Latin Modern's LMRomanCaps, and "-SC" or ".sc" names (the
    // owner's notes set 217 theorem labels in CMCSC10: they read as plain
    // words). "Caps" ends a word in the name: PTSans-Caption is no small caps,
    // and neither is NotoSansSC (Simplified Chinese).
    smallCaps: /^CMCSC|^SFCC|^SFXC|SmallCaps|Caps(?![a-z])|-SC$|\.sc$/i.test(n),
    // Math fonts by name: TeX's math families, the other TeX math fonts, an
    // OpenType math font ("Math" in its name), and Adobe's Symbol. The word
    // "Symbol" alone says nothing: Segoe UI Symbol draws the legal packet's
    // checkboxes, and its lines read as equations (census class 12).
    math: (family !== null && family !== "ot1") || /^(stmary|wasy)|Math|^Symbol(MT)?$/i.test(n),
  };
}

// ── Math families ───────────────────────────────────────────────────────────
// TeX's math fonts keep one layout of character codes per family, whatever
// the size or the producer: the code names the symbol (math-fonts.ts). The
// family comes from the font's name. OT1 is Computer Modern's text layout,
// which math uses for digits, + = ( ), and upright Greek capitals; the
// typewriter and small-caps fonts change some of its codes, so they are not
// in it, and neither is Latin Modern, whose codes follow the PDF's encoding.

export type MathFamily = "oml" | "oms" | "omx" | "msa" | "msb" | "euf" | "rsfs" | "lasy" | "esint" | "ot1";

const FAMILIES: [RegExp, MathFamily][] = [
  [/^(CMMIB?\d|LMMathItalic)/i, "oml"],
  [/^(CMB?SY\d|LMMathSymbols)/i, "oms"],
  [/^(CMEX\d|LMMathExtension)/i, "omx"],
  [/^MSAM\d/i, "msa"],
  [/^MSBM\d/i, "msb"],
  [/^EUF[MB]\d/i, "euf"],
  [/^RSFS\d/i, "rsfs"],
  [/^LASYB?\d/i, "lasy"],
  [/^ESINT\d/i, "esint"],
  [/^CM(R|BX|TI|SS|SSBX|SSI|SL|BXTI)\d/i, "ot1"],
];

// The family of a font by its name, the subset prefix removed ("CMMI10").
export function mathFamily(base: string): MathFamily | null {
  for (const [re, family] of FAMILIES) if (re.test(base)) return family;
  return null;
}

// A big operator or a radical: its glyph hangs from its origin, so a line
// places it by its center (lines.ts). The integrals after ∐ are esint's.
export const OPERATOR_GLYPH_RE = /^[∫∑∏⋃⋂⊎⋀⋁√⨄⨆⨀⨁⨂∮∐∬∭⨌∯⨖∳∲⨏]$/;

// The characters of a text, spaces aside, each counted once: a math letter
// past the Basic Multilingual Plane (𝒜, 𝔼) is two UTF-16 units, and counted
// by units it doubled a line's math share (a proof's last line read as an
// equation).
const SPACE_OR_PAIR_RE = /[\s\uD800-\uDBFF]/; // a text with neither counts its units
export function charCount(text: string): number {
  if (!SPACE_OR_PAIR_RE.test(text)) return text.length;
  const units = text.replace(/\s/g, "");
  return units.length - (units.match(/[\uD800-\uDBFF]/g)?.length ?? 0);
}

// ── Math glyphs by code ─────────────────────────────────────────────────────
// A TeX math glyph reads as its code names it, whatever the text layer says
// (P0-F memo §1.2: on the owner's notes 27 ϵ were lost, 42 ℓ read as a
// backtick, 46 ↦ as "7→", 15 ≠ as "6=", and the big brackets as ⋃ and ⊎).
// TeX builds some symbols from two glyphs: they fuse into one character on
// the glyph that starts the symbol (memo §1.5, Appendix B), and a math
// accent joins the letter under it.

// A tall delimiter or radical is drawn in pieces: one of them reads as the
// delimiter, the others as nothing.
const PIECE_TEXT: Record<string, string> = {
  "lparen-top": "(",
  "rparen-top": ")",
  "lbrack-top": "[",
  "rbrack-top": "]",
  "lbrace-top": "{",
  "rbrace-top": "}",
  "radical-bot": "√",
};
type Code = [MathFamily, number];
const is = (g: Glyph, [family, code]: Code) => g.family === family && g.code === code;
// b on a's baseline (a twentieth of a's size), and at a's x too (an eighth).
const level = (a: Glyph, b: Glyph) => Math.abs(b.y - a.y) < a.size * 0.05;
const at = (a: Glyph, b: Glyph) => level(a, b) && Math.abs(b.x - a.x) < a.size * 0.12;
// Two glyphs TeX joins with a small overlap (\joinrel, 3mu) that are no
// arrow: \models, \bowtie.
const JOINED: [Code, Code, string][] = [
  [["oms", 0x6a], ["ot1", 0x3d], "⊨"],
  [["oml", 0x2e], ["oml", 0x2f], "⋈"],
];
// The pieces of a long arrow: a shaft (a minus, an equals sign — from a text
// font where Latin Modern sets it) and the heads and hooks. TeX overlaps
// them 3mu (\longrightarrow, \implies) or 7mu (\xleftarrow's fill).
type ArrowPiece = "shaft" | "left" | "right" | "Left" | "Right" | "lhook" | "rhook";
function arrowPiece(g: Glyph): ArrowPiece | null {
  if (is(g, ["oms", 0x00]) || is(g, ["ot1", 0x3d]) || (g.family === null && g.unicode === "=")) return "shaft";
  if (is(g, ["oms", 0x20])) return "left";
  if (is(g, ["oms", 0x21])) return "right";
  if (is(g, ["oms", 0x28])) return "Left";
  if (is(g, ["oms", 0x29])) return "Right";
  if (is(g, ["oml", 0x2c])) return "lhook";
  if (is(g, ["oml", 0x2d])) return "rhook";
  return null;
}
// The arrow a run of pieces draws, by its heads; null when it has none.
function arrowOf(pieces: ArrowPiece[]): string | null {
  const has = (p: ArrowPiece) => pieces.includes(p);
  if (has("lhook") && has("right")) return "↪";
  if (has("rhook") && has("left")) return "↩";
  if (has("Left") || has("Right")) return has("Left") && has("Right") ? "⟺" : has("Left") ? "⟸" : "⟹";
  if (has("left") || has("right")) return has("left") && has("right") ? "⟷" : has("left") ? "⟵" : "⟶";
  return null;
}

// The text of the page's glyphs where it is not the text layer's: every glyph
// of a math family, and the glyphs of a composite or an accented letter. A
// glyph that reads as nothing (a composite's second glyph, a placed accent)
// maps to "".
export function glyphTexts(glyphs: Glyph[]): Map<Glyph, string> {
  const texts = new Map<Glyph, string>();
  for (const g of glyphs) {
    if (g.family === null || g.family === "ot1") continue;
    const entry = mathGlyph(g.family, g.code);
    if (!entry) texts.set(g, g.unicode.replace(CONTROL_CHARS_RE, ""));
    else texts.set(g, entry.cls === "piece" ? (PIECE_TEXT[entry.piece ?? ""] ?? "") : entry.unicode);
  }
  const textOf = (g: Glyph) => texts.get(g) ?? g.unicode;
  const entryOf = (g: Glyph) => (g.family === null ? null : mathGlyph(g.family, g.code));
  // Glyphs by baseline, 4 pt a bucket: a composite's glyphs sit within an em.
  // Built at the first question: most pages of prose never ask one.
  let buckets: Map<number, Glyph[]> | null = null;
  const around = (g: Glyph): Glyph[] => {
    if (!buckets) {
      buckets = new Map();
      for (const other of glyphs) {
        const key = Math.floor(other.y / 4);
        const list = buckets.get(key);
        if (list) list.push(other);
        else buckets.set(key, [other]);
      }
    }
    const out: Glyph[] = [];
    const reach = g.size * 1.3;
    for (let key = Math.floor((g.y - reach) / 4); key <= Math.floor((g.y + reach) / 4); key++) {
      for (const other of buckets.get(key) ?? []) if (other !== g) out.push(other);
    }
    return out;
  };
  const consumed = new Set<Glyph>();
  const inArrow = new Set<Glyph>();
  const fuse = (first: Glyph, text: string, rest: Glyph[]) => {
    texts.set(first, text);
    for (const g of rest) {
      texts.set(g, "");
      consumed.add(g);
    }
  };
  const overlap = (a: Glyph, b: Glyph) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const center = (g: Glyph) => g.x + g.w / 2;
  // A tall bar (\Big|, \left\|) is one piece repeated down a column: the
  // lowest piece reads as the bar, the ones above it as nothing.
  for (const a of glyphs) {
    if (entryOf(a)?.piece !== "vrep") continue;
    const below = around(a).some(
      (b) => b.family === a.family && b.code === a.code && Math.abs(b.x - a.x) < a.size * 0.05 && a.y - b.y > 0 && a.y - b.y < a.size * 0.65,
    );
    if (below) texts.set(a, "");
  }
  for (const a of glyphs) {
    // A glyph of no math family takes part only as an arrow's shaft ("=").
    if (a.family === null && a.unicode !== "=") continue;
    const em = a.size;
    const entry = entryOf(a);
    if (entry?.piece === "not") {
      // \not: the slash over the relation at its x (≠ ∉ ≢ ⊄).
      const rel = around(a).find((b) => at(a, b) && entryOf(b)?.cls === "rel" && !consumed.has(b));
      if (rel) fuse(rel, (textOf(rel) + "\u0338").normalize("NFC"), [a]);
    } else if (is(a, ["oml", 0x3d])) {
      // \notin: the math slash drawn through ∈.
      const element = around(a).find((b) => level(a, b) && is(b, ["oms", 0x32]) && center(a) > b.x && center(a) < b.x + b.w);
      if (element) fuse(element, "∉", [a]);
    } else if (entry?.piece === "mapstochar") {
      // \mapsto: the bar at the arrow's x; \longmapsto: the bar, a minus,
      // and the arrow joined to it.
      const near = around(a);
      const arrow = near.find((b) => at(a, b) && is(b, ["oms", 0x21]));
      const minus = near.find((b) => at(a, b) && is(b, ["oms", 0x00]));
      const long = minus && near.find((b) => level(a, b) && is(b, ["oms", 0x21]) && b.x > minus.x && overlap(minus, b) > em * 0.05);
      if (arrow) fuse(a, "↦", [arrow]);
      else if (minus && long) fuse(a, "⟼", [minus, long]);
    } else if (is(a, ["msa", 0x4b]) || is(a, ["msa", 0x4c])) {
      // \dashrightarrow and \dashleftarrow: dash pieces abutting an arrowhead.
      const right = is(a, ["msa", 0x4b]);
      const dashes: Glyph[] = [];
      let edge = right ? a.x : a.x + a.w;
      for (;;) {
        const dash = around(a).find(
          (b) => level(a, b) && is(b, ["msa", 0x39]) && !dashes.includes(b) && Math.abs((right ? b.x + b.w : b.x) - edge) < em * 0.05,
        );
        if (!dash) break;
        dashes.push(dash);
        edge = right ? dash.x : dash.x + dash.w;
      }
      if (dashes.length > 0) fuse(right ? dashes[dashes.length - 1] : a, right ? "⇢" : "⇠", right ? [...dashes.slice(0, -1), a] : dashes);
    } else if (is(a, ["oms", 0x18]) || is(a, ["oml", 0x3a])) {
      // \cong: ∼ over =; \doteq: a dot over =.
      const cong = is(a, ["oms", 0x18]);
      const equals = around(a).find((b) => {
        const rise = (a.y - b.y) / em;
        return (
          is(b, ["ot1", 0x3d]) &&
          (cong ? Math.abs(b.x - a.x) < em * 0.12 && rise > 0.15 && rise < 0.45 : center(a) > b.x && center(a) < b.x + b.w && rise > 0.4 && rise < 0.75)
        );
      });
      if (equals) fuse(equals, cong ? "≅" : "≐", [a]);
    }
    for (const [left, right, text] of JOINED) {
      if (!is(a, left) || consumed.has(a)) continue;
      const b = around(a).find(
        (g) => level(a, g) && is(g, right) && !consumed.has(g) && g.x > a.x && overlap(a, g) > em * 0.08 && overlap(a, g) < em * 0.3,
      );
      if (b) fuse(a, text, [b]);
    }
    // A long arrow: pieces on one baseline that overlap, one after another —
    // \implies overlaps "=" and "⇒" by 3mu, \xrightarrow draws its minus
    // under the arrow (arXiv 2506.06752: 14 \implies read "=⇒"; 2410.04586's
    // \xleftarrow "←−−−−−−−−"). The arrow sits on the run's leftmost piece.
    if (arrowPiece(a) && !consumed.has(a) && !inArrow.has(a)) {
      const run = [a];
      for (let k = 0; k < run.length; k++) {
        const p = run[k];
        for (const q of around(p)) {
          if (run.includes(q) || consumed.has(q) || !arrowPiece(q) || Math.abs(q.y - a.y) >= em * 0.05) continue;
          if (overlap(p, q) > em * 0.05) run.push(q);
        }
      }
      for (const g of run) inArrow.add(g);
      const arrow = run.length > 1 ? arrowOf(run.map((g) => arrowPiece(g)!)) : null;
      if (arrow) {
        const first = run.reduce((l, g) => (g.x < l.x - 0.01 ? g : l));
        fuse(first, arrow, run.filter((g) => g !== first));
      }
    }
  }
  // A math accent (\vec, \widehat, \widetilde) joins the glyph under its
  // center: the nearest one at or below its baseline (the census found a
  // wide hat over Ω on the last letter of the word before it). A text font's
  // accent (\hat from OT1) does the same over a math letter; over a text
  // letter it is the text layer's (lines.ts composeAccents).
  for (const a of glyphs) {
    const entry = entryOf(a);
    if (entry?.cls !== "accent" || !/\p{M}/u.test(entry.unicode)) continue;
    let base: Glyph | null = null;
    for (const b of around(a)) {
      const rise = a.y - b.y;
      if (rise < -a.size * 0.1 || center(a) < b.x || center(a) > b.x + b.w) continue;
      if (a.family === "ot1" && rise > a.size * 0.6) continue;
      if (textOf(b) === "" || entryOf(b)?.cls === "accent" || /^\s*$/.test(textOf(b))) continue;
      if (!base || rise < a.y - base.y) base = b;
    }
    if (a.family === "ot1" && (base === null || base.family === null || base.family === "ot1")) continue;
    if (base) texts.set(base, (textOf(base) + entry.unicode).normalize("NFC"));
    texts.set(a, "");
  }
  return texts;
}

// An item's text from its glyphs: each glyph's text, and a space where a
// glyph starts a tenth of an em or more after the one before it ends —
// pdf.js's own rule for a space inside an item. Glyphs that read as nothing
// leave the item's box. Null when every glyph reads as nothing. Each glyph
// keeps what it adds (Glyph.text), so a formula can end inside the item.
export function itemText(glyphs: Glyph[], texts: Map<Glyph, string>): { str: string; x: number; w: number } | null {
  let str = "";
  let x = 0;
  let end = 0;
  let prevEnd: number | null = null;
  for (const g of glyphs) {
    // pdf.js spells out a ligature (ﬁ → fi) in its text layer.
    const text = (texts.get(g) ?? g.unicode.replace(/[ﬀ-ﬆ]/g, (c) => c.normalize("NFKC"))).replace(
      CONTROL_CHARS_RE,
      "",
    );
    g.text = text;
    if (text !== "") {
      if (str === "") x = g.x;
      else if (prevEnd !== null && g.x - prevEnd >= g.size * 0.102) str += " ";
      str += text;
      end = Math.max(end, g.x + g.w);
    }
    prevEnd = g.x + g.w;
  }
  return str === "" ? null : { str, x, w: end - x };
}

// Math glyphs the text layer never read — pdf.js drops a code it reads as a
// space: ⊖ ⊘ ⊙ in a CMSY font with no Unicode map, and in the extension
// font \big⟨ (code 10, a line feed), \Bigg( (code 32), and the pieces of a
// tall bar — in runs of one font on one baseline, each run an item of its
// own. A glyph that hangs from its origin (the extension font's, esint's)
// counts only when the text layer read its code as a space: no item holds
// it.
export function unreadRuns(glyphs: Glyph[], read: Set<Glyph>, texts: Map<Glyph, string>): Glyph[][] {
  const runs: Glyph[][] = [];
  let run: Glyph[] = [];
  for (const g of glyphs) {
    const unread =
      g.family !== null &&
      g.family !== "ot1" &&
      ((g.family !== "omx" && g.family !== "esint") || g.unicode.trim() === "") &&
      !read.has(g) &&
      (texts.get(g) ?? "") !== "";
    const last = run[run.length - 1];
    if (unread && last && g.font === last.font && Math.abs(g.y - last.y) < 0.01 && g.x >= last.x && g.x - (last.x + last.w) < g.size * 0.6) {
      run.push(g);
      continue;
    }
    if (run.length > 0) {
      runs.push(run);
      run = [];
    }
    if (unread) run = [g];
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

// The baseline a sized delimiter of the extension font stands on (\big( to
// \Bigg(, a tall bar). TeX centers a delimiter on the math axis, a quarter
// em over the baseline, and the glyph hangs from its origin: placed by its
// origin, a \big⟨ made a line of its own and broke its equation (arXiv
// 2502.02648). A tall bar is one piece repeated up a column from its lowest
// piece, centered as a whole. Any other glyph keeps its origin: lines.ts
// places a big operator or a radical by its center.
const AXIS_HEIGHT = 0.25;
export function standingBaseline(g: Glyph, glyphs: Glyph[]): number {
  const entry = g.family === "omx" ? mathGlyph("omx", g.code) : null;
  if (!entry || (entry.size === undefined && entry.piece !== "vrep") || entry.cls === "radical") return g.y;
  let top = g;
  while (entry.piece === "vrep") {
    const under = top;
    const above = glyphs.find(
      (b) => b.family === g.family && b.code === g.code && Math.abs(b.x - g.x) < g.size * 0.05 && b.y - under.y > 0 && b.y - under.y < g.size * 0.65,
    );
    if (!above) break;
    top = above;
  }
  const high = top.y + entry.box[0] * g.size;
  const low = g.y - entry.box[1] * g.size;
  return (high + low) / 2 - AXIS_HEIGHT * g.size;
}

export function sameFlags(a: Flags, b: Flags): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.mono === b.mono &&
    a.smallCaps === b.smallCaps &&
    a.href === b.href &&
    Boolean(a.sup) === Boolean(b.sup) &&
    Boolean(a.sub) === Boolean(b.sub) &&
    a.zone === b.zone
  );
}

// Lines joined into text: wraps, line breaks, line-end hyphens, and the style
// runs (bold, italic, monospace, links) that become a block's style and link
// spans.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import nspell from "nspell";
import type { PageDrawing, Rule } from "@/lib/parse/pdf/drawing";
import { median } from "@/lib/parse/pdf/geometry";
import { sameFlags } from "@/lib/parse/pdf/glyphs";
import type { Box, Line, Run, Segment } from "@/lib/parse/pdf/types";
import type { LinkSpan, StyleSpan, TabStop, TextFont } from "@/lib/parse/types";

const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]/u;

// ── Line-end hyphens ────────────────────────────────────────────────────────

// A hyphen at a line end is the typesetter's ("prob-" + "ability") or a
// compound's ("self-" + "directed"), and the document's own words decide:
// the compound written inside a line keeps it, the joined word written
// elsewhere drops it. Then the parts: two words the document writes on
// their own make a compound ("high-" + "potency"), two it never writes are
// a word's syllables ("errone-" + "ously"). Between the two the producer
// decides: TeX and InDesign break words, so most of their line ends join
// into words written elsewhere; Word and Google Docs break none.
const hyphenation = { words: new Set<string>(), compounds: new Set<string>(), breaksWords: false };
// A word and a hyphen closing a text, a word opening one, and the words and
// compounds inside it. Made once: every line of a book is read.
const WORD_HYPHEN_END_RE = /(\p{L}+)-$/u;
const LOWER_WORD_START_RE = /^(\p{Ll}+)/u;
const LETTER_HYPHEN_END_RE = /\p{L}-$/u;
const WORDS_RE = /\p{L}+/gu;
const COMPOUNDS_RE = /(\p{L}+)-(\p{L}+)/gu;

// Reads every page's words, compounds, and line ends. parsePdf calls it
// before any page is segmented: the joins read it.
export function collectHyphenation(pages: Line[][]) {
  const words = new Set<string>();
  const compounds = new Set<string>();
  const ends: string[] = [];
  for (const lines of pages) {
    lines.forEach((line, i) => {
      const text = line.text.trim();
      const left = WORD_HYPHEN_END_RE.exec(text);
      const right = LOWER_WORD_START_RE.exec(lines[i + 1]?.text.trim() ?? "");
      if (left && right) ends.push((left[1] + right[1]).toLowerCase());
      // A line's words, less the parts of a word it breaks: "dissent-" and
      // "ing" twice in a document made "ing" a word. A line that opens
      // lowercase may finish a word cut on another line: the line before it
      // in reading order is not always the one above it (a column's first
      // line after a float: "ac-" | "cessible").
      const found = [...text.matchAll(WORDS_RE)];
      const cut = LOWER_WORD_START_RE.test(text) || (i > 0 && LETTER_HYPHEN_END_RE.test(lines[i - 1].text.trim()));
      found.forEach((m, k) => {
        if (!(k === 0 && cut) && !(k === found.length - 1 && left)) words.add(m[0].toLowerCase());
      });
      for (const m of text.matchAll(COMPOUNDS_RE)) {
        if (m.index + m[0].length < text.length) compounds.add(`${m[1]}-${m[2]}`.toLowerCase());
      }
    });
  }
  const joined = ends.filter((w) => words.has(w)).length;
  hyphenation.words = words;
  hyphenation.compounds = compounds;
  hyphenation.breaksWords = joined >= 2 && joined * 5 >= ends.length;
}

// The page editor's English dictionary (public/spelling, Hunspell), read once
// on first use; null where it cannot be read.
let dictionary: ReturnType<typeof nspell> | null | undefined;
function spelling(): ReturnType<typeof nspell> | null {
  if (dictionary === undefined) {
    try {
      const file = (name: string) => readFileSync(join(process.cwd(), "public", "spelling", name), "utf8");
      dictionary = nspell(file("en.aff"), file("en.dic"));
    } catch {
      dictionary = null;
    }
  }
  return dictionary;
}

// Prefixes the dictionary lists as words of their own ("sub", "micro"): a
// break after one splits a word more often than a compound ("sub-" |
// "tasks"). Suffixes a break sets apart ("contextual-" | "ism").
const PREFIX_RE = /^(?:sub|super|supra|micro|macro|nano|hyper|hypo|bio|semi|multi|poly|mono|uni|bi|tri|anti|non|pre|post|pro|re|un|de|dis|mis|co|con|inter|intra|trans|pseudo|meta|para|auto|neo|proto|ultra|extra|infra|over|under|out|counter|mid|photo|electro|thermo|geo|astro|tele)$/;
const SUFFIX_RE = /^(?:isms?|ists?|ness|ments?|ships?|hoods?|ity|ities|i[sz]e[sd]?|able|ible|ful|less|ly)$/;

// What a line-end hyphen between two texts is: "drop" for the typesetter's,
// "keep" for a compound's, null when the first text ends in no hyphen after
// a word or the second starts with no letter ("COVID-" then "19"). The
// document's own words decide first, then the dictionary: a word it knows
// was split ("be-" | "cause"), and two words it knows that join into none
// it knows are a compound ("cross-" | "entropy", "time-" | "consuming").
export function lineEndHyphen(before: string, after: string): "drop" | "keep" | null {
  const left = WORD_HYPHEN_END_RE.exec(before.trimEnd());
  const right = /^(\p{L}+)/u.exec(after.trimStart());
  if (!left || !right) return null;
  // A link wraps at its own hyphens ("…/nizoral-ketoconazole-").
  if (/(?:https?:\/\/|www\.)\S*$/.test(before)) return "keep";
  const [l, r] = [left[1].toLowerCase(), right[1].toLowerCase()];
  // A document that writes both "world-model" and "worldmodel" keeps the
  // hyphen: the compound inside a line is the stronger witness.
  if (hyphenation.compounds.has(`${l}-${r}`)) return "keep";
  if (hyphenation.words.has(l + r)) return "drop";
  // An acronym ("AAR-" / "generated") or a name ("Anglo-" / "Saxon") joins
  // as a compound; so does "σ-" / "algebra", below TeX's two letters
  // before a break and three after it.
  if (/^\p{Lu}{2,}$/u.test(left[1]) || /^\p{Lu}/u.test(right[1]) || l.length < 2 || r.length < 3) return "keep";
  const known = spelling();
  if (known?.correct(l + r)) return "drop";
  // A name split in two ("Rout-" | "ledge", "Wolf-" | "gang") is no
  // compound of the words its halves spell.
  if (known && /^\p{Ll}/u.test(left[1]) && !PREFIX_RE.test(l) && !SUFFIX_RE.test(r) && known.correct(l) && known.correct(r)) return "keep";
  const [lw, rw] = [hyphenation.words.has(l), hyphenation.words.has(r)];
  if (lw && rw) return "keep";
  if (!lw && !rw) return "drop";
  return hyphenation.breaksWords ? "drop" : "keep";
}

// Joins the second part of a paragraph cut by a page break or a float to
// its first: the typesetter's hyphen goes, a compound's stays, Chinese and
// Japanese join with no space ("日本語質問" | "応答の…"), and a space
// separates words otherwise. Returns where the second part starts.
export function joinWrapped(target: { text: string; runs?: Run[] }, next: string): number {
  const hyphen = lineEndHyphen(target.text, next);
  if (hyphen === "drop") {
    target.text = target.text.slice(0, -1);
    const cut = target.text.length;
    target.runs = target.runs?.map((r) => ({ ...r, end: Math.min(r.end, cut) })).filter((r) => r.end > r.start);
  }
  const cjk = CJK_CHAR_RE.test(target.text.slice(-1)) && CJK_CHAR_RE.test(next[0] ?? "");
  const glue = hyphen !== null || cjk || (/[\p{L}\p{N}][-–]$/u.test(target.text) && /^[\p{L}\p{N}(]/u.test(next)) ? "" : " ";
  const offset = target.text.length + glue.length;
  target.text = target.text + glue + next;
  return offset;
}

// ── Links that wrap ─────────────────────────────────────────────────────────

/** A URL a text ends in: from "http(s)://" or "www." to its end. */
const URL_END_RE = /(?:https?:\/\/|www\.)\S*$/;
/** A URL a text opens with: a word of its own after a path or a URL
    ("…/25/06" then "https://doi.org/…" in an ACM paper's front matter). */
const URL_START_RE = /^(?:https?:\/\/|www\.)/;
/** A URL's last character that a wrap leaves at a line's end with the URL
    going on: a path's slash, a hyphen, a query's "=" or "&". */
const URL_OPEN_RE = /[/\-_=&?#%]$/;
/** A first word that reads as the rest of a URL: a path, a query, a dot
    between letters or digits, or letters and digits mixed ("k3AzU"). */
const URL_REST_RE = /[/?=&%#_~]|[\p{L}\p{N}]\.[\p{L}\p{N}]|\p{L}\p{N}|\p{N}\p{L}/u;

/** Whether a URL that ends a text goes on in the next line's first word;
    null when the text ends in no URL. The link's address is the strongest
    witness: the address on either side holds the words on both sides of
    the wrap, or the next line's first word is no part of the link. With no
    link, the URL goes on when it ends open (a slash, a hyphen) or the next
    word reads as a URL's rest. A long link read a space at each wrap after
    its first line ("…choices/ whats-medicare", a Google Docs export's
    links), and a URL at a line's end glued the next line's word
    ("…dt09_147.asp(accessed", "…charter.pdf2. CDC."). */
function urlGoesOn(text: string, href: string | null, next: string, nextHref: string | null): boolean | null {
  const url = URL_END_RE.exec(text.slice(-2000))?.[0];
  if (!url) return null;
  const head = (next.trimStart().split(/\s/, 1)[0] ?? "").replace(/[.,;:)\]]+$/, "");
  if (!head) return false;
  const joined = (url.slice(-16) + head.slice(0, 16)).toLowerCase();
  // A scheme alone ("https://" then "www.…") goes on whatever the next word.
  if ([href, nextHref].some((link) => link?.toLowerCase().includes(joined)) || /^(?:https?:\/\/|www\.)$/.test(url)) return true;
  if ((href && nextHref !== href) || URL_START_RE.test(head)) return false;
  return URL_OPEN_RE.test(url) || URL_REST_RE.test(head);
}

// ── Text assembly across lines ──────────────────────────────────────────────

// Joins line texts while shifting style runs. A wrap hyphen stays a hyphen:
// office-suite PDFs wrap after real compound hyphens ("AI-", "non-"), they do
// not auto-hyphenate words, so dropping the hyphen mangles compounds.
export class TextBuilder {
  text = "";
  runs: Run[] = [];

  dropTrailingChar() {
    if (this.text.length === 0) return;
    this.text = this.text.slice(0, -1);
    const cut = this.text.length;
    this.runs = this.runs.map((r) => ({ ...r, end: Math.min(r.end, cut) })).filter((r) => r.end > r.start);
  }

  append(part: { text: string; runs: Run[] }, sep: " " | "\n" | "") {
    if (this.text.length === 0) {
      this.text = part.text;
      this.runs = part.runs.map((r) => ({ ...r }));
      return;
    }
    let s: string = sep;
    // A kept wrap hyphen joins its compound without a space: "σ-" and
    // "algebra" made "σ- algebra" while the test knew only ASCII letters.
    if (sep === " " && /[\p{L}\p{N}][-–]$/u.test(this.text) && /^[\p{L}\p{N}(]/u.test(part.text)) s = "";
    const offset = this.text.length + s.length;
    this.text += s + part.text;
    for (const r of part.runs) {
      const shifted = { ...r, start: r.start + offset, end: r.end + offset };
      const last = this.runs[this.runs.length - 1];
      if (
        last &&
        sameFlags(last, shifted) &&
        !last.tab &&
        !shifted.tab &&
        shifted.start - last.end <= s.length &&
        s !== "\n"
      ) {
        last.end = shifted.end;
      } else {
        this.runs.push(shifted);
      }
    }
  }
}

// The tab between cells is the TABLE separator; in a paragraph, heading, or
// list a gap between cells reads as a space, or as a tab where the page
// sets one (withTabs).
export function lineAsPart(line: Line): { text: string; runs: Run[] } {
  const place = line.display ? undefined : tabPlaces.get(line);
  return (place && withTabs(line, place)) ?? { text: line.text.replace(/\t/g, " "), runs: line.runs };
}

/** Where the pull quote a line is set beside stands (Item.around): "right"
    when the line's measure ends at it, "left" when the line's measure
    starts past it, null when the line stands beside none. */
export function quoteSide(line: Line): "left" | "right" | null {
  const box = line.items.find((i) => i.around)?.around;
  if (!box) return null;
  if (box.x1 >= line.xEnd - 1) return "right";
  return box.x2 <= line.x + 1 ? "left" : null;
}

// Would the next line's first word have fit on this line? If yes, the break
// was intentional — keep it as a line break instead of a joining space.
export function fillsMargin(line: Line, next: Line, rightEdge: number): boolean {
  return line.xEnd + line.size * 0.28 + next.firstWordWidth > rightEdge - 1;
}

// A field row starts with a short bold label ("Written", "Status") followed by
// regular text. Two or more of them in one group means the group is a field
// list: every line keeps its own row. A bold run that continues from the
// previous line is a wrapped span, not a label.
export function startsWithBoldLead(line: Line): boolean {
  const first = line.runs[0];
  if (!first || !first.bold || first.start > 0) return false;
  if (first.end >= line.text.length) return false; // wholly bold line
  const lead = line.text.slice(first.start, first.end);
  return lead.length <= 40 && /^[A-Z0-9]/.test(lead);
}

export function endsBold(line: Line): boolean {
  const last = line.runs[line.runs.length - 1];
  return last !== undefined && last.bold && last.end >= line.text.trimEnd().length;
}

// Join a group of lines into one text: spaces where the text wrapped, line
// breaks where the break was intentional. In prose (proseJoin), a break that
// lands mid-sentence — no terminal punctuation before it, lowercase or a
// number after it — is a wrap whatever the margin says, unless the line's
// room to its paragraph's column edge (columnEdge, of a paragraph set flush
// left) would have taken the next word with three ems to spare and the
// line ends in no hyphen (a verse or a quotation pasted with its own line
// breaks: "…and the river ran" | "down to the sea…"); and so is a break
// before a capital when the line's room would not have taken the next word
// with an em to spare (the Federal Register's justified columns, whose word
// gaps the text layer leaves out: "in which the" | "Hearing Clerk").
export function joinGroup(lines: Line[], proseJoin = false, columnEdge = 0): { text: string; runs: Run[] } {
  const builder = new TextBuilder();
  if (lines.length === 0) return builder;
  const rightEdge = Math.max(...lines.map((l) => l.xEnd));
  const boldLeads = lines.filter(
    (l, i) => startsWithBoldLead(l) && (i === 0 || !endsBold(lines[i - 1])),
  ).length;
  const fieldList = boldLeads >= 2 && boldLeads >= Math.ceil(lines.length * 0.6);
  builder.append(lineAsPart(lines[0]), "");
  for (let i = 1; i < lines.length; i++) {
    const prevText = lines[i - 1].text.trim();
    const nextText = lines[i].text;
    const wrapped = fillsMargin(lines[i - 1], lines[i], rightEdge);
    // A line set beside a pull quote right of it ends at the quote: no room.
    const quoted = quoteSide(lines[i - 1]) === "right";
    const roomy = !quoted && lines[i - 1].xEnd + lines[i - 1].size * 1.28 + lines[i].firstWordWidth < rightEdge;
    const typed =
      !quoted &&
      columnEdge > 0 &&
      !/[\p{L}\p{N}][-‐]$/u.test(prevText) &&
      lines[i - 1].xEnd + lines[i - 1].size * 3 + lines[i].firstWordWidth < Math.max(rightEdge, columnEdge);
    // A formula opening the next line, under a line that ends in a
    // lowercase word, goes on the sentence as a lowercase word does (parse
    // loop finding: the MML book's "… it holds that" | "θMAP = mN." in a
    // margin note, p. 313). A label's line ("Bemerkung 13") and a formula's
    // step ("… ⊆ U" | "⇒ …") end in no such word.
    const opensFormula =
      /\p{Ll}$/u.test(prevText) &&
      (lines[i].items.find((it) => it.str.trim() !== "")?.math ?? false) &&
      !(lines[i - 1].items.findLast((it) => it.str.trim() !== "")?.math ?? true);
    const midSentence =
      proseJoin &&
      !/[.!?:…。！？：]["'”]?$/.test(prevText) &&
      (((/^[a-z0-9($€£"'“]/.test(nextText) || opensFormula) && !typed) || CJK_CHAR_RE.test(nextText[0] ?? "") || !roomy);
    let sep: " " | "\n" | "" = fieldList ? "\n" : wrapped || midSentence ? " " : "\n";
    if (sep === " ") {
      const lastChar = prevText[prevText.length - 1] ?? "";
      const firstChar = nextText[0] ?? "";
      const url = urlGoesOn(builder.text, builder.runs.at(-1)?.href ?? null, nextText, lines[i].runs[0]?.href ?? null);
      // CJK wraps anywhere and carries no space; a URL wraps without one.
      if (CJK_CHAR_RE.test(lastChar) && CJK_CHAR_RE.test(firstChar)) sep = "";
      else if (url !== null) sep = url || CJK_CHAR_RE.test(firstChar) ? "" : " ";
      else if (/^\S*(?:\/|\.[a-z]{2,4}\/)\S*$/.test(nextText.split(" ")[0]) && /\/\S*$/.test(prevText) && !URL_START_RE.test(nextText)) sep = "";
      else if (lineEndHyphen(prevText, nextText) === "drop") {
        builder.dropTrailingChar();
        sep = "";
      }
    }
    builder.append(lineAsPart(lines[i]), sep);
  }
  return builder;
}

// ── Tabs ────────────────────────────────────────────────────────────────────

// A tab stands where the page sets two parts of a line apart, outside a
// table and a display: a form's label and its field, a letter and its
// words, a pair of boxes set flush right, a proof's closing box at the
// column's right edge. A rule the page draws under a gap of a line (a
// fill-in rule) is an underlined tab to the rule's end; a line that holds
// nothing but fill-in rules is a paragraph of its own (fillLines). Each
// tab's run carries its stop (Run.tab), in points from the column's left
// edge: where the words after the tab start, or where they end when they
// end at the column's right edge. A block's stops come from its runs
// (tabStopsOf). segmentPage marks the lines that may hold tabs (markTabs).

/** A gap wider than this, in ems of its line, is a tab. */
const TAB_EM = 1.5;
/** A line of three gaps or more whose middle gap reaches this, in ems, is
    stretched (a justified line with few words): a gap there is a tab only
    when it is TAB_SPACES of its middle gap wide. */
const STRETCHED_EM = 0.8;
const TAB_SPACES = 2.5;
/** A proof's closing box (amsthm's \qed, drawn as a glyph). */
const PROOF_BOX_RE = /^[□■∎]$/;

type Fill = { x1: number; x2: number };
/** A marked line's column edges (right: null where no full line of its
    column says), and the fill-in rules under its gaps. */
type TabPlace = { left: number; right: number | null; fills: Fill[] };
const tabPlaces = new WeakMap<Line, TabPlace>();

/** A row of fill-in rules with no words on it: a page's line to write on
    (a label under it, a second line of an address). */
export type FillRow = { y: number; size: number; left: number; fills: Fill[] };

type Tab = TabStop & { fill?: true };

/** The rules markTabs took as fill-in rules: no separator (segment.ts). */
const fillRules = new WeakSet<Rule>();
export function isFillRule(rule: Rule): boolean {
  return fillRules.has(rule);
}

/** Marks the lines of a page that may hold tabs: those `marked` says (no
    table's, no display's), each with its column's left edge (`edgeOf`, the
    edge its indent is measured from) and right edge (where most of the
    column's full lines end), and the fill-in rules the page draws under
    their gaps. A fill-in rule is a thin horizontal rule outside a table,
    meeting no other rule and no drawn shape (an arrowhead, a diagram's
    box, a chart's bar), and under no word: a blank of a line (blankOf), or
    a rule on a line of its own on a page that reads as a form (a line of
    it has a blank, rules have labels under them, or rules of one length
    stand a line apart), between the page's lines and inside their column
    (a running head's rule, a crop mark, a rule in the margin is none). A
    page that sets math (`blanks` false) has none: a fraction's or a
    radical's bar is no line to write on. Returns the rows of rules alone,
    for fillLines. */
export function markTabs(lines: Line[], marked: (k: number) => boolean, edgeOf: (line: Line) => number, drawing: PageDrawing, blanks: boolean): FillRow[] {
  const kept = lines.filter((line, k) => marked(k) && !line.display && !line.table && line.cells.length > 0);
  for (const line of kept) tabPlaces.set(line, { left: edgeOf(line), right: columnRight(lines, line.x, line.xEnd), fills: [] });
  if (!blanks) return [];
  const boxes = lines.flatMap((l) => (l.table ? [l.table.box] : []));
  const verticals = drawing.rules.filter((r) => r.dir === "v");
  // The drawn shapes a rule may meet; a box around the rule (a form's
  // frame, a shaded field) is none.
  const shapes = [...drawing.fills, ...drawing.paths.filter((b) => !b.clip)].filter((b) => b.y2 - b.y1 > 2);
  const apart: { x1: number; x2: number; y: number; line: Line; rules: Rule[] }[] = [];
  let underGaps = 0;
  for (const r of drawing.rules) {
    const [x1, x2] = [Math.min(r.x1, r.x2), Math.max(r.x1, r.x2)];
    const y = (r.y1 + r.y2) / 2;
    if (r.dir !== "h" || r.thickness > 1.6 || x2 - x1 < 12) continue;
    // A table's rule, a box's edge, a chart's axis.
    if (boxes.some((b) => x1 >= b.x1 - 2 && x2 <= b.x2 + 2 && y >= b.y1 - 2 && y <= b.y2 + 2)) continue;
    if (verticals.some((v) => Math.min(v.y1, v.y2) - 2 <= y && y <= Math.max(v.y1, v.y2) + 2 && x1 - 2 <= v.x1 && v.x1 <= x2 + 2)) continue;
    if (shapes.some((b) => b.y1 - 2 <= y && y <= b.y2 + 2 && b.x1 - 2 <= x2 && b.x2 + 2 >= x1 && !(b.x1 <= x1 + 1 && b.x2 >= x2 - 1))) continue;
    // Under a line: the line whose baseline stands right over it.
    const over = lines.find((l) => y <= l.y + l.size * 0.05 && y >= l.y - l.size * 0.4 && x1 < l.xEnd + l.size * 12 && x2 > l.x - l.size * 12);
    if (over) {
      const place = tabPlaces.get(over);
      const blank = place ? blankOf(over, place, x1, x2, y, lines) : null;
      if (place && blank) {
        place.fills.push(blank);
        underGaps++;
        fillRules.add(r);
      }
      continue;
    }
    // Through a line's words (a strikethrough, a frame): its letters reach
    // three quarters of its size over its baseline.
    if (lines.some((l) => y > l.y - l.size * 0.4 && y < l.y + l.size * 0.75 && x1 < l.xEnd && x2 > l.x)) continue;
    // The nearest line of its column gives its size and the column's edge.
    const column = kept.filter((l) => l.x < x2 && l.xEnd > x1);
    const near = (column.length > 0 ? column : kept).reduce<Line | null>((best, l) => (!best || Math.abs(l.y - y) < Math.abs(best.y - y) ? l : best), null);
    // A rule drawn twice over itself is one.
    const same = apart.find((a) => Math.abs(a.y - y) < 0.5 && Math.abs(a.x1 - x1) < 0.5 && Math.abs(a.x2 - x2) < 0.5);
    if (same) same.rules.push(r);
    else if (near) apart.push({ x1, x2, y, line: near, rules: [r] });
  }
  // Rules alone are lines to write on only on a page that reads as a form:
  // a line of it has a blank, two rules have a label set under them (a
  // signature block), or two rules of one length stand a line apart with
  // nothing between them (an address's lines; a double rule stands closer).
  const body = median(kept.map((l) => l.size));
  const labeled = apart.filter((a) => labelUnder(a.x1, a.x2, a.y, lines, body)).length;
  const stacked = apart.some((a) =>
    apart.some((b) => b !== a && Math.abs(b.x1 - a.x1) <= 3 && Math.abs(b.x2 - a.x2) <= 3 && a.y - b.y >= a.line.size * 0.8 && a.y - b.y <= a.line.size * 2.5 && !lines.some((l) => l.y < a.y && l.y > b.y && l.x < a.x2 && l.xEnd > a.x1)),
  );
  if (kept.length === 0 || (underGaps === 0 && labeled < 2 && !stacked)) return [];
  const top = Math.max(...kept.map((l) => l.y + l.size));
  const bottom = Math.min(...kept.map((l) => l.y));
  const rows: FillRow[] = [];
  for (const a of apart) {
    const size = a.line.size;
    // The column's edge: the leftmost edge of the lines around the rule (a
    // signature block's second column of rules stands in the page's).
    const left = Math.min(edgeOf(a.line), ...kept.filter((l) => Math.abs(l.y - a.y) <= size * 6).map(edgeOf));
    if (a.y > top || a.y < bottom || a.x1 < left - 2) continue;
    for (const r of a.rules) fillRules.add(r);
    const row = rows.find((w) => Math.abs(w.y - a.y) <= 1);
    if (row) row.fills.push({ x1: a.x1, x2: a.x2 });
    else rows.push({ y: a.y, size, left, fills: [{ x1: a.x1, x2: a.x2 }] });
  }
  for (const row of rows) row.fills.sort((p, q) => p.x1 - q.x1);
  return rows;
}

/** The right edge of the column from x1 to x2: the furthest place two of
    its full lines end at together (a line alone past them runs over it);
    null where no two do (a ragged column). */
function columnRight(lines: Line[], x1: number, x2: number): number | null {
  const ends = lines
    .filter((l) => l.cells.length === 1 && !l.table && [...l.text].length > 30 && l.x < x2 && l.xEnd > x1)
    .map((l) => l.xEnd)
    .sort((a, b) => b - a);
  for (let k = 0; k + 1 < ends.length; k++) if (ends[k] - ends[k + 1] <= 1.5) return ends[k];
  return null;
}

/** A rule from x1 to x2 at y, under `line`, as a blank of the line: the
    rule lies in one gap of its words (a rule that runs under a word too
    underlines a heading or closes a table), inside its column, with no
    formula beside it and no words right under it (a fraction's bar) or
    beside it on another line (a table's rule in the next column). Null
    where it is none. */
function blankOf(line: Line, place: TabPlace, x1: number, x2: number, y: number, lines: Line[]): Fill | null {
  const size = line.size;
  if (x1 < place.left - 2 || (place.right !== null && x2 > place.right + 2)) return null;
  // The items over the rule, a point off each way, and the ones beside it.
  const items = line.items.filter((it) => it.str.trim() !== "");
  if (items.some((it) => it.x + it.w - 1 > x1 + 2 && it.x + 1 < x2 - 2)) return null;
  const before = items.filter((it) => it.x + it.w <= x1 + 3).at(-1);
  const after = items.find((it) => it.x >= x2 - 3);
  if ([before, after].some((it) => it && (it.math || it.zone !== undefined))) return null;
  const others = lines.filter((l) => l !== line && l.x < x2 && l.xEnd > x1);
  if (others.some((l) => Math.abs(l.y - line.y) < size * 0.5 || (l.y < y && y - l.y < size * 0.8))) return null;
  // Past the line's last word, the rule stays in its column: no column's
  // edge near it (two lines that start together) stands under the rule.
  const starts = after ? [] : lines.filter((l) => l.x > line.xEnd + 2 && l.x < x2 - 2 && Math.abs(l.y - line.y) < size * 12).map((l) => l.x);
  if (starts.some((x, k) => starts.some((w, j) => j !== k && Math.abs(w - x) <= 2))) return null;
  const blank = { x1: Math.max(x1, before ? before.x + before.w + 1 : x1), x2: Math.min(x2, after ? after.x - 1 : x2) };
  return blank.x2 - blank.x1 >= Math.max(12, size * 1.5) ? blank : null;
}

/** A label set right under a rule from x1 to x2 at y (a signature line's
    "Name of witness"): one phrase of a line under it within a line and a half,
    no larger than the page's words (`body`), from the rule's start to short
    of its end, and room over the rule to sign in. A table's row under its
    rule spreads its cells to the rule's end, or has the row before it
    right over the rule; a heading under a section's rule is larger. */
function labelUnder(x1: number, x2: number, y: number, lines: Line[], body: number): boolean {
  if (lines.some((l) => l.y > y && l.y - y < l.size * 1.5 && l.x < x2 && l.xEnd > x1)) return false;
  return lines.some((l) => {
    if (l.y >= y || y - l.y > l.size * 1.6 || l.size > body + 0.5) return false;
    const under = l.items.filter((it) => it.str.trim() !== "" && it.x + it.w > x1 - 2 && it.x < x2 + 2).sort((a, b) => a.x - b.x);
    if (under.length === 0 || Math.abs(under[0].x - x1) > 2) return false;
    if (under.some((it, k) => k > 0 && it.x - (under[k - 1].x + under[k - 1].w) >= l.size * TAB_EM)) return false;
    return Math.max(...under.map((it) => it.x + it.w)) <= x2 - l.size;
  });
}

/** A marked line's words with its tabs, else null: each gap that is a tab
    (tabAt), an underlined tab for each fill-in rule, and a tab before a
    proof's box at the column's right edge; the other gaps between cells
    read as spaces. Null too when the line's items do not spell its text. */
function withTabs(line: Line, place: TabPlace): { text: string; runs: Run[] } | null {
  const text = line.text;
  // Where each item's words stand in the text.
  const words: { x1: number; x2: number; start: number; end: number; math: boolean; box: boolean }[] = [];
  let at = 0;
  for (const it of line.items) {
    const word = it.str.trim();
    if (!word) continue;
    const found = text.indexOf(word, at);
    if (found < 0 || text.slice(at, found).trim() !== "") return null;
    words.push({ x1: it.x, x2: it.x + it.w, start: found, end: found + word.length, math: it.math || it.zone !== undefined, box: PROOF_BOX_RE.test(word) });
    at = found + word.length;
  }
  if (words.length === 0) return null;
  const size = line.size;
  // Stops from the column's edge; a line that starts left of it (a letter
  // hung in the margin) is drawn at the edge, and its stops go with it.
  const origin = Math.min(place.left, line.x);
  const stop = (x: number) => Math.max(0, Math.round((x - origin) * 2) / 2);
  const right = place.right;
  const atEdge = (x: number) => right !== null && Math.abs(x - right) <= Math.max(2, size * 0.3);
  // A centered line holds no tabs between words, and a stretched one (a
  // justified line with few words, its word spaces wide) only where a gap
  // stands out from them.
  const gaps = words.slice(1).flatMap((w, k) => (text.slice(words[k].end, w.start).trim() === "" && w.start > words[k].end ? [w.x1 - words[k].x2] : []));
  const middle = gaps.length >= 3 ? median(gaps) : 0;
  const wide = (gap: number) => gap >= size * TAB_EM && (middle < size * STRETCHED_EM || gap >= middle * TAB_SPACES);
  // A row of three phrases or more, each a word space within and three
  // ems or more apart, is labels set under figures side by side, centered
  // or not (parse loop finding: "(a) Overfitting", "(b) Underfitting.",
  // "(c) Fitting well." under a figure centered in its column read as one
  // phrase).
  const labels = gaps.filter((g) => g >= size * 3).length >= 2 && gaps.every((g) => g < size * 0.6 || g >= size * 3);
  const centered = right !== null && line.x - origin >= size * 2 && Math.abs(line.x - origin - (right - line.xEnd)) <= size && !labels;
  const full = right !== null && line.xEnd >= right - size;
  const width = right === null ? line.xEnd - origin : right - origin;
  const fills = [...place.fills].sort((a, b) => a.x1 - b.x1);
  // The tabs a gap from x1 to x2 holds: an underlined tab to the end of
  // each fill-in rule in it (a space before one a word space off, a tab
  // before one set further off), then `after`, a tab to the words after
  // the gap, when they stand past the rules.
  const tabsIn = (x1: number, x2: number, after: Tab | null): { lead: string; tabs: Tab[] } => {
    const tabs: Tab[] = [];
    let lead = "";
    let x = x1;
    for (const f of fills.filter((f) => f.x1 >= x1 - size && f.x2 <= x2 + 2)) {
      if (tabs.length === 0 && f.x1 - x >= size * TAB_EM && !centered) tabs.push({ at: stop(f.x1), align: "left" });
      else if (tabs.length === 0 && f.x1 - x >= size * 0.2) lead = " ";
      tabs.push({ at: stop(f.x2), align: "left", fill: true });
      x = f.x2;
    }
    if (after && after.at > 0 && (tabs.length === 0 || x2 - x >= size * TAB_EM)) tabs.push(after);
    return { lead, tabs };
  };
  // Each gap's new words: [from, to) of the text becomes lead + tabs.
  const edits: { from: number; to: number; lead: string; tabs: Tab[] }[] = [];
  const edit = (from: number, to: number, got: { lead: string; tabs: Tab[] }) => {
    if (got.tabs.length > 0) edits.push({ from, to, ...got });
  };
  edit(words[0].start, words[0].start, tabsIn(origin, words[0].x1, null));
  for (let k = 1; k < words.length; k++) {
    const [prev, cur] = [words[k - 1], words[k]];
    const sep = text.slice(prev.end, cur.start);
    if (sep === "" || sep.trim() !== "") continue;
    edit(prev.end, cur.start, tabsIn(prev.x2, cur.x1, tabAt(k)));
  }
  const last = words[words.length - 1];
  edit(last.end, last.end, tabsIn(last.x2, (right ?? last.x2) + size * 40, null));
  if (edits.length === 0) return null;

  // What the gap before word k is, when it is a tab: before a proof's box
  // at the edge, a right tab; past a wide gap between words (not a
  // formula's glyphs: its spacing is its own), a right tab when the words
  // after it end at the edge (a pair set flush right), else a left tab to
  // where they start, unless the line runs to the edge with words on both
  // sides (a gap in prose: TeX's \qquad).
  function tabAt(k: number): Tab | null {
    const [prev, cur] = [words[k - 1], words[k]];
    if (k === words.length - 1 && cur.box && atEdge(cur.x2) && right !== null) return { at: stop(right), align: "right" };
    if (prev.math || cur.math || !wide(cur.x1 - prev.x2) || centered) return null;
    const rest = words.slice(k);
    const end = rest[rest.length - 1].x2;
    const lastPart = rest.every((w, j) => j === 0 || w.x1 - rest[j - 1].x2 < size * TAB_EM);
    if (lastPart && atEdge(end) && end - cur.x1 <= width * 0.4 && right !== null) return { at: stop(right), align: "right" };
    if (!full || prev.x2 - line.x <= width * 0.15) return { at: stop(cur.x1), align: "left" };
    return null;
  }

  // The new text; each old offset's new place (side -1 before words put
  // at it, +1 after them).
  let out = "";
  let from = 0;
  const tabRuns: Run[] = [];
  const base = line.runs[0];
  for (const e of edits) {
    out += text.slice(from, e.from).replace(/\t/g, " ");
    out += e.lead;
    const flags = line.runs.find((r) => r.start < e.from && r.end >= e.from) ?? base;
    for (const tab of e.tabs) {
      tabRuns.push({ bold: flags?.bold ?? false, italic: flags?.italic ?? false, mono: false, smallCaps: false, href: null, look: flags?.look, start: out.length, end: out.length + 1, tab });
      out += "\t";
    }
    from = e.to;
  }
  out += text.slice(from).replace(/\t/g, " ");
  const moved = (x: number, side: -1 | 1): number => {
    let delta = 0;
    for (const e of edits) {
      const size = e.lead.length + e.tabs.length;
      if (x < e.from || (x === e.from && (e.to > e.from || side < 0))) return x + delta;
      if (x < e.to || x === e.from) return e.from + delta + (side < 0 ? 0 : size);
      delta += size - (e.to - e.from);
    }
    return x + delta;
  };
  const runs = line.runs.flatMap((r) => {
    const [start, end] = [moved(r.start, 1), moved(r.end, -1)];
    // A run over a tab gives it up.
    const pieces: Run[] = [];
    let s0 = start;
    for (const t of tabRuns) {
      if (t.start < s0 || t.start >= end) continue;
      if (t.start > s0) pieces.push({ ...r, start: s0, end: t.start });
      s0 = t.end;
    }
    if (end > s0) pieces.push({ ...r, start: s0, end });
    return pieces;
  });
  return { text: out, runs: [...runs, ...tabRuns].sort((a, b) => a.start - b.start) };
}

/** A proof's box on a line of its own, set at the column's right edge
    under the block it closes: the block's text takes it after a tab to a
    right stop at the edge, measured from the block's left edge (a line of
    a box alone reads its own place as a column). A line no mark places
    takes a space. */
export function appendProofBox(target: { text: string; runs?: Run[]; box?: Box }, line: Line) {
  const box = line.text.trim();
  const place = tabPlaces.get(line);
  const right = place?.right ?? null;
  if (!place || right === null || Math.abs(line.xEnd - right) > Math.max(2, line.size * 0.3)) {
    target.text = `${target.text} ${box}`;
    return;
  }
  const at = target.text.length;
  const shift = at + 1 - line.text.indexOf(box);
  const flags = line.runs[0];
  const left = Math.min(place.left, target.box?.x1 ?? place.left);
  const tab: Run = { bold: false, italic: false, mono: false, smallCaps: false, href: null, look: flags?.look, start: at, end: at + 1, tab: { at: Math.round((right - left) * 2) / 2, align: "right" } };
  target.text = `${target.text}\t${box}`;
  target.runs = [...(target.runs ?? []), tab, ...line.runs.map((r) => ({ ...r, start: r.start + shift, end: r.end + shift }))];
}

/** The rows of fill-in rules alone (markTabs) as paragraphs, each after
    the last block that stands over it on its page: an underlined tab to
    each rule's end, a tab between two rules set apart. */
export function fillLines(segments: Segment[], rows: FillRow[], page: number): Segment[] {
  if (rows.length === 0) return segments;
  const out = [...segments];
  for (const row of rows) {
    const stop = (x: number) => Math.max(0, Math.round((x - row.left) * 2) / 2);
    const tabs: Tab[] = [];
    let x = row.fills[0].x1;
    for (const f of row.fills) {
      if (f.x1 - x >= row.size * TAB_EM) tabs.push({ at: stop(f.x1), align: "left" });
      tabs.push({ at: stop(f.x2), align: "left", fill: true });
      x = f.x2;
    }
    const x1 = row.fills[0].x1;
    const x2 = row.fills[row.fills.length - 1].x2;
    // The line the rule underlines: its baseline a little over the rule.
    const baseline = row.y + row.size * 0.14;
    const box = { x1, y1: baseline - row.size * 0.3, x2, y2: baseline + row.size * 0.85 };
    const runs: Run[] = tabs.map((tab, k) => ({ bold: false, italic: false, mono: false, smallCaps: false, href: null, start: k, end: k + 1, tab }));
    const inset = Math.round(x1 - row.left);
    const segment: Segment = { type: "PARAGRAPH", text: "\t".repeat(tabs.length), page, runs, box, lineBox: box, lineSize: row.size, mathShare: 0, ...(inset > 0 ? { indent: { left: inset, first: 0 } } : {}) };
    const above = out.findLastIndex((s) => s.box !== undefined && s.box.y1 > box.y2 - row.size * 0.5);
    out.splice(above + 1, 0, segment);
  }
  return out;
}

/** A block that holds a fill-in rule: kept whatever its words (a line of
    rules alone, a rule and a period). */
export function holdsFill(segment: { text: string; runs?: Run[] }): boolean {
  return (segment.runs ?? []).some((r) => r.tab?.fill === true && segment.text[r.start] === "\t");
}

/** A block's tab stops from its runs (Run.tab), in order, one to a place,
    and each fill-in rule's underline. */
export function tabStopsOf(text: string, runs: Run[] | undefined): { stops: TabStop[]; fills: StyleSpan[] } {
  const stops: TabStop[] = [];
  const fills: StyleSpan[] = [];
  for (const r of runs ?? []) {
    const tab = r.tab;
    if (!tab || text[r.start] !== "\t") continue;
    if (!stops.some((s) => Math.abs(s.at - tab.at) < 1)) stops.push({ at: tab.at, align: tab.align });
    if (tab.fill) fills.push({ start: r.start, end: r.start + 1, style: "underline", quotedText: "\t" });
  }
  return { stops: stops.sort((a, b) => a.at - b.at), fills };
}

export function boldShare(runs: Run[], length: number): number {
  if (length === 0) return 0;
  let bold = 0;
  for (const r of runs) if (r.bold) bold += r.end - r.start;
  return bold / length;
}

const RTL_SCRIPT_RE = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{M}]/gu;

// Monospace line: a listing's line (import compare loop finding: a python
// listing shattered into lists, paragraphs and joined lines).
export function isMonoLine(line: Line): boolean {
  let chars = line.text.replace(/\s/g, "").length;
  if (chars === 0) return false;
  let mono = 0;
  for (const r of line.runs) {
    if (r.mono) mono += line.text.slice(r.start, r.end).replace(/\s/g, "").length;
  }
  // A listing's line number: digits at the line's start in a face that is
  // no typewriter face, set smaller than the code after it, count for
  // neither side (parse loop finding: a LaTeX package's manual numbers
  // each listing line in 5 pt beside 8 pt code; a line "2 {" counted its
  // number as half its characters, read as no code, and every listing
  // broke into code and paragraphs at its braces).
  const [first, ...rest] = line.items;
  const code = rest.filter((it) => it.mono && it.str.trim());
  if (first && !first.mono && /^\s*\d{1,4}\s*$/.test(first.str) && code.length > 0 && first.size < Math.min(...code.map((it) => it.size)) * 0.85) {
    chars -= first.str.trim().length;
  }
  // A string in a right-to-left script, in a line that opens in the
  // typewriter face, is set in another face (the typewriter face has no
  // Arabic letters): its letters count for neither side (parse loop
  // finding: an Arabic book's listing lines "printf 'تقرير تجريبي\n' > …"
  // read as paragraphs between its code).
  if (first?.mono) {
    for (const r of line.runs) if (!r.mono) chars -= (line.text.slice(r.start, r.end).match(RTL_SCRIPT_RE) ?? []).length;
  }
  return chars > 0 && mono / chars >= 0.85;
}

// ── Style and link spans out of runs ────────────────────────────────────────

const WORD_RE = /[\p{L}\p{N}]/u;

/** Whether an offset falls between the two halves of a surrogate pair: a
    character past the Basic Multilingual Plane (the math letters 𝑝 and 𝒜)
    is two UTF-16 units. */
export function insidePair(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  const [high, low] = [text.charCodeAt(at - 1), text.charCodeAt(at)];
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}

/** A span's edges on whole characters: an edge inside a surrogate pair moves
    out to the pair's edge. Half a pair in an import's rich text makes the
    database refuse the whole document (the NPS thesis could not be added). */
export function wholeChars(text: string, start: number, end: number): { start: number; end: number } {
  return { start: insidePair(text, start) ? start - 1 : start, end: insidePair(text, end) ? end + 1 : end };
}

// The look most of a block's letters take (ParsedBlock.font): the face and
// the size of the most letters (a formula's glyphs, a footnote mark, and a
// code run aside), bold and italic when most letters are, and the color
// most letters take. None when no run has a look (look.ts).
function blockFont(text: string, runs: Run[]): TextFont | undefined {
  const letters = (r: Run) => {
    let n = 0;
    for (const ch of text.slice(r.start, r.end)) if (WORD_RE.test(ch)) n++;
    return n;
  };
  const counted = runs.filter((r) => r.look && !r.zone).map((r) => ({ r, n: letters(r) }));
  const top = <T>(value: (r: Run) => T | undefined): T | undefined => {
    const counts = new Map<T, number>();
    for (const { r, n } of counted) {
      const v = value(r);
      if (v !== undefined && n > 0) counts.set(v, (counts.get(v) ?? 0) + n);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const prose = counted.some(({ r, n }) => n > 0 && !r.mono && r.look?.face);
  const family = top((r) => (r.look?.face && (!prose || !r.mono) ? r.look.face : undefined));
  // Small capitals count at their capitals' size (look.ts drawnSmallCaps).
  const size = top((r) => (r.sup || r.sub ? undefined : (r.look?.capitals ?? r.look?.size)));
  if (!family || size === undefined) return undefined;
  const all = counted.reduce((sum, { n }) => sum + n, 0);
  const share = (flag: (r: Run) => boolean | undefined) => counted.reduce((sum, { r, n }) => sum + (flag(r) ? n : 0), 0) / all;
  const color = top((r) => r.look?.color ?? "");
  return {
    family,
    size,
    ...(share((r) => r.bold) > 0.5 ? { bold: true as const } : {}),
    ...(share((r) => r.italic) > 0.5 ? { italic: true as const } : {}),
    ...(color ? { color } : {}),
  };
}

export function spansFromRuns(
  text: string,
  runs: Run[] | undefined,
  opts: { skipBold?: boolean; skipMono?: boolean } = {},
): { styles: StyleSpan[]; links: LinkSpan[]; font?: TextFont } {
  const styles: StyleSpan[] = [];
  const links: LinkSpan[] = [];
  if (!runs || runs.length === 0) return { styles, links };

  // The ranges of runs that share a value, joined across a space between them.
  const collect = (value: (r: Run) => string | null | undefined): { start: number; end: number; value: string }[] => {
    const ranges: { start: number; end: number; value: string }[] = [];
    for (const r of runs) {
      const v = value(r);
      if (!v) continue;
      const last = ranges[ranges.length - 1];
      if (last && last.value === v && r.start - last.end <= 1 && text.slice(last.end, r.start).trim() === "") {
        last.end = r.end;
      } else {
        ranges.push({ start: r.start, end: r.end, value: v });
      }
    }
    return ranges;
  };
  const flag = (name: "bold" | "italic" | "mono" | "smallCaps" | "sup" | "sub") => (r: Run) => (r[name] ? "on" : null);
  const trim = (range: { start: number; end: number }): { start: number; end: number } => {
    let { start, end } = range;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return wholeChars(text, start, end);
  };
  const whole = (range: { start: number; end: number }): boolean =>
    text.slice(0, range.start).trim() === "" && text.slice(range.end).trim() === "";

  const push = (style: StyleSpan["style"], range: { start: number; end: number }) => {
    const { start, end } = trim(range);
    if (end <= start) return;
    styles.push({ start, end, style, quotedText: text.slice(start, end) });
  };
  for (const range of collect(flag("bold"))) {
    if (opts.skipBold && whole(range)) continue;
    push("bold", range);
  }
  for (const range of collect(flag("italic"))) push("italic", range);
  for (const range of collect(flag("mono"))) {
    if (opts.skipMono && whole(range)) continue;
    push("code", range);
  }
  for (const range of collect(flag("smallCaps"))) push("smallCaps", range);
  for (const range of collect(flag("sup"))) push("sup", range);
  for (const range of collect(flag("sub"))) push("sub", range);
  // What the drawing marks (look.ts). A code run keeps the code's look: a
  // color or a highlight on it would take its code mark in the import.
  for (const range of collect((r) => (r.look?.underline ? "on" : null))) push("underline", range);
  for (const range of collect((r) => (r.look?.strike ? "on" : null))) push("strike", range);
  for (const range of collect((r) => (r.mono ? null : r.look?.color))) push(`color:${range.value}` as StyleSpan["style"], range);
  for (const range of collect((r) => (r.mono ? null : r.look?.highlight))) push(`highlight:${range.value}` as StyleSpan["style"], range);
  // A run of words in another face or size than its block's. A formula,
  // a script, and a code run have their own; a symbol in another font (a
  // checkbox in MS Gothic) is no run of words.
  const font = blockFont(text, runs);
  if (font) {
    const words = (r: Run) => !r.mono && !r.zone && WORD_RE.test(text.slice(r.start, r.end));
    for (const range of collect((r) => (words(r) && r.look?.face && r.look.face !== font.family ? r.look.face : null))) {
      push(`font:${range.value}`, range);
    }
    for (const range of collect((r) => (words(r) && !r.sup && !r.sub && r.look && Math.abs(r.look.size - font.size) >= 0.5 ? String(r.look.size) : null))) {
      push(`size:${Number(range.value)}`, range);
    }
  }
  // Hyperlink regions from the PDF's link annotations.
  for (const r of runs) {
    if (!r.href) continue;
    const last = links[links.length - 1];
    if (last && last.href === r.href && r.start - last.end <= 1) {
      last.end = wholeChars(text, last.start, r.end).end;
      last.quotedText = text.slice(last.start, last.end);
    } else {
      const { start, end } = trim(r);
      if (end > start) links.push({ start, end, quotedText: text.slice(start, end), href: r.href });
    }
  }
  return font ? { styles, links, font } : { styles, links };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Lines joined into text: wraps, line breaks, line-end hyphens, and the style
// runs (bold, italic, monospace, links) that become a block's style and link
// spans.

import { sameFlags } from "@/lib/parse/pdf/glyphs";
import type { Line, Run } from "@/lib/parse/pdf/types";
import type { LinkSpan, StyleSpan } from "@/lib/parse/types";

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
      // "ing" twice in a document made "ing" a word.
      const found = [...text.matchAll(WORDS_RE)];
      const cut = i > 0 && LETTER_HYPHEN_END_RE.test(lines[i - 1].text.trim());
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

// What a line-end hyphen between two texts is: "drop" for the typesetter's,
// "keep" for a compound's, null when the first text ends in no hyphen after
// a word or the second starts with no letter ("COVID-" then "19").
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
  const [lw, rw] = [hyphenation.words.has(l), hyphenation.words.has(r)];
  if (lw && rw) return "keep";
  if (!lw && !rw) return "drop";
  return hyphenation.breaksWords ? "drop" : "keep";
}

// Joins the second part of a paragraph cut by a page break or a float to
// its first: the typesetter's hyphen goes, a compound's stays, and a space
// separates words otherwise. Returns where the second part starts.
export function joinWrapped(target: { text: string; runs?: Run[] }, next: string): number {
  const hyphen = lineEndHyphen(target.text, next);
  if (hyphen === "drop") {
    target.text = target.text.slice(0, -1);
    const cut = target.text.length;
    target.runs = target.runs?.map((r) => ({ ...r, end: Math.min(r.end, cut) })).filter((r) => r.end > r.start);
  }
  const glue = hyphen !== null || (/[\p{L}\p{N}][-–]$/u.test(target.text) && /^[\p{L}\p{N}(]/u.test(next)) ? "" : " ";
  const offset = target.text.length + glue.length;
  target.text = target.text + glue + next;
  return offset;
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
// list a multi-cell line reads with a space (a lone "20:00<tab>Dinner" line
// carried the tab into its paragraph — import compare loop finding).
export function lineAsPart(line: Line): { text: string; runs: Run[] } {
  return { text: line.text.replace(/\t/g, " "), runs: line.runs };
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
// number after it — is a wrap whatever the margin says.
export function joinGroup(lines: Line[], proseJoin = false): { text: string; runs: Run[] } {
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
    const midSentence =
      proseJoin &&
      !/[.!?:…。！？：]["'”]?$/.test(prevText) &&
      (/^[a-z0-9($€£"'“]/.test(nextText) || CJK_CHAR_RE.test(nextText[0] ?? ""));
    let sep: " " | "\n" | "" = fieldList ? "\n" : wrapped || midSentence ? " " : "\n";
    if (sep === " ") {
      const lastChar = prevText[prevText.length - 1] ?? "";
      const firstChar = nextText[0] ?? "";
      // CJK wraps anywhere and carries no space; a URL wraps without one.
      if (CJK_CHAR_RE.test(lastChar) && CJK_CHAR_RE.test(firstChar)) sep = "";
      else if (/https?:\/\/\S*$/.test(prevText) || /^\S*(?:\/|\.[a-z]{2,4}\/)\S*$/.test(nextText.split(" ")[0]) && /\/\S*$/.test(prevText)) sep = "";
      else if (lineEndHyphen(prevText, nextText) === "drop") {
        builder.dropTrailingChar();
        sep = "";
      }
    }
    builder.append(lineAsPart(lines[i]), sep);
  }
  return builder;
}

export function boldShare(runs: Run[], length: number): number {
  if (length === 0) return 0;
  let bold = 0;
  for (const r of runs) if (r.bold) bold += r.end - r.start;
  return bold / length;
}

// Monospace line: a listing's line (import compare loop finding: a python
// listing shattered into lists, paragraphs and joined lines).
export function isMonoLine(line: Line): boolean {
  const chars = line.text.replace(/\s/g, "").length;
  if (chars === 0) return false;
  let mono = 0;
  for (const r of line.runs) {
    if (r.mono) mono += line.text.slice(r.start, r.end).replace(/\s/g, "").length;
  }
  return mono / chars >= 0.85;
}

// ── Style and link spans out of runs ────────────────────────────────────────

export function spansFromRuns(
  text: string,
  runs: Run[] | undefined,
  opts: { skipBold?: boolean; skipMono?: boolean } = {},
): { styles: StyleSpan[]; links: LinkSpan[] } {
  const styles: StyleSpan[] = [];
  const links: LinkSpan[] = [];
  if (!runs || runs.length === 0) return { styles, links };

  const collect = (flag: "bold" | "italic" | "mono" | "smallCaps" | "sup" | "sub"): { start: number; end: number }[] => {
    const ranges: { start: number; end: number }[] = [];
    for (const r of runs) {
      if (!r[flag]) continue;
      const last = ranges[ranges.length - 1];
      if (last && r.start - last.end <= 1 && text.slice(last.end, r.start).trim() === "") {
        last.end = r.end;
      } else {
        ranges.push({ start: r.start, end: r.end });
      }
    }
    return ranges;
  };
  const trim = (range: { start: number; end: number }): { start: number; end: number } => {
    let { start, end } = range;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start, end };
  };
  const whole = (range: { start: number; end: number }): boolean =>
    text.slice(0, range.start).trim() === "" && text.slice(range.end).trim() === "";

  const push = (style: StyleSpan["style"], range: { start: number; end: number }) => {
    const { start, end } = trim(range);
    if (end <= start) return;
    styles.push({ start, end, style, quotedText: text.slice(start, end) });
  };
  for (const range of collect("bold")) {
    if (opts.skipBold && whole(range)) continue;
    push("bold", range);
  }
  for (const range of collect("italic")) push("italic", range);
  for (const range of collect("mono")) {
    if (opts.skipMono && whole(range)) continue;
    push("code", range);
  }
  for (const range of collect("smallCaps")) push("smallCaps", range);
  for (const range of collect("sup")) push("sup", range);
  for (const range of collect("sub")) push("sub", range);
  // Hyperlink regions from the PDF's link annotations.
  for (const r of runs) {
    if (!r.href) continue;
    const last = links[links.length - 1];
    if (last && last.href === r.href && r.start - last.end <= 1) {
      last.end = r.end;
      last.quotedText = text.slice(last.start, last.end);
    } else {
      const { start, end } = trim(r);
      if (end > start) links.push({ start, end, quotedText: text.slice(start, end), href: r.href });
    }
  }
  return { styles, links };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

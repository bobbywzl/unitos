// The reader's anchor capture over a table (lib/anchors/dom.ts), the table's
// marks (components/reader/table-marks.ts), and Define's one-word check
// (lib/define.ts), in a DOM with no browser: a selection across two cells
// captures the stored text with its tab, an anchor stored before the walk
// added separators still paints on its cell, and Define never shows on a
// piece of a word or on words across two cells.
// Run: npx tsx scripts/qa/anchors-dom-check.ts
import { JSDOM } from "jsdom";
import { blankTolerantMap, paintTableMarks } from "@/components/reader/table-marks";
import { anchorableOffset, anchorableText } from "@/lib/anchors/dom";
import { definableSelection, defineKey, defineWord } from "@/lib/define";

// The helpers read the DOM only when called.
const { window } = new JSDOM("<!doctype html><body></body>");
Object.assign(globalThis, { window, document: window.document, Node: window.Node, NodeFilter: window.NodeFilter });

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

function block(html: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-block-id", "b");
  el.innerHTML = html;
  document.body.replaceChildren(el);
  return el;
}
const textIn = (el: HTMLElement, words: string): Text => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.includes(words)) return n as Text;
  throw new Error(`no text ${words}`);
};

// ── A web page's table: no cell gaps in its html ────────────────────────
const MEMO = "<table><tr><th>Item</th><th>Count</th></tr><tr><td>Pages</td><td>2</td></tr><tr><td>Notes</td><td>42</td></tr></table>";
const MEMO_TEXT = "Item\tCount\nPages\t2\nNotes\t42";
let el = block(MEMO);
check(anchorableText(el) === MEMO_TEXT, "a gapless table's anchorable text is its stored text: a tab between cells, a newline between rows");
const start = anchorableOffset(el, textIn(el, "Pages"), 0);
const end = anchorableOffset(el, textIn(el, "2"), 1);
check(start === 11 && end === 18, "a selection from Pages to 2 has the stored offsets 11 to 18");
check(anchorableText(el).slice(start, end) === "Pages\t2", 'its quote is "Pages\\t2", not "Pages2"');
const cell2 = textIn(el, "2").parentElement as HTMLElement;
const row = cell2.parentElement as HTMLElement;
const before2 = Array.from(row.childNodes).indexOf(cell2);
check(anchorableOffset(el, row, before2) === 17, "a boundary just before a cell counts the tab before it");
check(anchorableOffset(el, row, row.childNodes.length) === 18, "a boundary at a row's end counts the row's words");
// An anchor stored before the walk added separators: the server resolved it
// on the block text, so its offsets are block text offsets.
check(MEMO_TEXT.slice(11, 16) === "Pages" && anchorableText(el).slice(11, 16) === "Pages", "the stored anchor Pages 11..16 slices the same words from the html");

// The html as a web page writes it: blank text between the tags.
el = block(MEMO.replace(/></g, ">\n  <").replace(/<td>/g, "<td>").replace("<table>\n  ", "<table>\n"));
check(anchorableText(el) === MEMO_TEXT, "the blank text between a table's tags is no text of the table");

// A rowspan repeats its words in each row under it; a colspan's extra
// columns are blank cells (lib/parse/url.ts tableText).
el = block('<table><tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr><tr><td colspan="2">D</td><td>E</td></tr><tr><td>F</td><td rowspan="1">G</td></tr></tbody></table>');
check(anchorableText(el) === "A\tB\nA\tC\nD\t\tE\nF\tG", "rowspan and colspan read as the stored text writes them");
check(anchorableOffset(el, textIn(el, "C"), 1) === "A\tB\nA\tC".length, "an offset after a rowspan's repeat counts the repeat");

// A caption is walked where it stands.
el = block("<table><caption>Table 1</caption><tr><td>x</td><td>y</td></tr></table>");
check(anchorableText(el) === "Table 1x\ty", "a caption's words come first, as before");

// ── A table with gaps: walked as it is ──────────────────────────────────
const GAPPED =
  '<table><tbody><tr><td>Pages<span class="cell-gap">\t</span></td><td>2<span class="cell-gap">\n</span></td></tr><tr><td>Notes<span class="cell-gap">\t</span></td><td>42</td></tr></tbody></table>';
el = block(GAPPED);
check(anchorableText(el) === "Pages\t2\nNotes\t42", "a table with cell gaps keeps its gaps, never doubled");
check(anchorableOffset(el, textIn(el, "42"), 2) === "Pages\t2\nNotes\t42".length, "offsets in a gapped table are as before");

// ── Inline controls stay out ────────────────────────────────────────────
el = block('Hello <button data-anchor-skip>E1</button>world');
check(anchorableText(el) === "Hello world", "a skipped control's text is not anchorable");
check(anchorableOffset(el, textIn(el, "world"), 2) === 8, "an offset after a skipped control skips its text");

// ── Marks on a table ────────────────────────────────────────────────────
const t = ((key: string) => key) as unknown as Parameters<typeof paintTableMarks>[4];
const anchor = (start: number, end: number, color: string) => ({
  id: `h${start}`,
  kind: "anchor" as const,
  start,
  end,
  sourceId: `s${start}`,
  color,
  noteId: `n${start}`,
});
el = block(MEMO);
const painted = paintTableMarks(el, "b", MEMO_TEXT, [anchor(11, 16, "sage"), anchor(19, 24, "gold")] as never, t);
const marks = Array.from(el.querySelectorAll("mark"));
check(painted, "a gapless table paints its marks (no ring)");
check(marks.length === 2 && marks[0].textContent === "Pages" && marks[1].textContent === "Notes", "each highlight marks its own cell");
check(marks[0].className.includes("hl-sage") && marks[1].className.includes("hl-gold"), "each mark carries its highlight's color");
check(anchorableText(el) === MEMO_TEXT, "the painted marks keep the table's anchorable text");
const across = paintTableMarks(el, "b", MEMO_TEXT, [anchor(11, 18, "clay")] as never, t);
check(across && Array.from(el.querySelectorAll("mark")).map((m) => m.textContent).join("|") === "Pages|2", "a highlight across two cells marks both cells' words");

el = block("<table><tr><td>\n  Pages\n</td><td> 2 </td></tr></table>");
check(paintTableMarks(el, "b", "Pages\t2", [anchor(0, 5, "plum")] as never, t), "a table whose cells keep blank text still paints");
check(el.querySelector("mark")?.textContent === "Pages", "the mark covers the cell's words, not its blank text");
el = block("<table><tr><td>Pages</td><td>3</td></tr></table>");
check(!paintTableMarks(el, "b", "Pages\t2", [anchor(0, 5, "plum")] as never, t), "a table whose words differ from its block text paints nothing (the ring stands in)");

const map = blankTolerantMap("\n Pages \n\t2", "Pages\t2");
check(map !== null && map(0, false) === 2 && map(5, true) === 7 && map(6, false) === 10, "the blank-tolerant map lands a passage on its words");
check(blankTolerantMap("Pages2x", "Pages\t2") === null, "the blank-tolerant map refuses other words");

// ── Define: one whole word ──────────────────────────────────────────────
check(!definableSelection("re", "", "aders remember"), 'Define is not offered on "re" of "readers"');
check(!definableSelection("g", "Readin", " shapes"), "Define is not offered on one letter of a word");
check(!definableSelection("Pages\t2", "Count\n", "\nNotes"), "Define is not offered on words across two cells");
check(definableSelection("readers", "the ", " remember"), "Define is offered on a whole word");
check(definableSelection("readers.", "the ", ""), "Define is offered on a word with its full stop");
check(definableSelection("Pages", "Count\n", "\t2"), "Define is offered on one cell's word");
check(definableSelection("Buddha", "the ", "'s words"), "Define is offered on a word before an apostrophe");
check(definableSelection("“Dhamma,”", "the ", " he"), "Define is offered on a quoted word");

check(defineWord("earned;") === "earned" && defineWord("“Dhamma,”") === "Dhamma", "Define's word drops the punctuation around it");
check(defineKey(" Earned; ") === "earned" && defineKey("earned") === "earned", "the word and the word with its semicolon share one lookup key");
check(defineWord("self-mortification") === "self-mortification" && defineWord("U.S.,") === "U.S." && defineWord("ends.") === "ends", "a hyphen inside stays; a full stop goes, but an abbreviation keeps its last dot");

console.log(failures === 0 ? "all checks pass" : `${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

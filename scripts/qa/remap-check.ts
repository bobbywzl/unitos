// Anchors through a block text edit (lib/anchors/remap.ts, SPEC.md §5): an
// edit moves the anchors after it, grows or shrinks the one it is in, and
// leaves every other anchor on its words — in a block of any length.
// Run: npx tsx scripts/qa/remap-check.ts
import { diffSegments, remapAnchor } from "@/lib/anchors/remap";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

/** The words an anchor on `quote` holds after `before` becomes `after`. */
function through(before: string, after: string, quote: string): string {
  const start = before.indexOf(quote);
  const moved = remapAnchor(diffSegments(before, after), after, { startOffset: start, endOffset: start + quote.length, quotedText: quote });
  return moved.orphaned ? "ORPHANED" : after.slice(moved.startOffset, moved.endOffset);
}

const short = "Search defaults decide the first query, and habit decides the rest.";
check("an edit before the anchor moves it", through(short, short.replace("Search", "Browser search"), "habit decides"), "habit decides");
check("an edit after the anchor leaves it", through(short, short.replace("the rest", "everything after"), "first query"), "first query");
check("an edit inside the anchor stays inside it", through(short, short.replace("first", "very first"), "the first query"), "the very first query");
check("the anchored words deleted orphan the anchor", through(short, short.replace(" habit decides", ""), "habit decides"), "ORPHANED");
check("the same text keeps every anchor", through(short, short, "decide the first"), "decide the first");

// A sheet of 3,000 rows is one block. One cell changed: the anchors on other
// cells keep their words, where the edit is before them and after them.
const rows = Array.from({ length: 3000 }, (_, r) => [`id${r}`, `name ${r}`, String(r * 7), `2026-01-${String((r % 28) + 1).padStart(2, "0")}`, r % 2 ? "yes" : "no", `note for row ${r}`].join("\t"));
const sheet = rows.join("\n");
const edited = sheet.replace("name 1500", "name 1500 QA");
check("a large sheet: an anchor before the edit", through(sheet, edited, "note for row 12"), "note for row 12");
check("a large sheet: an anchor after the edit", through(sheet, edited, "note for row 2900"), "note for row 2900");
check("a large sheet: an anchor on the edited cell", through(sheet, edited, "name 1500"), "name 1500 QA");
const rowGone = [...rows.slice(0, 100), ...rows.slice(101)].join("\n");
check("a large sheet: a row removed, an anchor under it", through(sheet, rowGone, "note for row 2000"), "note for row 2000");
check("a large sheet: a row removed, an anchor on it", through(sheet, rowGone, "name 100"), "ORPHANED");
const started = Date.now();
diffSegments(sheet, edited);
check("a large sheet diffs in under a second", Date.now() - started < 1000, true);

console.log(failed ? `\n${failed} failed` : "\nall ok");
process.exit(failed ? 1 : 0);

// A quote an edit adds to a note gets its source (lib/notes/added-quotes.ts,
// PATCH /api/notes/[noteId] with content): a quote the note's assistant's
// change adds, or one pasted whole, is found in the note's document; a quote
// the reader is typing, the note's own quotes, and a quote a source already
// covers get none. The check creates sources and never removes one.
// Run: npx tsx scripts/qa/added-quotes-check.ts
import { addedQuotes, anchorsOfQuote } from "@/lib/notes/added-quotes";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const blocks = [
  { id: "b1", text: "Onboarding revamp" },
  { id: "b2", text: "Data: 61% of new accounts never open a document. Of those who open one, 70% come back in the first week." },
  { id: "b3", text: "Omar: the first import of a 30-page PDF takes 41 seconds on average; 18% of people close the tab before it finishes." },
];
const own = { id: "s1", quotedText: "61% of new accounts never open a document." };

// ── Which quotes are added ──────────────────────────────────────────────
const before = "Most signups stall.\n\n> 61% of new accounts never open a document.";
const assistant = `${before}\n\nThe import is slow.\n\n> the first import of a 30-page PDF takes 41 seconds on average`;
check("the assistant's new quote is added", addedQuotes(before, assistant, [own]), ["the first import of a 30-page PDF takes 41 seconds on average"]);
check("the note's own quote, kept as it was, is not added", addedQuotes(before, `${before}\n\nMore later.`, [own]), []);
check("a quote a source already covers is not added", addedQuotes("Plain.", "Plain.\n\n> 61% of new accounts never open a document.", [own]), []);
check("a quote typed longer, save by save, is not added", addedQuotes("> the first imp", "> the first import of a 30-page PDF", []), []);
check("a quote cut shorter is not added", addedQuotes("> the first import of a 30-page PDF takes 41 seconds", "> the first import of a 30-page PDF", []), []);
check("a quote under 12 characters is not added", addedQuotes("", "> 41 seconds", []), []);
check(
  "two new quotes on adjacent runs are each added",
  addedQuotes("", "> 61% of new accounts never open a document.\n\nand\n\n> 18% of people close the tab before it finishes", []),
  ["61% of new accounts never open a document.", "18% of people close the tab before it finishes"],
);

// ── Where an added quote anchors ────────────────────────────────────────
const one = anchorsOfQuote("the first import of a 30-page PDF takes 41 seconds on average", blocks);
check("a quote anchors in the block that holds it", one.map((a) => [a.blockId, a.quotedText]), [["b3", "the first import of a 30-page PDF takes 41 seconds on average"]]);
check("its offsets cover the words", blocks[2].text.slice(one[0].startOffset, one[0].endOffset), one[0].quotedText);
check("its prefix is the 32 characters before", one[0].prefix, blocks[2].text.slice(Math.max(0, one[0].startOffset - 32), one[0].startOffset));
check(
  "curly quotes and emphasis around the words still anchor",
  anchorsOfQuote("“the first import of a **30-page PDF** takes 41 seconds”", blocks).map((a) => a.blockId),
  ["b3"],
);
check(
  "a quote over two blocks anchors once in each",
  anchorsOfQuote("61% of new accounts never open a document.\n18% of people close the tab before it finishes.", blocks).map((a) => a.blockId),
  ["b2", "b3"],
);
check(
  "a quote with an ellipsis anchors each piece",
  anchorsOfQuote("61% of new accounts never open a document … 70% come back in the first week", blocks).map((a) => a.quotedText),
  ["61% of new accounts never open a document", "70% come back in the first week"],
);
check("a quote no block holds anchors nowhere", anchorsOfQuote("the import takes two minutes for every reader", blocks), []);
check("a quote typed loosely in its spaces still anchors", anchorsOfQuote("18%  of people close\nthe tab", blocks).map((a) => a.blockId), ["b3"]);

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");

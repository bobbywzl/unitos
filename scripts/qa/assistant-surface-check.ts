// The checks around the assistant's answers, with no model (SPEC.md §6, §7):
// the actions block is held back whatever info string the model writes on
// it, the note's assistant takes out a quote the document does not hold,
// and the reader's notes reach the model whole up to the budget.
// Run: npx tsx scripts/qa/assistant-surface-check.ts
import { scanActionsFence, splitActionsFence } from "@/lib/assistant/fence";
import { checkNoteQuotes } from "@/lib/notes/assistant-check";
import { readerNotesText } from "@/lib/prompts/types";

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

// ── The actions block ───────────────────────────────────────────────────
const lead = "I'll reorganize the document into formal sections with headings, keeping every word of content unchanged.";
const json = '{"actions": [{"instruction": "Restructure the document for a clean, formal look with headings."}]}';
for (const info of ["actions", "json", "", "JSON", "javascript", "action"]) {
  const answer = `${lead}\n\n\`\`\`${info}\n${json}\n\`\`\``;
  const split = splitActionsFence(answer);
  check(split.text === lead && split.content === json, `a fence with info string "${info}" holding actions is split from the answer`);
}
check(splitActionsFence(`${lead}\n\n${json}`).content === json, "bare actions JSON on its own line is split from the answer");
const code = `${lead}\n\n\`\`\`python\nprint("hello")\n\`\`\``;
check(splitActionsFence(code).content === null && splitActionsFence(code).text === code, "a code fence that holds no actions stays in the answer");
const listJson = '[{"type": "comment", "blockId": "b1", "quote": "x", "comment": "y", "description": "z"}]';
check(splitActionsFence(`${lead}\n\`\`\`\n${listJson}\n\`\`\``).content === listJson, "a bare fence holding a list of actions is split");
// Streaming: a fence's first characters are held until the JSON says what it is.
const partial = `${lead}\n\n\`\`\`json\n{"act`;
const scan = scanActionsFence(partial, false);
check(scan !== null && "pending" in scan && scan.at === lead.length + 2, "a stream holds a fence whose JSON is not read yet");
const prose = `${lead}\n\n\`\`\` is how markdown opens code.`;
check(scanActionsFence(prose, false) === null, "three backticks followed by prose are not held");

// ── The note's assistant: quotes ────────────────────────────────────────
const document = [
  "Thus it can happen that a man's emphatic seriousness shows how superficial and modest his spirit has been all along when playing with knowledge.",
  "And does not everything that we take seriously betray us? It always shows what has weight for us and what does not.",
];
const before = "# S88\n\n> Thus it can happen that a man’s emphatic seriousness shows how superficial and modest his spirit has been all along\n\nSeriousness reveals our depth.";
const kept = "# Seriousness (S88)\n\n> Thus it can happen that a man’s emphatic seriousness shows how superficial and modest his spirit has been all along\n\n- Seriousness reveals our depth.";
check(checkNoteQuotes(kept, [before, ...document]).removed.length === 0, "a quote the note already held stays");
const added = `${kept}\n\n> And does not everything that we take *seriously* betray us?`;
check(checkNoteQuotes(added, [before, ...document]).removed.length === 0, "a new quote copied from the document stays, emphasis and all");
const skipping = `${kept}\n\n> And does not everything … betray us? It always shows what has weight for us`;
check(checkNoteQuotes(skipping, [before, ...document]).removed.length === 0, "a quote that skips words with an ellipsis stays");
const invented = `${kept}\n\n> Seriousness is the mask every philosopher wears in public.\n\nMore of the reader's words.`;
const result = checkNoteQuotes(invented, [before, ...document]);
check(result.removed.length === 1, "a quote the document does not hold is taken out");
check(!result.content.includes("mask every philosopher") && result.content.includes("More of the reader's words."), "only the quote goes; the words around it stay");
check(!/\n{3,}/.test(result.content), "the gap the quote leaves is one blank line");
const reworded = `${kept}\n\n> And doesn't all we take seriously betray us?`;
check(checkNoteQuotes(reworded, [before, ...document]).removed.length === 1, "a reworded quote is taken out");

// ── The reader's notes ──────────────────────────────────────────────────
const notes = Array.from({ length: 30 }, (_, i) => ({ sectionTitle: "Book Two", content: `Note ${i} `.padEnd(2500, "x") }));
const text = readerNotesText(notes);
check(text.includes("Note 0 ") && text.includes("Note 14 "), "notes go in whole, up to the budget");
check(/\[\d+ more notes not shown\]$/.test(text), "a cut is declared, never silent");
check(readerNotesText([]) === "none yet", "no notes reads as none yet");
const long = readerNotesText([{ sectionTitle: "A", content: "y".repeat(5000) }]);
check(long.endsWith("[cut]"), "a note past its length is cut with a mark");

console.log(failures === 0 ? "\nall checks pass" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

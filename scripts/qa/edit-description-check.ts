import { changedSpans } from "@/lib/assistant/diff-window";
import { editDescription } from "@/lib/assistant/revise";
import { translatorFor } from "@/lib/i18n/dictionaries";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
check("one word", changedSpans("the numbers are right", "these numbers are right"), [{ before: "the", after: "these" }]);
check("two places", changedSpans("We stop noticing them the way we stop noticing a hum. Ours run on pumps.", "People stop noticing them the way they stop noticing a hum. The cities of today run on pumps."), [
  { before: "We", after: "People" },
  { before: "we", after: "they" },
  { before: "Ours", after: "The cities of today" },
]);
check("words removed", changedSpans("a little context on either side", "context on either side"), [{ before: "a little", after: "" }]);
check("words added", changedSpans("the margin held", "the margin held last quarter"), [{ before: "", after: "last quarter" }]);
check("no change", changedSpans("same words", "same  words"), []);
check("near spans merge", changedSpans("one two three four five six", "uno two tres four cinco six"), [{ before: "one two three four five", after: "uno two tres four cinco" }]);
const t = translatorFor("en");
check("a one-word span reads as its sentence", editDescription(t, "Look up on any street. I think the wires are ugly. They hum.", "Look up on any street. This essay holds that the wires are ugly. They hum."), 'Change “I think the wires are ugly.” to “This essay holds that the wires are ugly.”.');
check("a clause added to a sentence reads as the sentence", editDescription(t, "The margin held at 7.6 percent in the quarter.", "The margin held at 7.6 percent in the quarter, down from 9 a year earlier."), 'Change “The margin held at 7.6 percent in the quarter.” to “The margin held at 7.6 percent in the quarter, down from 9 a year earlier.”.');
check("a longer span reads as itself", editDescription(t, "We stop noticing them the way we stop noticing a hum.", "People stop noticing them the way they stop noticing a hum."), 'Change “We stop noticing them the way we stop noticing a hum.” to “People stop noticing them the way they stop noticing a hum.”.');
console.log(failed === 0 ? "all checks pass" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

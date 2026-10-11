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
check("a one-word span reads as its sentence", editDescription(t, "Look up on any street. I think the wires are ugly. They hum.", "Look up on any street. This essay holds that the wires are ugly. They hum."), 'Change “I think the wires are ugly.” to “This essay holds that the wires are ugly.”');
check("a clause added to a sentence reads as the sentence", editDescription(t, "The margin held at 7.6 percent in the quarter.", "The margin held at 7.6 percent in the quarter, down from 9 a year earlier."), 'Change “The margin held at 7.6 percent in the quarter.” to “The margin held at 7.6 percent in the quarter, down from 9 a year earlier.”');
check("two short spans of one sentence read as the sentence once", editDescription(t, "We stop noticing them the way we stop noticing a hum.", "People stop noticing them the way they stop noticing a hum."), 'Change “We stop noticing them the way we stop noticing a hum.” to “People stop noticing them the way they stop noticing a hum.”');
check(
  "spans in two sentences read as themselves, a short one with a few words around it",
  editDescription(t, "I will take the first view. The city is old. I do not want to wave it away.", "This essay takes the first view. The city is old. It should not be dismissed."),
  'Change “I will take” to “This essay takes” and “I do not want to wave it away.” to “It should not be dismissed.”',
);
check(
  "the same word changed three times reads as the shortest phrase that names each place, the words before it first",
  editDescription(t, "A batch takes 1 token, not 50. Reads cost 50 tokens as single requests. A write costs 1 token as a batch.", "A batch takes 1 credit, not 50. Reads cost 50 credits as single requests. A write costs 1 credit as a batch."),
  'Change “takes 1 token” to “takes 1 credit”, “tokens” to “credits”, and “costs 1 token” to “costs 1 credit”.',
);
check(
  "a change in a long sentence reads as the shortest phrase around it, never stopping inside a bracket",
  editDescription(t, "Each response carries X-RateLimit-Limit (the bucket size), X-RateLimit-Remaining (tokens left), and X-RateLimit-Reset (seconds until full).", "Each response carries X-RateLimit-Limit (the bucket size), X-RateLimit-Remaining (credits left), and X-RateLimit-Reset (seconds until full)."),
  'Change “X-RateLimit-Remaining (tokens left)” to “X-RateLimit-Remaining (credits left)”.',
);
check(
  "a rewrite's opening is cut at a whole word",
  editDescription(t, "Each side must give something in exchange for the other's promise, and the law calls that consideration.", "Both sides must trade something of value; the law calls this consideration, and a promise with nothing given back binds no one."),
  'Rewrite the paragraph that starts “Each side must give something in…”.',
);
check(
  "many small changes that keep most of the words name the three largest and count the rest",
  editDescription(
    t,
    "Overhead lines are exposed to everything the weather and the road can throw at them. Wind snaps branches onto the wires, and a single car can take down a pole. When a branch lands on the line, every customer downstream goes dark until a crew arrives. Crews can't start work until the road is clear, and that takes a lot of time.",
    "Overhead lines are exposed to everything that the weather and the road can inflict on them. Wind snaps branches onto the wires, and a single car can topple a pole. When a branch lands on the line, every customer downstream loses power until a crew arrives. Crews cannot start work until the road is clear, and that takes considerable time.",
  ),
  'Change “throw at” to “inflict on”, “goes dark” to “loses power”, “a lot of” to “considerable”, and 3 more changes.',
);
check(
  "words only added read with the word before them, so a few changes are each named, never a rewrite",
  editDescription(
    t,
    "Overhead lines are exposed to everything the weather and the road can throw at them. Wind snaps branches onto the wires, ice loads the spans until they sag or break, and a single car can take down a pole and the power to a whole block.",
    "Overhead lines are exposed to every hazard that the weather and the road can pose. Wind snaps branches onto the wires, ice loads the spans until they sag or break, and a single car can topple a pole and cut the power to a whole block.",
  ),
  'Change “everything” to “every hazard that”, “throw at them.” to “pose.”, “take down” to “topple”, and “pole and” to “pole and cut”.',
);
check(
  "a change's new words stay whole",
  editDescription(
    t,
    "Poles also take up space, and a street with space to spare looks better and works better. The strip can hold a bench or a bike rack, chosen for their looks.",
    "Poles also occupy space, and a street with space to spare is more attractive and more functional. The strip can hold a bench or a bicycle rack, chosen for their appearance.",
  ),
  'Change “take up” to “occupy”, “looks better and works better.” to “is more attractive and more functional.”, “bike” to “bicycle”, and “their looks” to “their appearance”.',
);
check(
  "a rewrite that grows by half names its length",
  editDescription(
    t,
    "Each side must give something in exchange for the other's promise: a promise, an act, or a forbearance. The courts ask only whether the exchange exists, not whether it is fair. In Chappell & Co v Nestlé (1960), three chocolate wrappers were part of the price of a record. Past consideration does not count: a promise to pay for work already finished, with no request beforehand, is a gift.",
    "Each side must give something in exchange for the other's promise. That something is called consideration. It can be a promise, an act, or a forbearance, which means choosing not to do something. The courts ask only whether the exchange exists, not whether it is fair. Chappell & Co v Nestlé (1960) shows that the exchange does not have to be fair: three chocolate wrappers were part of the price of a record. Past consideration, meaning something done before the promise was made, does not count. A promise to pay for work already finished, if nobody asked for the work beforehand, is a gift.",
  ),
  'Rewrite the paragraph that starts “Each side must give something in…”, from 69 words to 104.',
);
console.log(failed === 0 ? "all checks pass" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

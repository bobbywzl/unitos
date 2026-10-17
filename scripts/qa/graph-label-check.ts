// The label-start check (VIEW4-05, SPEC.md §13): titles that share a long
// start keep a short head of it and the words that differ; other titles keep
// their own label.
//   npx tsx scripts/qa/graph-label-check.ts
import { labelStarts } from "@/lib/graph/label-start";

let failed = 0;
function expect(name: string, titles: string[], want: (string | null)[]) {
  const got = labelStarts(titles);
  titles.forEach((t, i) => {
    const g = got.get(i) ?? null;
    const ok = g === want[i];
    if (!ok) failed++;
    console.log(`${ok ? "pass" : "FAIL"} ${name}: ${JSON.stringify(t)} -> ${JSON.stringify(g)}${ok ? "" : ` (want ${JSON.stringify(want[i])})`}`);
  });
}

expect(
  "book chapters",
  ["Beyond Good and Evil — I. Prejudices of Philosophers", "Beyond Good and Evil — II. The Free Spirit", "Beyond Good and Evil — Preface", "On Suicide"],
  ["Beyond Good… I. Prejudices of Philosophers", "Beyond Good… II. The Free Spirit", "Beyond Good… Preface", null],
);
expect(
  "parts",
  ["Thus Spake Zarathustra — First Part", "Thus Spake Zarathustra — Fourth Part", "Ludovici: Notes on Thus Spake Zarathustra"],
  ["Thus Spake… First Part", "Thus Spake… Fourth Part", null],
);
expect(
  "parentheses",
  ["Psychological Observations (Studies in Pessimism)", "Psychological Observations (The Art of Controversy)"],
  ["Psychological… (Studies in Pessimism)", "Psychological… (The Art of Controversy)"],
);
expect("short start kept", ["On Noise", "On Education", "On the Sufferings of the World"], [null, null, null]);
expect("a title that begins another", ["The Wisdom of Life", "The Wisdom of Life — I. Division of the Subject"], [null, null]);
expect("same titles", ["Stitched page", "Stitched page"], [null, null]);
expect("short rest", ["Collected lecture notes part 1", "Collected lecture notes part 2"], ["Collected… part 1", "Collected… part 2"]);
expect(
  "zh",
  ["叔本华作品集：意志与表象的世界", "叔本华作品集：人生的智慧", "永恒轮回"],
  ["叔本华作…意志与表象的世界", "叔本华作…人生的智慧", null],
);
console.log(failed ? `${failed} FAIL` : "all pass");
process.exit(failed ? 1 : 0);

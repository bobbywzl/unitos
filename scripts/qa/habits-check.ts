import { askKind, habitsOf, type Ask } from "@/lib/assistant/habits";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
check("a proofread", askKind("Fix spelling and grammar across the document."), "proofread");
check("a summary", askKind("Summarize this section in five bullet points"), "summary");
check("a study guide", askKind("Make a study guide from these notes"), "study guide");
check("a translation in Chinese", askKind("把这一段翻译成英文"), "translate");
check("a question is no habit", askKind("What does the author mean by slow reading?"), null);
check("a confirmation is no habit", askKind("ok do it"), null);
check("a block tag is not a word", askKind("[block abc-b3] shorten this by a third"), "shorten");

const day = 86_400_000;
const now = new Date("2026-10-10T12:00:00Z");
const ask = (text: string, documentId: string, daysAgo: number, notebookId = "n1"): Ask => ({ text, documentId, notebookId, at: new Date(now.getTime() - daysAgo * day) });
check(
  "three asks on two documents are a habit, in the newest words",
  habitsOf([ask("fix the spelling here", "d1", 1), ask("Fix spelling and grammar across the document.", "d2", 5), ask("proofread this", "d1", 20)], now),
  [{ kind: "proofread", text: "Fix spelling and grammar across the document.", count: 3 }],
);
check("three asks on one document are not", habitsOf([ask("summarize this", "d1", 1), ask("summary please", "d1", 2), ask("key points", "d1", 3)], now), []);
check("two asks are not", habitsOf([ask("translate this", "d1", 1), ask("translate this", "d2", 2)], now), []);
check("old asks do not count", habitsOf([ask("translate this", "d1", 70), ask("translate this", "d2", 80), ask("translate this", "d3", 90)], now), []);
check(
  "the most asked first, at most three",
  habitsOf(
    [
      ...["d1", "d2", "d3", "d4"].map((d, i) => ask("make a study guide", d, i + 1)),
      ...["d1", "d2", "d3"].map((d, i) => ask("summarize the document", d, i + 1)),
      ...["d1", "d2", "d3"].map((d, i) => ask("translate the document", d, i + 1)),
      ...["d1", "d2", "d3"].map((d, i) => ask("make an outline", d, i + 10)),
    ],
    now,
  ).map((h) => h.kind),
  ["study guide", "summary", "translate"],
);
console.log(failed === 0 ? "habits-check: all passed" : `habits-check: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

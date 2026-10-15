// Auto thinking's reading of messages (lib/assistant/depth.ts), checked with
// no model: a lookup, a one-place change, and a confirmation run low; a
// question of meaning runs high; a change across the document, a comparison,
// or several asks run max. Run: npx tsx scripts/qa/depth-check.ts
import { chooseDepth, type Depth, type DepthInput } from "@/lib/assistant/depth";

const cases: { input: DepthInput; want: Depth | Depth[] }[] = [
  { input: { message: "yes do it" }, want: "low" },
  { input: { message: "ok, go ahead" }, want: "low" },
  { input: { message: "Where does the memo give the margin?" }, want: "low" },
  { input: { message: "Who dissented?" }, want: "low" },
  { input: { message: "Highlight the sentence where induced demand is defined." }, want: "low" },
  { input: { message: "Bold the words \"Core inflation\" where the article defines the term." }, want: "low" },
  { input: { message: "Rename the speaker Tomas to Tomás." }, want: "low" },
  { input: { message: "Delete the paragraph about the fleet cut removing capacity." }, want: "low" },
  { input: { message: "What two habits does the author recommend?" }, want: ["low", "medium"] },
  { input: { message: "Is the margin recovery real?" }, want: ["medium", "high"] },
  { input: { message: "Why does this matter for the decision?" }, want: "high" },
  { input: { message: "Explain the retention loss for a first-year student." }, want: "high" },
  { input: { message: "In the Alder and Birch example, when was the contract formed, and why does the revocation fail?" }, want: "high" },
  { input: { message: "Shorten the two paragraphs under \"The numbers\" to one sentence each. Keep every figure." }, want: ["medium", "high"] },
  { input: { message: "Fix the spelling and grammar mistakes in the essay. Change nothing else." }, want: ["medium", "high"] },
  { input: { message: "Make the whole essay more formal: no first person, no contractions, and keep every number." }, want: "max" },
  { input: { message: "Reorganize the essay: group the paragraphs by theme and add a heading for each group." }, want: ["high", "max"] },
  { input: { message: "Write a summary document of this lecture for my midterm: the argument with its numbers, the three cases, the two objections with the lecturer's answers, and induced demand, each part with the lecturer's own words quoted." }, want: "max" },
  { input: { message: "Where do my notes contradict each other?", scope: "notebook" }, want: "max" },
  { input: { message: "Compare how the two papers define attention and say which the memo relies on." }, want: ["high", "max"] },
  { input: { message: "Summarize this and then list the open questions; also add a note for each.", attachments: 0 }, want: ["high", "max"] },
  { input: { message: "What does this chart show?", attachments: 1 }, want: ["high", "max"] },
  { input: { message: "作者认为监管应该用什么工具？" }, want: ["medium", "high"] },
  { input: { message: "把结论一段翻译成英文。" }, want: ["low", "medium"] },
  { input: { message: "把说明长尾商家受损的句子高亮出来。" }, want: "low" },
  { input: { message: "整篇文章重新组织，按主题分组并加标题。" }, want: ["high", "max"] },
];

let failures = 0;
for (const c of cases) {
  const got = chooseDepth(c.input);
  const wanted = Array.isArray(c.want) ? c.want : [c.want];
  const ok = wanted.includes(got.depth);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${got.depth.padEnd(6)} ${wanted.join("/").padEnd(10)} ${c.input.message.slice(0, 70)}${got.signals.length ? `  [${got.signals.join(", ")}]` : ""}`);
}
console.log(failures === 0 ? "depth check: all ok" : `depth check: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

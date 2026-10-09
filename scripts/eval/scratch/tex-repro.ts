import { blockPlaces, resolveOps, wordsScope } from "@/lib/docs/suggest-ops";

const text = "Both entries in your mental dictionary—$\\text{Bank}_1$ (money) and $\\text{Bank}_2$ (river)—are equally and automatically activated, regardless of the sentence topic.";
const doc = { type: "doc", content: [{ type: "paragraph", attrs: { blockId: "b1" }, content: [{ type: "text", text }] }] };
const places = blockPlaces(doc as never);
const rows = [{ id: "b1", type: "PARAGRAPH", text }] as never;
const scope = wordsScope(rows, [{ blockId: "b1", startOffset: 0, endOffset: text.length }]);
const run = (label: string, find: string, replacement: string) => {
  const out = resolveOps([{ op: "replace_words", blockId: "b1", find, text: replacement, why: "" } as never], { rows, places, scope, budget: { chars: 10_000 } });
  console.log(label, "→ ops", out.ops.length, "skipped", JSON.stringify(out.skipped));
};
run("exact find        ", "$\\text{Bank}_1$", "Bank₁");
run("tab from JSON \\t  ", JSON.parse('"$\\text{Bank}_1$"'), "Bank₁");
run("tex→tex exact     ", "$\\text{Bank}_1$", "$\\mathrm{Bank}_1$");
run("tex→tex tab in new", "$\\text{Bank}_1$", JSON.parse('"$\\textbf{Bank}_1$"'));
run("tex→tex \\b in new ", "$\\text{Bank}_1$", JSON.parse('"$\\beta_1$"'));
console.log("JSON.parse of unescaped \\text:", JSON.stringify(JSON.parse('"$\\text{Bank}_1$"')));
try { JSON.parse('"$\\mathrm{Bank}_1$"'); } catch (e) { console.log("unescaped \\mathrm in JSON:", (e as Error).message); }

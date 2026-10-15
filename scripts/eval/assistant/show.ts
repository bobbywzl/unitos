// A fixture's blocks whole: npx tsx scripts/eval/assistant/show.ts <fixture> [n …]
import "../env";
import { loadFixtures } from "../lib";
const [name, ...nums] = process.argv.slice(2);
const f = loadFixtures().get(name);
if (!f) throw new Error(`no fixture ${name}`);
const want = new Set(nums.map(Number));
f.blocks.forEach((b, i) => {
  if (want.size && !want.has(i + 1)) return;
  console.log(`-- ${i + 1} ${b.type}${b.speaker ? ` @${b.speaker}` : ""}\n${b.text}`);
});

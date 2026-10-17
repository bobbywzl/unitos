// The fixtures' block maps, for writing cases: npx tsx scripts/eval/assistant/blocks.ts [fixture …]
import "../env";
import { loadFixtures } from "../lib";
const want = process.argv.slice(2);
for (const [name, f] of loadFixtures()) {
  if (want.length && !want.includes(name)) continue;
  console.log(`== ${name}: ${f.title} (${f.blocks.length} blocks)`);
  f.blocks.forEach((b, i) => console.log(`${String(i + 1).padStart(2)} ${b.type.padEnd(10)} ${b.speaker ? `@${b.speaker} ` : ""}${b.text.replace(/\s+/g, " ").slice(0, 110)}`));
}

// The blocks of a fixture by their order, for writing a case's selection:
//   npx tsx scripts/eval/visualize/blocks.ts <fixture> [n …]
// Without numbers, one line per block; with numbers, those blocks whole.
import "../env";
import { loadFixtures } from "../lib";

const [name, ...nums] = process.argv.slice(2);
const f = loadFixtures().get(name);
if (!f) throw new Error(`no fixture ${name}`);
if (nums.length === 0) f.blocks.forEach((b, i) => console.log(`${i + 1} ${b.type} ${b.text.replace(/\s+/g, " ").slice(0, 110)}`));
else for (const n of nums) console.log(`--- ${n}\n${f.blocks[Number(n) - 1].text}\n`);

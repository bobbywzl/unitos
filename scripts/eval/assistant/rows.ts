// The rows of a suggestion fixture by number, for writing cases: a document
// with rich text is indexed one row per paragraph, heading, and list line
// (richtext.ts), and a case's `block: n` counts these rows.
//   npx tsx scripts/eval/assistant/rows.ts <fixture>
import "../env";
import { loadFixtures } from "../lib";
import { suggestionRows } from "./richtext";

const name = process.argv[2];
const f = loadFixtures().get(name ?? "");
if (!f) {
  console.error(`fixture ${name} is missing`);
  process.exit(1);
}
const rows = suggestionRows(f);
console.log(`== ${f.name}: ${f.title} (${rows.length} rows from ${f.blocks.length} blocks)`);
rows.forEach((r, i) => console.log(`${String(i + 1).padStart(3)} ${r.id.padEnd(26)} ${r.type.padEnd(9)} ${r.text.replace(/\s+/g, " ").slice(0, 110)}`));

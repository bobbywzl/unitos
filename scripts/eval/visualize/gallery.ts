// The Visualize loop's gallery data: every input and output of a round, for
// the page a person reviews and rates them on (scripts/eval/visualize/
// gallery.html, published as an Artifact). One file per round with the
// pictures inline, and an index of rounds with their tables and findings.
//
//   npx tsx scripts/eval/visualize/gallery.ts --round r0 --variants base[,cand]
import "../env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFixtures, selectionOf } from "../lib";
import { VIZ_CASES } from "./cases";
import type { Result } from "./run";
import { VARIANTS } from "./variants";

const VIZ_ROOT = join(process.cwd(), ".eval", "viz");
const OUT = join(VIZ_ROOT, "gallery", "data");

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] ?? "");
};
const round = flag("round") ?? "r0";
const variants = (flag("variants") ?? "base").split(",").filter(Boolean);

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

const fixtures = loadFixtures();
const cases = [];
for (const c of VIZ_CASES) {
  const f = fixtures.get(c.fixture);
  if (!f) continue;
  const jdir = join(VIZ_ROOT, round, "judge", c.id);
  const map = readJson<Record<string, string>>(join(jdir, "map.json")) ?? {};
  const scores = readJson<Record<string, unknown>>(join(jdir, "scores.json")) ?? {};
  const takeaways = readJson<Record<string, string>>(join(jdir, "takeaway.json")) ?? {};
  const labelOf = Object.fromEntries(Object.entries(map).map(([label, v]) => [v, label]));
  const outputs = [];
  for (const v of variants) {
    const dir = join(VIZ_ROOT, round, v, c.id);
    const r = readJson<Result>(join(dir, "result.json"));
    if (!r) continue;
    const label = labelOf[v];
    const svg = existsSync(join(dir, "final.svg")) ? readFileSync(join(dir, "final.svg"), "utf8") : null;
    const draft = r.check === "replace" && existsSync(join(dir, "draw.svg")) ? readFileSync(join(dir, "draw.svg"), "utf8") : null;
    outputs.push({
      variant: v,
      outcome: r.outcome,
      declinedBy: r.declinedBy,
      reason: r.reason,
      kind: r.kind,
      caption: r.caption,
      structure: r.structure,
      check: r.check,
      checkReason: r.checkReason,
      issues: r.issues,
      efficiency: r.efficiency,
      svg,
      draft,
      score: label ? (scores[label] ?? null) : null,
      takeaway: label ? (takeaways[label] ?? null) : null,
    });
  }
  if (outputs.length === 0) continue;
  const block = f.blocks[c.selection.block - 1];
  const sel = selectionOf(f, c.selection);
  const preference = typeof scores.preference === "string" ? (scores.preference === "tie" ? "tie" : (map[scores.preference] ?? null)) : null;
  cases.push({
    id: c.id,
    fixture: c.fixture,
    title: f.title,
    lang: c.lang,
    reader: c.profile ? [c.profile.background, c.profile.purpose].filter(Boolean).join(" ") : null,
    expect: c.expect,
    kinds: c.kinds ?? [],
    good: c.good,
    block: { text: block.text, start: sel.startOffset, end: sel.endOffset },
    preference,
    why: typeof scores.why === "string" ? scores.why : null,
    outputs,
  });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${round}.json`), JSON.stringify({ round, variants: variants.map((v) => ({ id: v, note: VARIANTS[v]?.note ?? "" })), cases }));

// The index: every round with its table and findings.
const indexPath = join(OUT, "index.json");
const index = readJson<{ rounds: { id: string; title: string; summary: unknown; findings: string }[] }>(indexPath) ?? { rounds: [] };
const findingsPath = join(process.cwd(), "scripts", "eval", "visualize", "rounds", `${round}.md`);
const findings = existsSync(findingsPath) ? readFileSync(findingsPath, "utf8") : "";
const title = findings.match(/^# (.+)$/m)?.[1] ?? `Round ${round}`;
const entry = { id: round, title, summary: readJson(join(VIZ_ROOT, round, "summary.json")), findings };
index.rounds = [...index.rounds.filter((r) => r.id !== round), entry].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
writeFileSync(indexPath, JSON.stringify(index));
console.log(`gallery data: ${join(OUT, `${round}.json`)} (${cases.length} cases)`);

// The Visualize loop's runner (SPEC.md §20, §25). The model and the judge are
// outside this script: an agent reads each prompt file and writes the
// answer, so any Claude session can stand in for VISUALIZE_MODEL. This
// script builds the prompts exactly as the route does, validates and renders
// the answers with the route's own code, draws them in Chromium at the
// card's width, and scores the judges' answers. One directory per round and
// variant: .eval/viz/<round>/<variant>/<case>/.
//
//   npx tsx scripts/eval/visualize/run.ts prepare --round r0 --variant base [--cases a,b]
//   … an agent answers prompt.md with draw.json in each case directory …
//   npx tsx scripts/eval/visualize/run.ts draw --round r0 --variant base
//   … an agent answers check-prompt.md with check.json …
//   npx tsx scripts/eval/visualize/run.ts final --round r0 --variant base
//   npx tsx scripts/eval/visualize/run.ts judge --round r0 --variants base[,cand]
//   … an agent reads judge/<case>/A.md, then B.md, and writes takeaway.json, scores.json …
//   npx tsx scripts/eval/visualize/run.ts score --round r0 --variants base[,cand]
//   npx tsx scripts/eval/visualize/run.ts batches --round r0 --variant base --file prompt.md --size 5
import "../env";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "@/lib/derive/json";
import {
  renderVisual,
  visualizeCheckSchema,
  visualizeOutputSchema,
  type Visual,
} from "@/lib/derive/visualize";
import { fixturePrefix, loadFixtures, promptCtx } from "../lib";
import { VIZ_CASES, type VizCase } from "./cases";
import { lintLines, openBrowser, rasterize, type Lint } from "./raster";
import { PICTURE_KEYS, VIZ_CRITERIA } from "./rubric";
import { variantOf } from "./variants";

export const VIZ_ROOT = join(process.cwd(), ".eval", "viz");

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] ?? "");
};
const round = flag("round") ?? "r0";
const casesWanted = flag("cases")?.split(",").filter(Boolean) ?? null;
const differingOnly = args.includes("--differing");

const SYSTEM = "=====[SYSTEM]=====";
const USER = "=====[USER]=====";

function cases(): VizCase[] {
  return VIZ_CASES.filter((c) => !casesWanted || casesWanted.includes(c.id));
}

// A variant is a directory of this round, or "<round>/<variant>" for one of
// another round: a renderer change is judged against the round before it
// with the same answers.
function dirOf(variant: string, id: string): string {
  return variant.includes("/") ? join(VIZ_ROOT, variant, id) : join(VIZ_ROOT, round, variant, id);
}

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

// ── prepare: the draw prompt, as the route sends it ────────────────────────
function prepare(variantId: string, dirName: string): void {
  const variant = variantOf(variantId);
  const fixtures = loadFixtures();
  let n = 0;
  for (const c of cases()) {
    const f = fixtures.get(c.fixture);
    if (!f) throw new Error(`fixture ${c.fixture} is missing`);
    const ctx = promptCtx(f, { profile: c.profile, lang: c.lang, selection: c.selection });
    const dir = dirOf(dirName, c.id);
    mkdirSync(dir, { recursive: true });
    const system = fixturePrefix(f);
    const user = variant.draw(ctx);
    writeFileSync(join(dir, "prompt.md"), [SYSTEM, system, "", USER, user, ""].join("\n"));
    writeJson(join(dir, "case.json"), { ...c, title: f.title, passage: ctx.anchoredText, variant: variantId, round });
    n++;
  }
  console.log(`prepared ${n} cases in ${join(VIZ_ROOT, round, dirName)}`);
}

type Stage = {
  status: "invalid" | "declined" | "render-error" | "drawn";
  reason?: string;
  visual?: Visual;
  error?: string;
};

// ── draw: validate and render the draw pass; write the check prompt ────────
async function draw(variantId: string, dirName: string): Promise<void> {
  const variant = variantOf(variantId);
  const browser = await openBrowser();
  try {
    for (const c of cases()) {
      const dir = dirOf(dirName, c.id);
      const raw = readText(join(dir, "draw.json"));
      if (raw === null) {
        console.log(`${c.id}: no draw.json`);
        continue;
      }
      const parsed = parseJson(visualizeOutputSchema, raw);
      let stage: Stage;
      if (!parsed) stage = { status: "invalid", error: "draw.json does not match the output contract" };
      else if (!parsed.judgment.certain || !parsed.visual) stage = { status: "declined", reason: parsed.judgment.reason };
      else {
        const rendered = await renderVisual(parsed.visual);
        if ("error" in rendered) stage = { status: "render-error", error: rendered.error, visual: parsed.visual };
        else {
          stage = { status: "drawn", visual: parsed.visual };
          writeFileSync(join(dir, "draw.svg"), rendered.svg);
          const lint = await rasterize(browser, rendered.svg, { png: join(dir, "draw.png"), frames: join(dir, "draw-frames.png") }, { modelDrawn: modelDrawn(parsed.visual) });
          writeJson(join(dir, "draw-lint.json"), lint);
          if (variant.check) {
            const prompt = readFileSync(join(dir, "prompt.md"), "utf8");
            const simulation = parsed.visual.kind === "simulation";
            const moving = existsSync(join(dir, "draw-frames.png"));
            // What the check sees besides its prompt (Variant.checkSees): the
            // SVG source as production does, or the picture as drawn — the
            // still, and four moments of a picture that moves — with or
            // without the source.
            const seesSvg = variant.checkSees === "svg" || (variant.checkSees === "both" && modelDrawn(parsed.visual));
            const checkText = variant.check({
              lang: c.lang,
              passage: JSON.parse(readFileSync(join(dir, "case.json"), "utf8")).passage,
              kind: parsed.visual.kind,
              caption: parsed.visual.caption.trim(),
              spec: parsed.visual.diagram
                ? JSON.stringify(parsed.visual.diagram)
                : parsed.visual.simulation
                  ? JSON.stringify(parsed.visual.simulation)
                  : null,
              svg: simulation || !seesSvg ? null : rendered.svg,
              findings: lintLines(lint),
              moving,
            });
            const image =
              variant.checkSees !== "svg"
                ? [`=====[IMAGE: ${join(dir, "draw.png")}]=====`, ...(moving ? [`=====[IMAGE: ${join(dir, "draw-frames.png")}]=====`] : [])]
                : [];
            writeFileSync(join(dir, "check-prompt.md"), [prompt.trimEnd(), "", USER, checkText, ...image, ""].join("\n"));
          }
        }
      }
      writeJson(join(dir, "draw-stage.json"), stage);
      console.log(`${c.id}: ${stage.status}${stage.error ? ` (${stage.error})` : ""}`);
    }
  } finally {
    await browser.close();
  }
}

function modelDrawn(visual: Visual): boolean {
  return visual.kind === "picture" || visual.kind === "animation";
}

export type Result = {
  id: string;
  variant: string;
  outcome: "invalid" | "declined" | "render-error" | "drawn";
  declinedBy: "draw" | "check" | null;
  reason: string | null;
  kind: string | null;
  caption: string | null;
  structure: string | null;
  check: "keep" | "replace" | "withdraw" | "failed" | "none" | "replace-not-rendered";
  checkReason: string | null;
  lint: Lint | null;
  issues: string[];
  efficiency: { promptChars: number; drawChars: number; checkChars: number; outTokens: number; calls: number; svgBytes: number };
};

// Tokens from characters: about 3.5 per token for English and JSON, about
// 1.2 for Chinese. An estimate — the agent does not report its usage.
function tokens(text: string): number {
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  return Math.round(cjk / 1.2 + (text.length - cjk) / 3.5);
}

// ── final: apply the check, render what stands, draw it, lint it ───────────
async function final(variantId: string): Promise<void> {
  // variantId here is the directory: the check's answer is already in it.
  const browser = await openBrowser();
  try {
    for (const c of cases()) {
      const dir = dirOf(variantId, c.id);
      const stageRaw = readText(join(dir, "draw-stage.json"));
      if (!stageRaw) continue;
      const stage = JSON.parse(stageRaw) as Stage;
      const drawRaw = readText(join(dir, "draw.json")) ?? "";
      const drawParsed = parseJson(visualizeOutputSchema, drawRaw);
      const checkRaw = readText(join(dir, "check.json"));
      const promptChars = (readText(join(dir, "prompt.md")) ?? "").length;
      const result: Result = {
        id: c.id,
        variant: variantId,
        outcome: stage.status,
        declinedBy: stage.status === "declined" ? "draw" : null,
        reason: stage.reason ?? stage.error ?? null,
        kind: stage.visual?.kind ?? null,
        caption: stage.visual?.caption.trim() ?? null,
        structure: drawParsed?.judgment.structure ?? null,
        check: "none",
        checkReason: null,
        lint: null,
        issues: [],
        efficiency: {
          promptChars,
          drawChars: drawRaw.length,
          checkChars: checkRaw?.length ?? 0,
          outTokens: tokens(drawRaw) + tokens(checkRaw ?? ""),
          calls: checkRaw ? 2 : 1,
          svgBytes: 0,
        },
      };
      let visual = stage.visual ?? null;
      let svg = stage.status === "drawn" ? readText(join(dir, "draw.svg")) : null;
      if (stage.status === "drawn" && checkRaw !== null) {
        const checked = parseJson(visualizeCheckSchema, checkRaw);
        if (!checked) result.check = "failed";
        else if (checked.keep) {
          result.check = "keep";
          result.checkReason = checked.reason;
        } else if (!checked.visual) {
          result.check = "withdraw";
          result.checkReason = checked.reason;
          result.outcome = "declined";
          result.declinedBy = "check";
          result.reason = checked.reason;
          visual = null;
          svg = null;
        } else {
          const again = await renderVisual(checked.visual);
          result.checkReason = checked.reason;
          if ("error" in again) result.check = "replace-not-rendered";
          else {
            result.check = "replace";
            visual = checked.visual;
            svg = again.svg;
          }
        }
      }
      if (visual && svg) {
        result.kind = visual.kind;
        result.caption = visual.caption.trim();
        writeFileSync(join(dir, "final.svg"), svg);
        const lint = await rasterize(browser, svg, { png: join(dir, "final.png"), frames: join(dir, "frames.png") }, { modelDrawn: modelDrawn(visual) });
        result.lint = lint;
        result.issues = lintLines(lint);
        result.efficiency.svgBytes = svg.length;
      }
      writeJson(join(dir, "result.json"), result);
      console.log(`${c.id}: ${result.outcome}${result.kind ? ` ${result.kind}` : ""} check=${result.check} issues=${result.issues.length}`);
    }
  } finally {
    await browser.close();
  }
}

// ── judge: the packets, blind to the variant ───────────────────────────────
const LABELS = ["X", "Y", "Z", "W"];

function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function profileText(c: VizCase): string {
  if (!c.profile) return "not set (a technically literate generalist)";
  return [c.profile.background, c.profile.purpose, c.profile.application].filter(Boolean).join(" / ");
}

function judge(variantIds: string[]): void {
  const fixtures = loadFixtures();
  for (const c of cases()) {
    const f = fixtures.get(c.fixture)!;
    const present = variantIds.filter((v) => existsSync(join(dirOf(v, c.id), "result.json")));
    if (present.length === 0) continue;
    // --differing: only the cases where the variants' outcomes differ; the
    // same picture twice needs no judge.
    if (differingOnly && present.length > 1) {
      const sig = (v: string) => {
        const d = dirOf(v, c.id);
        const r = JSON.parse(readFileSync(join(d, "result.json"), "utf8")) as Result;
        return `${r.outcome}|${r.caption ?? ""}|${existsSync(join(d, "final.svg")) ? readFileSync(join(d, "final.svg"), "utf8") : r.reason ?? ""}`;
      };
      const first = sig(present[0]);
      if (present.every((v) => sig(v) === first)) continue;
    }
    const order = shuffled(present, `${round}:${c.id}`);
    const jdir = join(VIZ_ROOT, round, "judge", c.id);
    mkdirSync(jdir, { recursive: true });
    const map: Record<string, string> = {};
    const partA: string[] = [
      `# Visualization review, part A: first sight (case ${c.id})`,
      "",
      "You see the picture(s) before you know the passage, as a reader flipping to a card would. For each candidate below, open its image file(s) with the Read tool and look at it for a moment. Then write, in one sentence each, what you take the picture's point to be. Do not open part B until takeaway.json is written.",
      "",
    ];
    // The pictures are copied into the packet under the candidate's letter,
    // so no path names the variant: the judge is blind to which is which.
    const shown = (label: string, v: string, file: string): string | null => {
      const from = join(dirOf(v, c.id), file);
      if (!existsSync(from)) return null;
      const to = join(jdir, `${label}-${file}`);
      copyFileSync(from, to);
      return to;
    };
    for (const [i, v] of order.entries()) {
      const label = LABELS[i];
      map[label] = v;
      const r = JSON.parse(readFileSync(join(dirOf(v, c.id), "result.json"), "utf8")) as Result;
      partA.push(`## Candidate ${label}`);
      if (r.outcome !== "drawn") partA.push("No picture: the tool declined or failed. Write \"(no picture)\".");
      else {
        partA.push(`Kind: ${r.kind}`);
        partA.push(`Image as it shows in the card (320 px wide, drawn at 2x): ${shown(label, v, "final.png")}`);
        const frames = shown(label, v, "frames.png");
        if (frames) partA.push(`It moves: four moments of its 8-second loop: ${frames}`);
        partA.push(`Caption under it: ${r.caption}`);
      }
      partA.push("");
    }
    partA.push(`Write ${join(jdir, "takeaway.json")} as {"X": "<one sentence>", …} for every candidate above. Then open ${join(jdir, "B.md")}.`);
    writeFileSync(join(jdir, "A.md"), partA.join("\n"));

    const blocks = f.blocks.map((b, i) => `(${i + 1}) ${b.text}`).join("\n\n");
    const partB: string[] = [
      `# Visualization review, part B: scoring (case ${c.id})`,
      "",
      "Visualize turns a passage the reader selected into one picture that delivers the passage's core idea at a glance — a diagram, a simulation of a law of change, a still picture, or an animation — or declines when a picture would not carry it. A decline is a valid answer. The picture shows in a card 320 px wide.",
      "",
      `## The document: ${f.title}`,
      "",
      blocks,
      "",
      "## The selected passage",
      "",
      JSON.parse(readFileSync(join(dirOf(present[0], c.id), "case.json"), "utf8")).passage,
      "",
      `Reader: ${profileText(c)}. Language of the reader's interface: ${c.lang === "zh" ? "Chinese" : "English"}.`,
      "",
      "## What a careful reader expects (a guide, not a key)",
      "",
      `Decision: ${c.expect}${c.kinds ? `; kinds that fit: ${c.kinds.join(", ")}` : ""}.`,
      c.good,
      "",
      "## The candidates",
      "",
    ];
    for (const label of Object.keys(map)) {
      const v = map[label];
      const r = JSON.parse(readFileSync(join(dirOf(v, c.id), "result.json"), "utf8")) as Result;
      partB.push(`### Candidate ${label}`);
      if (r.outcome === "drawn") {
        partB.push(`Kind: ${r.kind}. Caption: ${r.caption}`);
        partB.push(`The tool's own judgment: ${r.structure ?? "(none)"}`);
        partB.push(`Images: ${join(jdir, `${label}-final.png`)}${existsSync(join(jdir, `${label}-frames.png`)) ? `, ${join(jdir, `${label}-frames.png`)}` : ""}`);
        partB.push(`SVG source, if you need to read a detail: ${shown(label, v, "final.svg")}`);
        partB.push(`Mechanical findings: ${r.issues.length ? r.issues.join(" ") : "none"}`);
      } else if (r.outcome === "declined") {
        partB.push(`Declined${r.declinedBy === "check" ? " (by the check pass, after drawing)" : ""}. Reason shown to the reader: ${r.reason}`);
      } else {
        partB.push(`Failed: ${r.outcome} — ${r.reason}. Score it as a failure: decision 1, overall 1.`);
      }
      partB.push("");
    }
    partB.push(
      "## Score",
      "",
      "Score each candidate 1 to 5 on each criterion (5 = a reader could not ask for better; 3 = usable with a visible flaw; 1 = wrong or harmful). For a decline, score decision only and set the picture criteria to null. Judge the picture as shown in the PNG, not the SVG source's intent.",
      "",
      ...VIZ_CRITERIA.map((k) => `- ${k.key}: ${k.ask}`),
      "- first_sight: how well your part-A takeaway matches the passage's core idea (5 = the same point; 1 = a different point or none). null for a decline.",
      "- overall: would you ship this to the reader as it is? 5 = yes, gladly; 3 = with doubts; 1 = no. A right decline with a specific reason is a 4 or 5; a decline of a passage that should have been drawn is a 1 or 2.",
      "",
      `Write ${join(jdir, "scores.json")} as:`,
      '{ "X": { "decision": n, "accuracy": n|null, "core_idea": n|null, "glance": n|null, "legibility": n|null, "kind_fit": n|null, "first_sight": n|null, "overall": n, "worst": "<criterion>", "evidence": "<what in the picture shows it, concretely>", "fix": "<one change to the tool\'s instructions that would fix the fault class, not this case>" }, …' +
        (Object.keys(map).length > 1 ? ', "preference": "X" | "Y" | "tie", "why": "<one sentence>" }' : " }"),
    );
    writeFileSync(join(jdir, "B.md"), partB.join("\n"));
    writeJson(join(jdir, "map.json"), map);
  }
  console.log(`judge packets in ${join(VIZ_ROOT, round, "judge")}`);
}

// ── score: the table per variant, the weakest cases ────────────────────────
type Score = Record<string, number | string | null>;

function mean(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null;
}

function score(variantIds: string[]): void {
  const rows: { c: VizCase; v: string; r: Result; s: Score | null; pref: string | null; takeaway: string | null }[] = [];
  for (const c of cases()) {
    const jdir = join(VIZ_ROOT, round, "judge", c.id);
    const map = existsSync(join(jdir, "map.json")) ? (JSON.parse(readFileSync(join(jdir, "map.json"), "utf8")) as Record<string, string>) : {};
    const scores = existsSync(join(jdir, "scores.json")) ? (JSON.parse(readFileSync(join(jdir, "scores.json"), "utf8")) as Record<string, unknown>) : {};
    const takeaways = existsSync(join(jdir, "takeaway.json")) ? (JSON.parse(readFileSync(join(jdir, "takeaway.json"), "utf8")) as Record<string, string>) : {};
    const byVariant = Object.fromEntries(Object.entries(map).map(([label, v]) => [v, label]));
    const preferred = typeof scores.preference === "string" ? (scores.preference === "tie" ? "tie" : map[scores.preference] ?? null) : null;
    for (const v of variantIds) {
      const path = join(dirOf(v, c.id), "result.json");
      if (!existsSync(path)) continue;
      const r = JSON.parse(readFileSync(path, "utf8")) as Result;
      const label = byVariant[v];
      rows.push({ c, v, r, s: label ? ((scores[label] as Score) ?? null) : null, pref: preferred, takeaway: label ? (takeaways[label] ?? null) : null });
    }
  }
  const lines: string[] = [`# Visualize loop — round ${round}`, ""];
  const keys = ["overall", "decision", ...PICTURE_KEYS, "first_sight"];
  lines.push(`| variant | cases | ${keys.join(" | ")} | decision agrees | drawn | declined | check replaced | lint issues/picture | est. out tokens | pref wins |`);
  lines.push(`|---|---|${keys.map(() => "---").join("|")}|---|---|---|---|---|---|---|`);
  const summary: Record<string, Record<string, number | null>> = {};
  for (const v of variantIds) {
    const mine = rows.filter((x) => x.v === v);
    if (mine.length === 0) continue;
    const judged = mine.filter((x) => x.s);
    const per = Object.fromEntries(keys.map((k) => [k, mean(judged.map((x) => x.s![k]).filter((n): n is number => typeof n === "number"))]));
    const agrees = mine.filter((x) => {
      const drew = x.r.outcome === "drawn";
      return x.c.expect === "either" || (x.c.expect === "draw") === drew;
    }).length;
    const drawn = mine.filter((x) => x.r.outcome === "drawn");
    const replaced = mine.filter((x) => x.r.check === "replace").length;
    const issues = mean(drawn.map((x) => x.r.issues.length));
    const outTokens = mean(mine.map((x) => x.r.efficiency.outTokens));
    const wins = mine.filter((x) => x.pref === v).length;
    summary[v] = { ...per, agrees, drawn: drawn.length, replaced, issues, outTokens, wins };
    lines.push(
      `| ${v} | ${mine.length} | ${keys.map((k) => per[k] ?? "–").join(" | ")} | ${agrees}/${mine.length} | ${drawn.length} | ${mine.length - drawn.length} | ${replaced} | ${issues ?? "–"} | ${outTokens ?? "–"} | ${wins} |`,
    );
  }
  lines.push("", "## Per case", "", "| case | expect | variant | outcome | kind | check | overall | worst | issues |", "|---|---|---|---|---|---|---|---|---|");
  for (const x of rows) {
    lines.push(`| ${x.c.id} | ${x.c.expect} | ${x.v} | ${x.r.outcome}${x.r.declinedBy === "check" ? " (check)" : ""} | ${x.r.kind ?? "–"} | ${x.r.check} | ${x.s?.overall ?? "–"} | ${x.s?.worst ?? "–"} | ${x.r.issues.length} |`);
  }
  lines.push("", "## The weakest cases", "");
  const weakest = rows.filter((x) => x.s && typeof x.s.overall === "number").sort((a, b) => (a.s!.overall as number) - (b.s!.overall as number)).slice(0, 10);
  for (const x of weakest) {
    lines.push(`### ${x.c.id} (${x.v}): overall ${x.s!.overall}, ${x.r.outcome}${x.r.kind ? ` ${x.r.kind}` : ""}`);
    if (x.takeaway) lines.push(`- First sight: ${x.takeaway}`);
    if (x.r.caption) lines.push(`- Caption: ${x.r.caption}`);
    if (x.r.outcome === "declined") lines.push(`- Reason: ${x.r.reason}`);
    lines.push(`- Worst: ${x.s!.worst} — ${x.s!.evidence}`, `- Fix: ${x.s!.fix}`);
    if (x.r.issues.length) lines.push(`- Lint: ${x.r.issues.slice(0, 4).join(" ")}`);
    lines.push("");
  }
  const out = join(VIZ_ROOT, round, "report.md");
  writeFileSync(out, lines.join("\n"));
  writeJson(join(VIZ_ROOT, round, "summary.json"), summary);
  console.log(lines.slice(0, 4 + variantIds.length).join("\n"));
  console.log(`\nreport: ${out}`);
}

// ── batches: the case directories for one agent each ───────────────────────
function batches(variantId: string, file: string, size: number): void {
  const dirs = cases()
    .map((c) => dirOf(variantId, c.id))
    .filter((d) => existsSync(join(d, file)));
  for (let i = 0; i < dirs.length; i += size) console.log(dirs.slice(i, i + size).join(" "));
}

async function main(): Promise<void> {
  const variant = flag("variant") ?? "base";
  // --dir: the directory the run writes, when it is not the variant's name
  // (a renderer change runs the same variant twice).
  const dirName = flag("dir") ?? variant;
  const variants = (flag("variants") ?? variant).split(",").filter(Boolean);
  if (command === "prepare") prepare(variant, dirName);
  else if (command === "draw") await draw(variant, dirName);
  else if (command === "final") await final(dirName);
  else if (command === "judge") judge(variants);
  else if (command === "score") score(variants);
  else if (command === "batches") batches(variant, flag("file") ?? "prompt.md", Number(flag("size") ?? "5"));
  else if (command === "rounds") console.log(existsSync(VIZ_ROOT) ? readdirSync(VIZ_ROOT).join("\n") : "(none)");
  else throw new Error(`unknown command ${command}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

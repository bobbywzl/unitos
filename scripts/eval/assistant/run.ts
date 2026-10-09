// The assistant loop's runner (SPEC.md §7, §25). The model and the judge
// are outside this script: an agent reads each prompt file and writes the
// answer, so a Claude session stands in for the assistant's model (Gemini
// 3.8 Flash in production) and for the edit passes' (Claude Sonnet 5). The
// script builds the prompts exactly as the route does, reads the answer the
// way the route does (the actions fence, lib/assistant/plan.ts), runs the
// edit passes through their own code (lib/assistant/revise.ts, the external
// model of lib/derive/external-call.ts), applies the plan to the fixture as
// the plan card would (simulate.ts), checks what counts, and scores the
// judges' answers. One directory per round and case: .eval/assistant/<round>/<case>/.
//
//   npx tsx scripts/eval/assistant/run.ts prepare --round r0 [--cases a,b] [--families edit,answer]
//   … an agent answers prompt.md with answer.md in each case directory …
//   npx tsx scripts/eval/assistant/run.ts score --round r0
//   … an agent answers each pending calls/<name>.prompt.md with calls/<name>.answer.md; score again …
//   … an agent reads judge-prompt.md and writes judge.json …
//   npx tsx scripts/eval/assistant/run.ts report --round r0 [--baseline r0]
//   npx tsx scripts/eval/assistant/run.ts batches --round r0 --stage answer|calls|judge --size 4
import "../env";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BlockType } from "@prisma/client";
import { z } from "zod";
import { actionsSchema, enrichActions, parseActionsFence, planShape, splitActionsFence, type PlanContext, type ReadActions } from "@/lib/assistant/plan";
import { documentPrefix } from "@/lib/derive/context";
import { parseJson } from "@/lib/derive/json";
import { actPrompt, textSelectionBlock } from "@/lib/prompts/act";
import { changeWindow } from "@/lib/assistant/diff-window";
import { runRevise } from "@/lib/assistant/revise";
import { blockKind } from "@/lib/block-kind";
import { EXTERNAL_PENDING } from "@/lib/derive/external-call";
import { corpusSystem } from "@/lib/digest/render";
import { translatorFor } from "@/lib/i18n/dictionaries";
import { parseMarkdown } from "@/lib/parse/markdown";
import { synthesisAskPrompt, synthesisHistoryTurn } from "@/lib/prompts/synthesis";
import type { AssistantAction } from "@/lib/types";
import { blockTags, cjkShare, loadFixtures, wordCount, type Fixture } from "../lib";
import { CASES, type ActionExpect, type AssistantCase, type Family } from "./cases";
import { caseBlocks, fixtureParts, fixtureSections, fixtureSystem, fixtureText, fixtureTranscript, videoBlockId } from "./digest";
import { fixtureRichText } from "./richtext";
import { applyOps, runSuggestAction, type Landed } from "./suggest-run";
import { FAMILY_RUBRIC, SHARED } from "./rubric";
import { simulate, type Simulation } from "./simulate";

export const ASSISTANT_ROOT = join(process.cwd(), ".eval", "assistant");

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] ?? "");
};
const round = flag("round") ?? "r0";
const casesWanted = flag("cases")?.split(",").filter(Boolean) ?? null;
const familiesWanted = flag("families")?.split(",").filter(Boolean) ?? null;

const SYSTEM = "=====[SYSTEM]=====";
const USER = "=====[USER]=====";
const ASSISTANT = "=====[ASSISTANT]=====";

const DOCUMENT_SCOPE_LABEL = "this page: the open document in full, and every note, annotation, distillation, extraction, and summary on it";
const PROJECT_SCOPE_LABEL = "this project: every document in full, and every note, annotation, distillation, extraction, and summary in it";

function cases(): AssistantCase[] {
  return CASES.filter((c) => (!casesWanted || casesWanted.includes(c.id)) && (!familiesWanted || familiesWanted.includes(c.family)));
}

const dirOf = (id: string) => join(ASSISTANT_ROOT, round, id);
const readText = (path: string): string | null => (existsSync(path) ? readFileSync(path, "utf8") : null);
const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));

// ── prepare: the prompt, as the route sends it ─────────────────────────────
function prepare(): void {
  const fixtures = loadFixtures();
  let n = 0;
  for (const c of cases()) {
    const f = fixtures.get(c.fixture);
    if (!f) throw new Error(`fixture ${c.fixture} is missing`);
    const notes = c.notes ?? [];
    const scope = c.scope ?? "document";
    const blocks = caseBlocks(c, f);
    const transcript = fixtureTranscript(f);
    const history = c.history ?? [];
    // The selection chat's own prompt (src/app/api/assistant/act/route.ts):
    // the document prefix as the system message, the act prompt as the user
    // message, the conversation inside it.
    const picked = c.chat === "selection" && c.selection ? rowSelection(blocks, c.selection) : null;
    const actUser =
      c.chat === "selection"
        ? actPrompt({
            profile: c.profile,
            lang: c.lang,
            selectionBlock: picked ? textSelectionBlock(picked.blockId, picked.quotedText) : "",
            toolBlock: "",
            hasSelection: picked !== null,
            sections: fixtureSections(notes).map((s) => ({ id: s.id, title: s.title, parentTitle: null })),
            otherDocuments: [],
            notes: notes.map((n, i) => ({ id: `note-${i + 1}`, sectionTitle: n.section, content: n.content })),
            history: history.map((turn) => ({ role: turn.role, content: turn.content })),
            command: c.question,
            edits: c.edits ?? "blocks",
            pages: [],
            transcript: transcript?.lines ?? null,
            figureBlockId: null,
          })
        : null;
    const system = actUser !== null ? documentPrefix(f.title, blocks as never, null, null) : scope === "document" ? fixtureSystem(f, notes, blocks) : corpusSystem(fixtureParts(f, notes, blocks));
    const prompt = actUser ?? synthesisAskPrompt({
      profile: c.profile,
      lang: c.lang,
      scopeLabel: scope === "document" ? DOCUMENT_SCOPE_LABEL : PROJECT_SCOPE_LABEL,
      question: c.question,
      continued: history.length > 0,
      act:
        scope === "document"
          ? {
              sections: fixtureSections(notes),
              otherDocuments: [],
              edits: c.edits ?? "blocks",
              caretBlockId: c.caret ? f.blocks[c.caret - 1].id : undefined,
              sheets: [],
              pages: [],
              transcript: transcript?.lines ?? null,
            }
          : undefined,
    });
    const turns = actUser !== null ? [] : history.map((turn) => (turn.role === "assistant" ? `${ASSISTANT}\n${turn.content}` : `${USER}\n${synthesisHistoryTurn({ content: turn.content })}`));
    const dir = dirOf(c.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "prompt.md"), [SYSTEM, system, "", ...turns.flatMap((t) => [t, ""]), USER, prompt, ""].join("\n"));
    writeJson(join(dir, "case.json"), { ...c, title: f.title, round });
    n++;
  }
  console.log(`prepared ${n} cases in ${join(ASSISTANT_ROOT, round)}`);
}

// ── score: the answer through the plan, the edit passes, the simulation ───
export type Check = { name: string; ok: boolean; detail?: string };

/** The act route's answer (src/app/api/assistant/act/route.ts planSchema). */
const actAnswerSchema = z.object({
  reply: z.string().max(8000).nullable(),
  actions: actionsSchema,
  matches: z.array(z.unknown()).optional(),
});

/** The words a selection-chat case selects: a block by its order among the
    case's blocks, and the text selected in it (the whole block when none). */
function rowSelection(blocks: PlanContext["blocks"], selection: { block: number; text?: string }) {
  const block = blocks[selection.block - 1];
  if (!block) throw new Error(`block ${selection.block} is not in the document`);
  const start = selection.text ? block.text.indexOf(selection.text) : 0;
  if (start === -1) throw new Error(`"${selection.text}" is not in block ${selection.block}`);
  const end = selection.text ? start + selection.text.length : block.text.length;
  return { blockId: block.id, startOffset: start, endOffset: end, quotedText: block.text.slice(start, end) };
}

type CaseResult = {
  id: string;
  family: Family;
  fixture: string;
  pending: string[];
  answer: string;
  fence: string | null;
  read: { actions: number; unreadable: number };
  actions: AssistantAction[];
  warnings: string[];
  checks: Check[];
  changed: { id: string; before: string; after: string }[];
  added: { id: string; text: string }[];
  removed: string[];
  annotations: Simulation["annotations"];
  notes: Simulation["notes"];
  sections: string[];
  documents: { title: string; markdown: string }[];
  words: number;
  // A suggest action's run: what landed on the page, and what did not.
  suggestions?: { count: number; summary: string; skipped: string[] };
};

const lower = (s: string) => s.toLowerCase();
const has = (text: string, part: string) => lower(text).includes(lower(part));

/** The actions that answer one expectation. */
function matchesExpect(a: AssistantAction, e: ActionExpect, idOf: (n: number) => string): boolean {
  if (a.type !== e.type) return false;
  const blockOf = (): string | null => {
    switch (a.type) {
      case "edit_block":
      case "remove_block":
      case "format_block":
      case "move_block":
      case "join_lines":
      case "split_line":
      case "set_speaker":
        return a.blockId;
      case "highlight":
      case "comment":
      case "style":
      case "link":
        return a.anchor.blockId;
      case "add_note":
        return a.source?.blockId ?? null;
      default:
        return null;
    }
  };
  const idsOf = (): string[] => (a.type === "suggest" || a.type === "revise" ? (a.blockIds ?? []) : [blockOf() ?? ""]);
  if (e.block !== undefined && !idsOf().includes(idOf(e.block))) return false;
  if (e.blockAny && !e.blockAny.some((n) => idsOf().includes(idOf(n)))) return false;
  if (e.after !== undefined) {
    const after = a.type === "insert_paragraph" || a.type === "move_block" ? a.afterBlockId : undefined;
    if (after === undefined || after !== (e.after === null ? null : idOf(e.after))) return false;
  }
  if (e.next !== undefined && !(a.type === "join_lines" && a.nextBlockId === idOf(e.next))) return false;
  if (e.quote !== undefined || e.quoteAny !== undefined) {
    const quote =
      a.type === "highlight" || a.type === "comment" || a.type === "style" || a.type === "link"
        ? a.anchor.quotedText
        : a.type === "split_line"
          ? a.quote
          : a.type === "add_note"
            ? (a.source?.quotedText ?? "")
            : "";
    if (e.quote !== undefined && !has(quote, e.quote)) return false;
    if (e.quoteAny !== undefined && !e.quoteAny.some((part) => has(quote, part))) return false;
  }
  if (e.text !== undefined) {
    const text =
      a.type === "edit_block"
        ? a.newText
        : a.type === "insert_paragraph"
          ? a.text
          : a.type === "add_note"
            ? a.content
            : a.type === "comment"
              ? a.comment
              : a.type === "highlight"
                ? (a.comment ?? "")
                : a.type === "suggest" || a.type === "revise"
                  ? a.instruction
                  : a.type === "add_section"
                    ? a.title
                    : a.type === "create_document"
                      ? `${a.title}\n${a.markdown}`
                      : "";
    if (!has(text, e.text)) return false;
  }
  if (e.kind !== undefined) {
    const kind = a.type === "format_block" ? a.kind : a.type === "insert_paragraph" ? (a.kind ?? "paragraph") : undefined;
    if (kind !== e.kind) return false;
  }
  if (e.color !== undefined && !(a.type === "highlight" && a.color === e.color)) return false;
  if (e.style !== undefined && !(a.type === "style" && a.style === e.style)) return false;
  if (e.reorder !== undefined && !((a.type === "suggest" || a.type === "revise") && Boolean(a.reorder) === e.reorder)) return false;
  if (e.whole !== undefined && !((a.type === "suggest" || a.type === "revise") && !a.blockIds?.length === e.whole)) return false;
  if (e.name !== undefined) {
    const name = a.type === "rename_speaker" ? a.name : a.type === "set_speaker" ? a.name : "";
    if (!has(name, e.name)) return false;
  }
  return true;
}

function describe(e: ActionExpect): string {
  return Object.entries(e)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
}

/** The checks of one case: what counts, counted. */
function checkCase(c: AssistantCase, f: Fixture, ctx: PlanContext, read: ReadActions | null, fence: string | null, answer: string, actions: AssistantAction[], warnings: string[], sim: Simulation, pending: string[]): Check[] {
  const e = c.expect;
  const checks: Check[] = [];
  const idOf = (n: number) => (n === 0 ? videoBlockId(f) : c.edits === "suggestions" || c.edits === "none" ? ctx.blocks[n - 1].id : f.blocks[n - 1].id);
  const original = new Map(ctx.blocks.map((b) => [b.id, b]));
  const after = new Map(sim.blocks.map((b) => [b.id, b]));

  if (e.change) {
    checks.push({ name: "actions block matches the ask", ok: fence !== null && actions.length > 0, detail: fence === null ? "no actions block" : actions.length === 0 ? "no action stood" : `${actions.length} actions` });
    checks.push({ name: "every action reads", ok: fence === null || (read !== null && read.unreadable.length === 0), detail: read ? `${read.unreadable.length} unreadable` : fence === null ? "no block" : "nothing read as JSON" });
  } else {
    checks.push({ name: "actions block matches the ask", ok: fence === null, detail: fence === null ? "no block, as asked" : `a block with ${actions.length} actions` });
  }
  const real = warnings.filter((w) => !w.includes(EXTERNAL_PENDING));
  checks.push({ name: "every action fits the document", ok: real.length === 0, detail: real.slice(0, 3).join(" | ") });
  if (pending.length > 0) checks.push({ name: "second stage answered", ok: false, detail: `${pending.length} pending: ${pending.slice(0, 3).join(", ")}` });

  if (e.actions) {
    const missing = e.actions.filter((x) => !actions.some((a) => matchesExpect(a, x, idOf)));
    checks.push({ name: "expected actions proposed", ok: missing.length === 0, detail: missing.map(describe).join("; ") || `${e.actions.length} matched` });
  }
  if (e.only) {
    const strays = actions.filter((a) => !e.only!.includes(a.type));
    checks.push({ name: "no stray action", ok: strays.length === 0, detail: strays.map((a) => a.type).join(", ") });
  }
  if (e.min !== undefined || e.max !== undefined) {
    const n = actions.length;
    const ok = (e.min === undefined || n >= e.min) && (e.max === undefined || n <= e.max);
    checks.push({ name: "action count", ok, detail: `${n} (${e.min ?? 0}..${e.max ?? "∞"})` });
  }
  if (e.touch) {
    const allowed = new Set(e.touch.map(idOf));
    const faults: string[] = [];
    for (const b of ctx.blocks) {
      if (allowed.has(b.id)) continue;
      const now = after.get(b.id);
      if (!now) faults.push(`${short(b.id)} removed`);
      else if (now.text !== b.text) faults.push(`${short(b.id)} words changed`);
      else if (now.kind && now.kind !== blockKind(b.type, b.html, b.text)) faults.push(`${short(b.id)} kind changed`);
    }
    // The untouched blocks keep their order among themselves.
    const kept = sim.blocks.filter((b) => original.has(b.id) && !allowed.has(b.id)).map((b) => ctx.blocks.findIndex((o) => o.id === b.id));
    if (kept.some((i, k) => k > 0 && i < kept[k - 1])) faults.push("order of untouched blocks changed");
    const fresh = sim.blocks.filter((b) => b.fresh);
    const insertExpected = e.fresh || e.actions?.some((x) => x.type === "insert_paragraph");
    if (fresh.length > 0 && !insertExpected) faults.push(`${fresh.length} blocks added`);
    checks.push({ name: "untouched blocks keep words and place", ok: faults.length === 0, detail: faults.slice(0, 4).join("; ") });
  }
  if (e.after || e.order || e.removed || e.kept || e.exists) {
    const faults: string[] = [];
    for (const x of e.after ?? []) {
      const b = after.get(idOf(x.block));
      if (!b) {
        faults.push(`block ${x.block} is gone`);
        continue;
      }
      for (const part of x.includes ?? []) if (!has(b.text, part)) faults.push(`block ${x.block} lacks "${part}"`);
      for (const part of x.excludes ?? []) if (has(b.text, part)) faults.push(`block ${x.block} still holds "${part}"`);
      if (x.kind && (b.kind ?? blockKind(b.type, b.html, b.text)) !== x.kind) faults.push(`block ${x.block} is not ${x.kind}`);
      if (x.maxSentenceWords !== undefined) {
        const longest = Math.max(0, ...b.text.split(/(?<=[.!?])\s+/).map((sentence) => wordCount(sentence)));
        if (longest > x.maxSentenceWords) faults.push(`block ${x.block} has a sentence of ${longest} words`);
      }
    }
    for (const x of e.exists ?? []) {
      const found = sim.blocks.some(
        (b) => (x.kind === undefined || (b.kind ?? blockKind(b.type, b.html, b.text)) === x.kind) && (x.includes ?? []).every((part) => has(b.text, part)),
      );
      if (!found) faults.push(`no block ${x.kind ? `of kind ${x.kind} ` : ""}holding ${(x.includes ?? []).map((part) => `"${part}"`).join(", ")}`);
    }
    const at = (n: number) => sim.blocks.findIndex((b) => b.id === idOf(n));
    for (const [a, b] of e.order ?? []) if (!(at(a) >= 0 && at(b) >= 0 && at(a) < at(b))) faults.push(`block ${a} is not before block ${b}`);
    for (const n of e.removed ?? []) if (at(n) >= 0) faults.push(`block ${n} still there`);
    for (const n of e.kept ?? []) if (at(n) < 0) faults.push(`block ${n} is gone`);
    checks.push({ name: "document after the plan", ok: faults.length === 0, detail: faults.slice(0, 4).join("; ") });
  }
  if (e.annotations) {
    const faults = e.annotations
      .filter((x) => sim.annotations.filter((m) => m.blockId === idOf(x.block) && (!x.quote || has(m.quote, x.quote))).length < (x.min ?? 1))
      .map((x) => `block ${x.block}${x.quote ? ` "${x.quote}"` : ""}`);
    checks.push({ name: "marks on the passages", ok: faults.length === 0, detail: faults.join("; ") || `${sim.annotations.length} marks` });
  }
  if (e.notes || e.sections) {
    const faults: string[] = [];
    for (const x of e.notes ?? []) {
      const n = sim.notes.filter(
        (note) =>
          (x.sourced === undefined || note.sourced === x.sourced) &&
          (x.section === undefined || lower(note.section) === lower(x.section)) &&
          (x.includes ?? []).every((part) => has(note.content, part)),
      ).length;
      if (n < (x.min ?? 1)) faults.push(`${n} notes match ${JSON.stringify(x)}`);
    }
    for (const title of e.sections ?? []) if (!sim.sections.some((s) => lower(s) === lower(title))) faults.push(`no section "${title}"`);
    checks.push({ name: "notes and sections", ok: faults.length === 0, detail: faults.join("; ") || `${sim.notes.length} notes, ${sim.sections.length} sections` });
  }
  if (e.documents) {
    const faults: string[] = [];
    for (const x of e.documents) {
      const found = sim.documents.find(
        (d) => (x.title === undefined || has(d.title, x.title)) && (x.includes ?? []).every((part) => has(d.markdown, part)) && parseMarkdown(d.markdown).length >= (x.minBlocks ?? 1),
      );
      if (!found) {
        const near = sim.documents[0];
        faults.push(
          near
            ? `"${near.title}" (${parseMarkdown(near.markdown).length} blocks) lacks ${(x.includes ?? []).filter((part) => !has(near.markdown, part)).map((part) => `"${part}"`).join(", ") || "the size asked"}`
            : "no document made",
        );
      }
    }
    checks.push({ name: "documents made", ok: faults.length === 0, detail: faults.join("; ") || `${sim.documents.length} documents` });
  }
  if (e.answer) {
    const faults: string[] = [];
    for (const part of e.answer.includes ?? []) if (!has(answer, part)) faults.push(`lacks "${part}"`);
    for (const part of e.answer.excludes ?? []) if (has(answer, part)) faults.push(`holds "${part}"`);
    if (e.answer.cites && blockTags(answer).length === 0) faults.push("cites no block");
    const words = wordCount(answer);
    if (words > (e.answer.maxWords ?? 400)) faults.push(`${words} words`);
    checks.push({ name: "answer says", ok: faults.length === 0, detail: faults.join("; ") });
  }
  const ids = new Set(ctx.blocks.map((b) => b.id));
  const bad = blockTags(answer).filter((id) => !ids.has(id));
  checks.push({ name: "block tags resolve", ok: bad.length === 0, detail: bad.length > 0 ? `unknown: ${bad.join(", ")}` : `${blockTags(answer).length} tags` });
  const share = cjkShare(answer);
  checks.push({ name: "answer language", ok: c.lang === "zh" ? share > 0.3 : share < 0.2, detail: `CJK share ${share.toFixed(2)}` });
  if (e.change && actions.length > 0) {
    const long = actions.filter((a) => !a.description || wordCount(a.description) > 40);
    checks.push({ name: "descriptions are one sentence", ok: long.length === 0, detail: long.length > 0 ? `${long.length} too long or missing` : "" });
  }
  return checks;
}

const short = (id: string) => id.replace(/^.*-b/, "b");

/** The plan as the plan card shows it: the label, the description, the target. */
function renderPlan(actions: AssistantAction[], before: Map<string, { text: string }>): string {
  const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, " ");
  return actions
    .map((a) => {
      const detail = (() => {
        switch (a.type) {
          case "edit_block": {
            const window = changeWindow(before.get(a.blockId)?.text ?? "", a.newText);
            return `${short(a.blockId)}: "${clip(window.before, 160)}" → "${clip(window.after, 160)}"`;
          }
          case "insert_paragraph":
            return `after ${a.afterBlockId ? short(a.afterBlockId) : "the start"}${a.kind ? ` as ${a.kind}` : ""}: "${clip(a.text)}"`;
          case "remove_block":
            return `${short(a.blockId)}: "${clip(before.get(a.blockId)?.text ?? "")}"`;
          case "format_block":
            return `${short(a.blockId)} → ${a.kind}`;
          case "move_block":
            return `${short(a.blockId)} → after ${a.afterBlockId ? short(a.afterBlockId) : "the start"}`;
          case "highlight":
            return `${a.color} on ${short(a.anchor.blockId)}: "${clip(a.anchor.quotedText)}"${a.comment ? ` — ${clip(a.comment)}` : ""}`;
          case "comment":
            return `on ${short(a.anchor.blockId)}: "${clip(a.anchor.quotedText)}" — ${clip(a.comment, 160)}`;
          case "style":
            return `${a.style} on ${short(a.anchor.blockId)}: "${clip(a.anchor.quotedText)}"`;
          case "link":
            return `${short(a.anchor.blockId)}: "${clip(a.anchor.quotedText)}" → ${a.href ?? a.toDocumentId}`;
          case "add_note":
            return `into ${a.sectionTitle ?? a.sectionId}${a.source ? ` (source ${short(a.source.blockId)}: "${clip(a.source.quotedText, 60)}")` : " (no source)"}: ${clip(a.content, 200)}`;
          case "add_section":
            return `"${a.title}"`;
          case "suggest":
          case "revise":
            return `${a.blockIds?.length ? a.blockIds.map(short).join(", ") : "the whole document"}${a.reorder ? ", reorder" : ""}: ${clip(a.instruction, 300)}`;
          case "join_lines":
            return `${short(a.blockId)} + ${short(a.nextBlockId)}`;
          case "split_line":
            return `${short(a.blockId)} at "${clip(a.quote, 60)}"`;
          case "set_speaker":
            return `${short(a.blockId)} → ${a.name}`;
          case "rename_speaker":
            return `${a.previousName} → ${a.name}`;
          case "create_document":
            return `"${a.title}" (${a.quotes.length} quotes linked back):\n${a.markdown.split("\n").map((l) => `    ${l}`).join("\n")}`;
        }
      })();
      return `- [${a.type}] ${a.description}\n  ${detail}`;
    })
    .join("\n");
}

async function score(): Promise<void> {
  const fixtures = loadFixtures();
  for (const c of cases()) {
    const dir = dirOf(c.id);
    const answerRaw = readText(join(dir, "answer.md"));
    if (answerRaw === null) {
      console.log(`${c.id}: no answer.md`);
      continue;
    }
    const f = fixtures.get(c.fixture)!;
    const t = translatorFor(c.lang);
    const notes = c.notes ?? [];
    const scope = c.scope ?? "document";
    const edits = c.edits ?? "blocks";
    const history = c.history ?? [];
    // The route's read of the answer: the text before the fence, the fence's
    // content as actions; Project scope drops the block. The selection chat
    // answers JSON: its reply and its actions (actAnswerSchema).
    let text: string;
    let fence: string | null;
    let read: ReadActions | null;
    if (c.chat === "selection") {
      const parsed = parseJson(actAnswerSchema, answerRaw);
      text = parsed?.reply ?? "";
      read = parsed?.actions ?? { actions: [], unreadable: [] };
      fence = parsed && read.actions.length + read.unreadable.length > 0 ? "json" : null;
    } else {
      const split = splitActionsFence(answerRaw.trim());
      text = split.text;
      fence = scope === "document" ? split.content : null;
      read = fence !== null ? parseActionsFence(fence, text, edits) : null;
    }
    const ctx: PlanContext = {
      documentId: f.name,
      edits,
      format: null,
      blocks: caseBlocks(c, f),
      transcript: fixtureTranscript(f),
      attachedIds: new Set([f.name]),
      sectionIds: new Set(fixtureSections(notes).map((s) => s.id)),
      sources: [c.question, ...history.map((turn) => turn.content)],
      t,
    };
    const enriched = read ? enrichActions(read, ctx) : { actions: [], warnings: [] };
    let actions = enriched.actions;
    const warnings = [...enriched.warnings];
    // A revise action runs its passes now, on the external model: its
    // prompts land under calls/, and the agent's answers are read back.
    const revise = actions.find((a): a is Extract<AssistantAction, { type: "revise" }> => a.type === "revise");
    if (revise && edits === "blocks") {
      process.env.EVAL_EXTERNAL_DIR = dir;
      const signal = AbortSignal.timeout(120_000);
      const revised = await runRevise({
        userId: "eval",
        document: { title: f.title, references: null, blocks: ctx.blocks.map((b) => ({ id: b.id, type: b.type as BlockType, text: b.text, html: b.html, startTime: b.startTime ?? null, endTime: b.endTime ?? null })) },
        shape: planShape(ctx),
        profile: c.profile,
        lang: c.lang,
        t,
        command: c.question,
        instruction: revise.instruction,
        material: text.slice(0, 20_000) || null,
        history: history.map((turn) => ({ role: turn.role, content: turn.content })),
        blockIds: revise.blockIds,
        reorder: revise.reorder,
        caretBlockId: c.caret ? f.blocks[c.caret - 1].id : null,
        thinking: "deep",
        signal,
        deadline: signal,
      });
      delete process.env.EVAL_EXTERNAL_DIR;
      const at = actions.indexOf(revise);
      actions = [...actions.slice(0, at), ...revised.actions, ...actions.slice(at + 1)];
      warnings.push(...revised.warnings);
    }
    // A suggest action on a document with rich text runs its passes now, as
    // the act route does, and its resolved ops land on the simulated blocks.
    const suggest = actions.find((a): a is Extract<AssistantAction, { type: "suggest" }> => a.type === "suggest");
    let landed: Landed | null = null;
    if (suggest && edits === "suggestions") {
      const picked = c.chat === "selection" && c.selection ? rowSelection(ctx.blocks, c.selection) : null;
      const got = await runSuggestAction({
        dir,
        title: f.title,
        richText: fixtureRichText(f),
        rows: ctx.blocks,
        action: suggest,
        passage: picked ? [{ blockId: picked.blockId, startOffset: picked.startOffset, endOffset: picked.endOffset }] : [],
        command: c.question,
        history: history.map((turn) => ({ role: turn.role, content: turn.content })),
        profile: c.profile,
        lang: c.lang,
        t,
      });
      if (got instanceof Error) {
        if (!got.message.includes(EXTERNAL_PENDING)) warnings.push(got.message);
      } else {
        landed = got;
        warnings.push(...got.warnings);
      }
    }
    const pending = pendingCalls(dir);
    const sim = simulate(ctx.blocks, actions, ctx.transcript?.speakers ?? [], fixtureSections(notes));
    if (landed) {
      const applied = applyOps(sim.blocks, landed.ops);
      sim.blocks = applied.blocks;
      warnings.push(...applied.notes);
    }
    const checks = checkCase(c, f, ctx, read, fence, text, actions, warnings, sim, pending);
    const before = new Map(ctx.blocks.map((b) => [b.id, b]));
    const afterById = new Map(sim.blocks.map((b) => [b.id, b]));
    const changed = ctx.blocks.filter((b) => afterById.has(b.id) && afterById.get(b.id)!.text !== b.text).map((b) => ({ id: b.id, before: b.text, after: afterById.get(b.id)!.text }));
    const result: CaseResult = {
      id: c.id,
      family: c.family,
      fixture: c.fixture,
      pending,
      answer: text,
      fence,
      read: { actions: read?.actions.length ?? 0, unreadable: read?.unreadable.length ?? 0 },
      actions,
      warnings,
      checks,
      changed,
      added: sim.blocks.filter((b) => b.fresh).map((b) => ({ id: b.id, text: b.text })),
      removed: ctx.blocks.filter((b) => !afterById.has(b.id)).map((b) => b.id),
      annotations: sim.annotations,
      notes: sim.notes,
      sections: sim.sections,
      documents: sim.documents,
      words: wordCount(text),
      ...(landed ? { suggestions: { count: landed.ops.length, summary: landed.summary, skipped: landed.warnings } } : {}),
    };
    writeJson(join(dir, "result.json"), result);
    if (pending.length === 0) writeFileSync(join(dir, "judge-prompt.md"), judgePrompt(c, f, result, before, ctx.blocks));
    const failed = checks.filter((k) => !k.ok);
    console.log(`${c.id.padEnd(32)} ${pending.length > 0 ? `PENDING ${pending.length} calls` : failed.length === 0 ? "checks ok" : `FAIL: ${failed.map((k) => `${k.name}${k.detail ? ` (${k.detail})` : ""}`).join("; ")}`}`);
  }
}

/** The calls under a case directory whose answers are not there yet. */
function pendingCalls(dir: string): string[] {
  const calls = join(dir, "calls");
  if (!existsSync(calls)) return [];
  return readdirSync(calls)
    .filter((name) => name.endsWith(".prompt.md") && !existsSync(join(calls, name.replace(/\.prompt\.md$/, ".answer.md"))))
    .map((name) => name.replace(/\.prompt\.md$/, ""));
}

// ── judge: one packet per case ─────────────────────────────────────────────
function judgePrompt(c: AssistantCase, f: Fixture, r: CaseResult, before: Map<string, { text: string }>, blocks: PlanContext["blocks"]): string {
  const rubric = FAMILY_RUBRIC[c.family];
  const criteria = [...rubric.criteria, ...SHARED];
  const profile = c.profile
    ? `Background: ${c.profile.background}\nPurpose: ${c.profile.purpose}\nApplication: ${c.profile.application || "(none)"}`
    : "(not set: a technically literate generalist)";
  const language = c.lang === "zh" ? "Chinese" : "English";
  const notes = (c.notes ?? []).map((n, i) => `[note note-${i + 1}] (section: ${n.section}) ${n.content}${n.quote ? ` — quotes block ${f.blocks[n.quote.block - 1].id}: "${n.quote.text}"` : ""}`);
  const failed = r.checks.filter((k) => !k.ok);
  return [
    `You judge one turn of a reading app's sidebar assistant, the ${c.family} family, against what a valuable turn is. Be strict and concrete: a reader's time is the cost, and a plan the reader approves runs on their document.`,
    "",
    `What a valuable turn is: ${rubric.what}`,
    "",
    `The document the assistant read, every block tagged [block <id>] (document title: ${f.title}):`,
    "",
    fixtureText(f, blocks.filter((b) => b.type !== "VIDEO")),
    ...(notes.length > 0 ? ["", "The reader's notes in the project:", ...notes] : []),
    "",
    `The reader context:\n${profile}`,
    "",
    `The reader's UI language: ${language}. The document ${c.edits === "suggestions" ? "has rich text: a change to its words is one suggest action, whose instruction the page runs as suggestions" : c.edits === "none" ? "cannot be changed: another account's project holds it" : "is an article: changes are block actions the plan card runs"}.${(c.scope ?? "document") === "notebook" ? " The message was sent at Project scope, where no action can run." : ""}${c.chat === "selection" ? ` The message was sent from the selection chat, on the selected words: the route answers JSON (reply, actions), and a suggest action's suggestions land at once, with no confirmation asked.` : ""}`,
    ...(c.history?.length ? ["", "The conversation so far:", ...c.history.map((turn) => `${turn.role === "user" ? "Reader" : "Assistant"}: ${turn.content}`)] : []),
    "",
    `The reader's message:\n${c.question}`,
    "",
    `What a good turn does (from the case's author):\n${c.good}`,
    "",
    "The assistant's answer (what the reader reads). In the app a [block <id>] tag renders as a ¶ chip that scrolls to the block and shows none of its words, and a [note <id>] tag as a ✎ chip: the words around a chip are all the reader reads of which block is meant.",
    "",
    r.answer || "(empty)",
    "",
    r.actions.length > 0 ? `The plan the reader sees in the plan card (each action with its description and its real target):\n${renderPlan(r.actions, before)}` : "The plan: no actions.",
    ...(r.suggestions
      ? [
          "",
          `The suggestions the page landed from the suggest action, each pending until the reader accepts it: ${r.suggestions.count}${r.suggestions.summary ? ` — ${r.suggestions.summary}` : ""}`,
          ...(r.suggestions.skipped.length > 0 ? ["Changes of the run that did not land (the page shows each reason):", ...r.suggestions.skipped.map((w) => `- ${w}`)] : []),
        ]
      : []),
    ...(r.warnings.length > 0 ? ["", "What the server refused or could not read (shown to the reader as warnings):", ...r.warnings.map((w) => `- ${w}`)] : []),
    ...(r.changed.length > 0 ? ["", "Blocks whose words the plan changes (before → after):", ...r.changed.map((x) => `- ${x.id}\n  before: ${x.before}\n  after:  ${x.after}`)] : []),
    ...(r.added.length > 0 ? ["", "Blocks the plan adds:", ...r.added.map((x) => `- ${x.text}`)] : []),
    ...(r.removed.length > 0 ? ["", `Blocks the plan removes: ${r.removed.join(", ")}`] : []),
    ...(r.annotations.length > 0 ? ["", "Marks the plan makes:", ...r.annotations.map((m) => `- ${m.kind}${m.color ? ` ${m.color}` : ""} on ${m.blockId}: "${m.quote}"${m.comment ? ` — ${m.comment}` : ""}`)] : []),
    ...(r.notes.length > 0 ? ["", "Notes the plan makes:", ...r.notes.map((n) => `- in ${n.section}${n.sourced ? ` (source: "${n.quote}")` : " (no source)"}: ${n.content}`)] : []),
    ...(r.sections.length > 0 ? ["", `Sections the plan makes: ${r.sections.join("; ")}`] : []),
    ...(r.documents.length > 0 ? ["", "Documents the plan makes (title, then the markdown; a > line is a passage linked back to the document):", ...r.documents.map((d) => `### ${d.title}\n${d.markdown}`)] : []),
    "",
    failed.length > 0 ? `Mechanical checks that failed (count them against the turn): ${failed.map((k) => `${k.name}${k.detail ? ` (${k.detail})` : ""}`).join("; ")}` : "Every mechanical check passed.",
    "",
    "Score each criterion 1 to 5: 5 = fully holds, 3 = holds with one real fault, 1 = fails. Then overall, 1 to 5, as the reader would rate the turn. worst: the key of the lowest criterion. evidence: the exact words of the answer or the plan that show the worst fault, or the absence they show. fix: one concrete change to the assistant's prompt rules or to the plan's code that would raise the worst criterion, in one sentence — a rule to add, a rule to drop, a wording to change, a check to add — never 'improve' or 'be more careful'.",
    "",
    "Criteria:",
    ...criteria.map((cr) => `- ${cr.key}: ${cr.ask}`),
    "",
    `Return ONLY JSON: {"scores": {${criteria.map((cr) => `"${cr.key}": <1-5>`).join(", ")}}, "overall": <1-5>, "worst": "<key>", "evidence": "<words>", "fix": "<sentence>"}`,
  ].join("\n");
}

type Judge = { scores: Record<string, number>; overall: number; worst: string; evidence: string; fix: string };

function readJudge(dir: string): Judge | null {
  const raw = readText(join(dir, "judge.json"));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw.replace(/^```(?:json)?\n?|\n?```$/g, "")) as Judge;
    return typeof value.overall === "number" ? value : null;
  } catch {
    return null;
  }
}

// ── batches: what the agents still have to answer ──────────────────────────
function batches(): void {
  const stage = flag("stage") ?? "answer";
  const size = Number(flag("size") ?? 4);
  const items: string[] = [];
  for (const c of cases()) {
    const dir = dirOf(c.id);
    if (stage === "answer") {
      if (existsSync(join(dir, "prompt.md")) && !existsSync(join(dir, "answer.md"))) items.push(dir);
    } else if (stage === "calls") {
      for (const name of pendingCalls(dir)) items.push(join(dir, "calls", `${name}.prompt.md`));
    } else if (stage === "judge") {
      if (existsSync(join(dir, "judge-prompt.md")) && !existsSync(join(dir, "judge.json"))) items.push(dir);
    }
  }
  for (let i = 0; i < items.length; i += size) console.log(items.slice(i, i + size).join(" "));
  if (items.length === 0) console.log(`(nothing pending for stage ${stage})`);
}

// ── report ─────────────────────────────────────────────────────────────────
type Row = { id: string; family: Family; checks: Check[]; judge: Judge | null; pending: number };

function rows(roundName: string): Row[] {
  const out: Row[] = [];
  for (const c of cases()) {
    const dir = join(ASSISTANT_ROOT, roundName, c.id);
    const raw = readText(join(dir, "result.json"));
    if (raw === null) continue;
    const r = JSON.parse(raw) as CaseResult;
    out.push({ id: c.id, family: c.family, checks: r.checks, judge: readJudge(dir), pending: r.pending.length });
  }
  return out;
}

const mean = (values: number[]): number | null => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
const fmt = (n: number | null) => (n === null ? "-" : n.toFixed(2));

function report(): void {
  const current = rows(round);
  const baselineName = flag("baseline");
  const base = baselineName ? rows(baselineName) : null;
  const families = [...new Set(current.map((r) => r.family))];
  const lines: string[] = [`# Assistant eval ${round}`, "", `${current.length} cases scored${base ? `, baseline ${baselineName}` : ""}.`, ""];
  lines.push("| Family | Cases | Judged | Mean | Min | Checks failed | Cases with a failed check | Baseline mean | Delta |", "|---|---|---|---|---|---|---|---|---|");
  const all = (list: Row[]) => list.map((r) => r.judge?.overall).filter((s): s is number => typeof s === "number");
  for (const family of [...families, "all"]) {
    const list = family === "all" ? current : current.filter((r) => r.family === family);
    const baseList = base ? (family === "all" ? base : base.filter((r) => r.family === family)) : null;
    const m = mean(all(list));
    const bm = baseList ? mean(all(baseList)) : null;
    const failed = list.reduce((n, r) => n + r.checks.filter((k) => !k.ok).length, 0);
    const withFail = list.filter((r) => r.checks.some((k) => !k.ok)).length;
    lines.push(
      `| ${family} | ${list.length} | ${all(list).length} | ${fmt(m)} | ${all(list).length ? Math.min(...all(list)).toFixed(1) : "-"} | ${failed} | ${withFail} | ${fmt(bm)} | ${m !== null && bm !== null ? `${m - bm >= 0 ? "+" : ""}${(m - bm).toFixed(2)}` : "-"} |`,
    );
  }
  // The checks that fail most: the fault classes.
  const byCheck = new Map<string, string[]>();
  for (const r of current) for (const k of r.checks) if (!k.ok) byCheck.set(k.name, [...(byCheck.get(k.name) ?? []), r.id]);
  lines.push("", "## Checks failed, most first", "");
  for (const [name, ids] of [...byCheck].sort((a, b) => b[1].length - a[1].length)) lines.push(`- ${name}: ${ids.length} — ${ids.join(", ")}`);
  if (byCheck.size === 0) lines.push("- none");
  // The weakest cases.
  lines.push("", "## Weakest cases", "");
  const ranked = current
    .map((r) => ({ r, score: (r.judge?.overall ?? 5) - r.checks.filter((k) => !k.ok).length }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 12);
  for (const { r } of ranked) {
    const failed = r.checks.filter((k) => !k.ok);
    lines.push(`### ${r.id} (${r.family}) — ${r.judge ? `overall ${r.judge.overall}` : "no judge"}${r.pending ? `, ${r.pending} calls pending` : ""}`);
    if (failed.length > 0) lines.push(`- Checks failed: ${failed.map((k) => `${k.name}${k.detail ? ` (${k.detail})` : ""}`).join("; ")}`);
    if (r.judge) {
      lines.push(`- Scores: ${Object.entries(r.judge.scores).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      lines.push(`- Worst: ${r.judge.worst} — “${r.judge.evidence}”`);
      lines.push(`- Fix: ${r.judge.fix}`);
    }
    lines.push("");
  }
  // Per case, for the round's record.
  lines.push("## Every case", "", "| Case | Family | Overall | Checks failed |", "|---|---|---|---|");
  for (const r of current) lines.push(`| ${r.id} | ${r.family} | ${r.judge ? r.judge.overall : "-"} | ${r.checks.filter((k) => !k.ok).map((k) => k.name).join("; ") || "-"} |`);
  const text = lines.join("\n");
  writeFileSync(join(ASSISTANT_ROOT, round, "report.md"), text);
  console.log(text);
}

// ── main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  mkdirSync(join(ASSISTANT_ROOT, round), { recursive: true });
  switch (command) {
    case "prepare":
      prepare();
      break;
    case "score":
      await score();
      break;
    case "batches":
      batches();
      break;
    case "report":
      report();
      break;
    default:
      console.error("usage: run.ts prepare|score|batches|report --round rN [--cases a,b] [--families f,g] [--stage answer|calls|judge] [--size n] [--baseline rM]");
      process.exit(2);
  }
}

// The runner never calls a provider: the external model answers every
// call. A base URL that cannot connect makes any slip fail at once.
process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9/v1";
process.env.MOONSHOT_BASE_URL = "http://127.0.0.1:9/v1";
process.env.GEMINI_BASE_URL = "http://127.0.0.1:9";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

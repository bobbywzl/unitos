import { JEV_MODEL, mapLimit, systemOne, type JevJson, type JevQuestion } from "@/lib/jev";
import type { UsageMeta } from "@/lib/usage";
import type { SkeletonView } from "@/lib/graph/stitch";

// Stitch's reading passes on Jev (SPEC.md §22). The route pass and the
// select pass are judgements, not writing: does this part, does this block,
// hold material the command needs. Jev answers one such question per part
// or per block, calibrated, in one parallel pass per call, at a fraction of
// a model pass's cost — so every block of every document read gets its own
// decision instead of one model naming 400 of them from a 200,000-character
// skeleton. A call carries one document's parts, or one chunk of one part's
// skeleton lines, with the command beside them: the state stays small, which
// is what keeps Jev accurate. Every threshold is here, in code. A pass that
// fails answers null and the GLM pass runs as before.

const ROUTE_MIN = 0.4; // a part reads at this probability or above
const ROUTE_TOP = 2; // and every document's top parts read whatever their number
const SELECT_MIN = 0.5; // a block is picked at this probability or above
const CHUNK = 32; // skeleton lines per call
const PARALLEL = 8; // calls in flight
const FAILURE_SHARE = 0.25; // more failed calls than this share: the pass fails

type RouteState = { command: string; document: { title: string; gist: string }; parts: { alias: string; title: string; summary: string }[] };
type SelectState = {
  command: string;
  document: { title: string; gist: string };
  part: { title: string; summary: string } | null;
  blocks: { alias: string; text: string }[];
};

function partQuestion(alias: string): JevQuestion {
  return {
    type: "noul",
    instructions: `Part ${alias} holds material the command needs.`,
    criteria: {
      true: "The part's title or summary covers something the command asks for, or evidence for it.",
      false: "The part is on another matter.",
    },
  };
}

function blockQuestion(alias: string): JevQuestion {
  return {
    type: "noul",
    instructions: `Block ${alias} holds material the command needs: a claim, a number, a definition, an example, a step, or a passage the answer would quote.`,
    criteria: {
      true: "The block's line states something the command asks for, or evidence for it.",
      false: "The block's line is on another matter, or only names the topic without saying anything the command asks for.",
    },
  };
}

/** The route pass: the parts the command needs, as the aliases of their
    first blocks. One call per document, one noul per part. Null when Jev
    fails: the GLM route pass runs instead. */
export async function jevRouteParts(
  views: SkeletonView[],
  command: string,
  userId: string | null,
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  const usage: UsageMeta = { userId, feature: "stitch", model: JEV_MODEL };
  const calls = views.filter((v) => v.parts.length > 0);
  if (calls.length === 0) return null;
  let failed = 0;
  const routed = new Set<string>();
  await mapLimit(calls, PARALLEL, async (v) => {
    const state: RouteState = {
      command,
      document: { title: v.r.doc.title, gist: v.gist },
      parts: v.parts.map((p) => ({ alias: p.alias, title: p.title, summary: p.summary })),
    };
    const questions = Object.fromEntries(v.parts.map((p) => [p.alias, partQuestion(p.alias)]));
    const result = await systemOne({ state: state as unknown as { [key: string]: JevJson }, questions, usage, signal, label: "STITCH_ROUTE" });
    if (!result.ok) {
      failed++;
      if (!signal?.aborted) console.warn("[stitch] jev route call failed:", result.error);
      return;
    }
    const scored = v.parts
      .map((p) => ({ alias: p.alias, p: result.answers[p.alias]?.type === "noul" ? (result.answers[p.alias] as { noul: number }).noul : 0 }))
      .sort((a, b) => b.p - a.p);
    scored.forEach((s, i) => {
      if (i < ROUTE_TOP || s.p >= ROUTE_MIN) routed.add(s.alias);
    });
  });
  if (signal?.aborted) return null;
  if (failed > Math.ceil(calls.length * FAILURE_SHARE)) return null;
  return routed.size > 0 ? routed : null;
}

/** The select pass: the blocks the command needs, per document, the most
    likely first. One call per chunk of one part's skeleton lines (the lines
    in `shown`, or every line), one noul per line. Null when Jev fails: the
    GLM select pass runs instead. */
export async function jevSelectLines(
  views: SkeletonView[],
  shown: Set<string> | null,
  command: string,
  userId: string | null,
  signal?: AbortSignal,
): Promise<Map<string, string[]> | null> {
  const usage: UsageMeta = { userId, feature: "stitch", model: JEV_MODEL };
  type Chunk = { v: SkeletonView; partAlias: string | null; lines: SkeletonView["lines"] };
  const chunks: Chunk[] = [];
  for (const v of views) {
    const lines = shown ? v.lines.filter((l) => shown.has(l.alias)) : v.lines;
    // By part, then by CHUNK lines, so a call reads one part's lines under
    // that part's title and summary.
    let current: Chunk | null = null;
    for (const line of lines) {
      if (!current || current.partAlias !== line.partAlias || current.lines.length >= CHUNK) {
        current = { v, partAlias: line.partAlias, lines: [] };
        chunks.push(current);
      }
      current.lines.push(line);
    }
  }
  if (chunks.length === 0) return null;
  let failed = 0;
  const scored = new Map<string, { alias: string; p: number }[]>(views.map((v) => [v.r.doc.id, []]));
  await mapLimit(chunks, PARALLEL, async (chunk) => {
    const part = chunk.partAlias ? (chunk.v.parts.find((p) => p.alias === chunk.partAlias) ?? null) : null;
    const state: SelectState = {
      command,
      document: { title: chunk.v.r.doc.title, gist: chunk.v.gist },
      part: part ? { title: part.title, summary: part.summary } : null,
      blocks: chunk.lines.map((l) => ({ alias: l.alias, text: l.text })),
    };
    const questions = Object.fromEntries(chunk.lines.map((l) => [l.alias, blockQuestion(l.alias)]));
    const result = await systemOne({ state: state as unknown as { [key: string]: JevJson }, questions, usage, signal, label: "STITCH_SELECT" });
    if (!result.ok) {
      failed++;
      if (!signal?.aborted) console.warn("[stitch] jev select call failed:", result.error);
      return;
    }
    const own = scored.get(chunk.v.r.doc.id);
    if (!own) return;
    for (const l of chunk.lines) {
      const a = result.answers[l.alias];
      if (a?.type === "noul" && a.noul >= SELECT_MIN) own.push({ alias: l.alias, p: a.noul });
    }
  });
  if (signal?.aborted) return null;
  if (failed > Math.ceil(chunks.length * FAILURE_SHARE)) return null;
  const picks = new Map<string, string[]>();
  for (const [docId, own] of scored) {
    picks.set(
      docId,
      own.sort((a, b) => b.p - a.p).map((s) => s.alias),
    );
  }
  return picks;
}

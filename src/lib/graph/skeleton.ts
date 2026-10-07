import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { contentsEntries, headingContents, type ContentsEntry } from "@/lib/contents";
import {
  ASSISTANT_WHOLE_THRESHOLD,
  SKELETON_BUILD_CONCURRENCY,
  SKELETON_EFFORT,
  SKELETON_MAX_OUTPUT_TOKENS,
  SKELETON_QUIET_MS,
  SKELETON_STALE_FRACTION,
  SKELETON_STALE_MS,
  SKELETON_WINDOW_CHARS,
  STITCH_READS_GENERATED,
  STITCH_WHOLE_THRESHOLD,
} from "@/lib/derive/config";
import { documentPrefix, pageNames } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { mapLimit } from "@/lib/jev";
import { skeletonPrompt } from "@/lib/prompts/skeleton";
import type { UsageMeta } from "@/lib/usage";

// The skeleton of a document (SPEC.md §22): the document collapsed for
// Stitch — a gist, one summary per part of the contents, and one line per
// block that keeps every claim and number and drops the wording, at about a
// tenth of the length. Stitch reads skeletons where it read whole documents
// before, picks blocks by alias from the lines, and then reads the real
// text of the picked blocks only, so every quote and link still resolves
// against the stored block (SPEC.md §1). Stored on Document.skeleton,
// keyed by the hash of every block's text: a block whose text changed
// reads as its own first words until the skeleton is rebuilt, and a
// document more than a tenth changed is rebuilt — in the background after
// an edit or an add (refreshSkeleton), and at once when Stitch needs it
// (ensureSkeleton). Built one call per window of SKELETON_WINDOW_CHARS,
// the windows at once, each under its own cached prefix.

export const SKELETON_VERSION = 1;
const LINE_MAX = 4_000; // a line of a 4,000-word block: one word in ten, cut past it rather than failing the window
const SUMMARY_MAX = 800;
const GIST_MAX = 400;
const FALLBACK_LINE = 200; // chars of a block's own text that stand in for a missing line

export type SkeletonLine = { blockId: string; hash: string; text: string };
export type SkeletonPart = { blockId: string; title: string; summary: string };
export type Skeleton = {
  v: number;
  gist: string;
  parts: SkeletonPart[];
  lines: SkeletonLine[];
  chars: number; // the readable text's length when built
  built?: number; // when it was built (ms since epoch); absent on skeletons built before it was kept
};

/** The document as the skeleton reads it: the block rows Stitch loads. */
export type SkeletonBlock = { id: string; type: string; text: string; startTime?: number | null; endTime?: number | null };

const PART_EVERY = 25; // readable blocks per part of a document with no headings

// The window's blocks are numbered 1..n for the model (SkeletonCtx): a
// number is a token or two where a stored id is a dozen, written once per
// line. The number maps back to the stored id below.
const blockNumber = z.union([z.string(), z.number()]).transform((v) => String(v).replace(/[^0-9]/g, ""));
const windowSchema = z.object({
  gist: z.string().transform((t) => t.slice(0, GIST_MAX)).default(""),
  parts: z.array(z.object({ blockId: blockNumber, summary: z.string().trim().min(1).transform((t) => t.slice(0, SUMMARY_MAX)) })).max(200),
  lines: z.array(z.object({ blockId: blockNumber, text: z.string().trim().min(1).transform((t) => t.slice(0, LINE_MAX)) })).max(4000),
});

/** The hash of a block's text: what tells a stored line its block changed. */
export function blockHash(text: string): string {
  return createHash("md5").update(text).digest("hex").slice(0, 12);
}

/** The blocks a skeleton has a line for: text, never a page marker or the
    video block (the same rule as Stitch's readable blocks). */
export function skeletonBlocks<T extends SkeletonBlock>(blocks: T[]): T[] {
  return blocks.filter((b) => b.type !== "VIDEO" && b.type !== "PAGE" && b.text.trim().length > 0);
}

/** The stored skeleton, or null when there is none or it is of an older
    version. */
export function readSkeleton(value: unknown): Skeleton | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.v !== SKELETON_VERSION || !Array.isArray(row.lines) || !Array.isArray(row.parts)) return null;
  const lines: SkeletonLine[] = [];
  for (const raw of row.lines) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    if (typeof l.blockId === "string" && typeof l.hash === "string" && typeof l.text === "string") {
      lines.push({ blockId: l.blockId, hash: l.hash, text: l.text });
    }
  }
  const parts: SkeletonPart[] = [];
  for (const raw of row.parts) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.blockId === "string" && typeof p.title === "string" && typeof p.summary === "string") {
      parts.push({ blockId: p.blockId, title: p.title, summary: p.summary });
    }
  }
  return {
    v: SKELETON_VERSION,
    gist: typeof row.gist === "string" ? row.gist : "",
    parts,
    lines,
    chars: typeof row.chars === "number" ? row.chars : 0,
    ...(typeof row.built === "number" ? { built: row.built } : {}),
  };
}

/** How much of the document changed since the skeleton was built: the
    characters of blocks that are new or whose text changed, plus the
    characters the removed blocks' lines stood for, over the characters the
    document has now. 1 with no skeleton. */
export function skeletonDrift(skeleton: Skeleton | null, blocks: SkeletonBlock[]): number {
  const readable = skeletonBlocks(blocks);
  const total = readable.reduce((sum, b) => sum + b.text.length, 0);
  if (!skeleton) return 1;
  if (total === 0) return skeleton.lines.length > 0 ? 1 : 0;
  const stored = new Map(skeleton.lines.map((l) => [l.blockId, l]));
  let changed = 0;
  const seen = new Set<string>();
  for (const b of readable) {
    seen.add(b.id);
    const line = stored.get(b.id);
    if (!line || line.hash !== blockHash(b.text)) changed += b.text.length;
  }
  // A removed block's line stood for text of about the skeleton's share
  // of the block; count it at a line's worth, since the text is gone.
  for (const line of skeleton.lines) if (!seen.has(line.blockId)) changed += line.text.length * 10;
  return Math.min(1, changed / total);
}

/** A stored skeleton is stale when more than SKELETON_STALE_FRACTION of
    the document changed since it was built. */
export function skeletonStale(skeleton: Skeleton | null, blocks: SkeletonBlock[]): boolean {
  return skeletonDrift(skeleton, blocks) > SKELETON_STALE_FRACTION;
}

// A block's own first words, cut at a sentence end when one falls in the
// first FALLBACK_LINE characters, else at a word: the line for a block the
// skeleton has no current line for.
function fallbackLine(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= FALLBACK_LINE) return t;
  const head = t.slice(0, FALLBACK_LINE);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("。"), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence > FALLBACK_LINE / 2) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(" ");
  return word > FALLBACK_LINE / 2 ? head.slice(0, word) : head;
}

/** The skeleton as Stitch reads it now: one line per current readable
    block, in the document's order — the stored line where the block is
    unchanged, the block's own first words where it is new or changed or
    the skeleton is missing — and the parts whose block still exists. */
export function currentSkeleton(skeleton: Skeleton | null, blocks: SkeletonBlock[]): Skeleton {
  const readable = skeletonBlocks(blocks);
  const stored = new Map(skeleton?.lines.map((l) => [l.blockId, l]) ?? []);
  const lines: SkeletonLine[] = readable.map((b) => {
    const hash = blockHash(b.text);
    const line = stored.get(b.id);
    return line && line.hash === hash ? line : { blockId: b.id, hash, text: fallbackLine(b.text) };
  });
  const ids = new Set(readable.map((b) => b.id));
  return {
    v: SKELETON_VERSION,
    gist: skeleton?.gist ?? "",
    parts: (skeleton?.parts ?? []).filter((p) => ids.has(p.blockId)),
    lines,
    chars: readable.reduce((sum, b) => sum + b.text.length, 0),
  };
}

/** The document's parts for the skeleton's summaries: the stored contents,
    else the headings, else — a document with no headings — a part every
    PART_EVERY readable blocks, titled with its blocks' numbers; none for a
    document too short to have parts (the whole document is then one
    part). Contents are built when the reader asks for them (SPEC.md §26),
    never here: the skeleton's parts live in the skeleton only. */
export function partsFor(
  contents: unknown,
  blocks: (SkeletonBlock & { order: number; html: string | null })[],
): ContentsEntry[] {
  const stored = contentsEntries(contents);
  if (stored.length > 0) return stored;
  const headings = headingContents(blocks);
  if (headings.length > 0) return headings;
  const readable = skeletonBlocks(blocks);
  if (readable.length <= PART_EVERY) return [];
  const parts: ContentsEntry[] = [];
  for (let i = 0; i < readable.length; i += PART_EVERY) {
    // The run's place, not its first words cut mid-sentence; the part
    // starts at its first block that is not a footnote.
    const end = Math.min(i + PART_EVERY, readable.length);
    const first = readable.slice(i, end).find((b) => !/^\s*\[Footnote/i.test(b.text)) ?? readable[i];
    parts.push({ title: `Blocks ${i + 1}–${end}`, blockId: first.id, level: 1 });
  }
  return parts;
}

/** Build the skeleton now: one call per window, the windows at once, and
    store it. Returns the skeleton, or null when the document has nothing
    to read or no model is configured. Throws on a failed model call. */
export async function buildSkeleton(
  documentId: string,
  userId: string | null,
  signal?: AbortSignal,
): Promise<Skeleton | null> {
  if (!(await featureConfigured("skeleton"))) return null;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      title: true,
      contents: true,
      references: true,
      importRev: true,
      pageLabels: true,
      blocks: {
        orderBy: { order: "asc" },
        select: { id: true, type: true, text: true, order: true, html: true, startTime: true, endTime: true, cell: true, page: true },
      },
    },
  });
  if (!document) return null;
  const readable = skeletonBlocks(document.blocks);
  if (readable.length === 0) return null;
  const parts = partsFor(document.contents, document.blocks);
  const partAt = new Map(parts.map((p) => [p.blockId, p]));

  // Windows: readable blocks in order, cut at a block boundary past the
  // window's chars.
  const windows: (typeof readable)[] = [];
  let current: typeof readable = [];
  let used = 0;
  for (const block of readable) {
    if (current.length > 0 && used + block.text.length > SKELETON_WINDOW_CHARS) {
      windows.push(current);
      current = [];
      used = 0;
    }
    current.push(block);
    used += block.text.length;
  }
  if (current.length > 0) windows.push(current);

  const skeletonCall = await featureCall("skeleton", SKELETON_EFFORT);
  const model = skeletonCall.model;
  const usage = { userId, feature: "skeleton", model: skeletonCall.modelId } satisfies UsageMeta;
  const results = await Promise.all(
    windows.map(async (blocks, i) => {
      const numberOf = new Map(blocks.map((b, n) => [b.id, String(n + 1)]));
      const numbered = blocks.map((b, n) => ({ ...b, id: String(n + 1) }));
      const windowParts = blocks.filter((b) => partAt.has(b.id)).map((b) => partAt.get(b.id)!);
      const messages: ModelMessage[] = [
        {
          role: "system",
          content: documentPrefix(document.title, numbered, i === 0 ? document.references : undefined, pageNames(document)),
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        {
          role: "user",
          content: skeletonPrompt({
            parts: windowParts.map((p) => ({ blockId: numberOf.get(p.blockId) ?? "", title: p.title })),
            window: i + 1,
            windows: windows.length,
            blockCount: blocks.length,
          }),
        },
      ];
      const result = await callForJson({
        model,
        messages,
        maxOutputTokens: SKELETON_MAX_OUTPUT_TOKENS,
        providerOptions: skeletonCall.providerOptions,
        schema: windowSchema,
        label: windows.length > 1 ? `SKELETON ${i + 1}/${windows.length}` : "SKELETON",
        usage,
        abortSignal: signal,
      });
      if (!result.ok) throw new Error(result.error);
      // The window's numbers back to the stored ids; a number that names
      // no block of the window drops.
      const idOf = (n: string) => blocks[Number(n) - 1]?.id ?? "";
      return {
        gist: result.data.gist,
        parts: result.data.parts.map((p) => ({ ...p, blockId: idOf(p.blockId) })).filter((p) => p.blockId),
        lines: result.data.lines.map((l) => ({ ...l, blockId: idOf(l.blockId) })).filter((l) => l.blockId),
      };
    }),
  );

  // Every line against the stored blocks: the model's line where it named
  // the block, the block's own first words where it did not.
  const lineFor = new Map<string, string>();
  const summaryFor = new Map<string, string>();
  let gist = "";
  for (const r of results) {
    for (const l of r.lines) if (!lineFor.has(l.blockId)) lineFor.set(l.blockId, l.text);
    for (const p of r.parts) if (partAt.has(p.blockId) && !summaryFor.has(p.blockId)) summaryFor.set(p.blockId, p.summary);
    if (!gist && r.gist.trim()) gist = r.gist.trim();
  }
  const skeleton: Skeleton = {
    v: SKELETON_VERSION,
    gist,
    parts: parts.map((p) => ({ blockId: p.blockId, title: p.title, summary: summaryFor.get(p.blockId) ?? "" })),
    lines: readable.map((b) => ({ blockId: b.id, hash: blockHash(b.text), text: lineFor.get(b.id) ?? fallbackLine(b.text) })),
    chars: readable.reduce((sum, b) => sum + b.text.length, 0),
    built: Date.now(),
  };
  // The build lock (skeletonStartedAt) is its holder's to clear
  // (buildLocked), never a build's: another run may hold it.
  await db.document.update({
    where: { id: documentId },
    data: { skeleton: skeleton as unknown as Prisma.InputJsonValue },
  });
  return skeleton;
}

// One build per document at a time (REV3-07). In this process, a running
// build is shared: a command that needs the skeleton the graph's warm is
// building waits for that build instead of starting a second. Across
// processes, Document.skeletonStartedAt is the lock: set by a conditional
// update, so two runs never both take it, cleared only by the run that set
// it, and a lock older than SKELETON_STALE_MS is a dead run's.
const running = new Map<string, Promise<Skeleton | null>>();
const WAIT_POLL_MS = 2_000;
const WAIT_MAX_MS = 90_000; // how long a command waits for another process's build

async function claimBuild(documentId: string): Promise<Date | null> {
  const stamp = new Date();
  const { count } = await db.document.updateMany({
    where: {
      id: documentId,
      OR: [{ skeletonStartedAt: null }, { skeletonStartedAt: { lt: new Date(stamp.getTime() - SKELETON_STALE_MS) } }],
    },
    data: { skeletonStartedAt: stamp },
  });
  return count === 1 ? stamp : null;
}

async function releaseBuild(documentId: string, stamp: Date): Promise<void> {
  await db.document.updateMany({ where: { id: documentId, skeletonStartedAt: stamp }, data: { skeletonStartedAt: null } });
}

// A promise the signal stops waiting for; the build behind it runs on and
// stores its skeleton for the next command.
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error("aborted"));
    signal.addEventListener("abort", stop, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", stop);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** The skeleton built under the lock: the build of this document already
    running in this process; else the lock taken, the skeleton built, and
    the lock cleared. "held": another process holds the lock. */
async function buildLocked(documentId: string, userId: string | null, signal?: AbortSignal): Promise<Skeleton | null | "held"> {
  const own = running.get(documentId);
  if (own) return untilAborted(own, signal);
  const stamp = await claimBuild(documentId);
  if (!stamp) return "held";
  const build = buildSkeleton(documentId, userId).finally(async () => {
    running.delete(documentId);
    await releaseBuild(documentId, stamp).catch(() => {});
  });
  running.set(documentId, build);
  return untilAborted(build, signal);
}

/** Another process's build of the document, waited for: the stored
    skeleton once its lock clears, polled every WAIT_POLL_MS up to
    WAIT_MAX_MS. Null when it does not clear in time. */
async function waitForBuild(documentId: string, signal?: AbortSignal): Promise<Skeleton | null> {
  const until = Date.now() + WAIT_MAX_MS;
  while (Date.now() < until) {
    await untilAborted(new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS)), signal);
    const row = await db.document.findUnique({ where: { id: documentId }, select: { skeleton: true, skeletonStartedAt: true } });
    if (!row) return null;
    if (!row.skeletonStartedAt || Date.now() - row.skeletonStartedAt.getTime() >= SKELETON_STALE_MS) return readSkeleton(row.skeleton);
  }
  return null;
}

/** The skeleton Stitch reads for a document it has loaded: the stored one
    when under a tenth of the document changed, with the changed blocks as
    their own first words; built now when stale or missing. A failed build
    answers the current lines — every block as its own first words — so a
    command still runs. */
export async function ensureSkeleton(
  document: { id: string; skeleton: unknown; blocks: SkeletonBlock[] },
  userId: string | null,
  signal?: AbortSignal,
): Promise<Skeleton> {
  const stored = readSkeleton(document.skeleton);
  if (!skeletonStale(stored, document.blocks)) return currentSkeleton(stored, document.blocks);
  try {
    // A build already running (the graph's warm, an edit's refresh) is
    // waited for, not run twice.
    const locked = await buildLocked(document.id, userId, signal);
    const built = locked === "held" ? await waitForBuild(document.id, signal) : locked;
    if (built) return currentSkeleton(built, document.blocks);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(`[skeleton] build of ${document.id} failed, reading first words:`, err);
  }
  return currentSkeleton(stored, document.blocks);
}

/** Whether a project of the document reads skeletons: past
    STITCH_WHOLE_THRESHOLD estimated tokens (Stitch's reading passes) or
    ASSISTANT_WHOLE_THRESHOLD chars (the assistant at Project scope). One
    aggregate query; the tokens are estimated as lib/tokens.ts does, a CJK
    character (3 bytes in UTF-8) at 1 and the rest at chars / 4. A
    document in no project reads none. by: the document, or a project. */
export async function skeletonNeeded(by: { documentId: string } | { notebookId: string }): Promise<boolean> {
  return (await projectText(by)).some(readsSkeletons);
}

// The text of the projects of a document, or of one project: its chars,
// its CJK chars, and its blocks.
async function projectText(by: { documentId: string } | { notebookId: string }) {
  return db.$queryRaw<{ chars: bigint | null; cjk: bigint | null; blocks: bigint | null }[]>(
    "documentId" in by
      ? Prisma.sql`SELECT sum(length(b.text)) AS chars, sum(octet_length(b.text) - length(b.text)) / 2 AS cjk, count(*) AS blocks
          FROM "NotebookDocument" nd
          JOIN "NotebookDocument" nd2 ON nd2."notebookId" = nd."notebookId"
          JOIN "Block" b ON b."documentId" = nd2."documentId"
          WHERE nd."documentId" = ${by.documentId}
          GROUP BY nd."notebookId"`
      : Prisma.sql`SELECT sum(length(b.text)) AS chars, sum(octet_length(b.text) - length(b.text)) / 2 AS cjk, count(*) AS blocks
          FROM "NotebookDocument" nd
          JOIN "Block" b ON b."documentId" = nd."documentId"
          WHERE nd."notebookId" = ${by.notebookId}`,
  );
}

function readsSkeletons(r: { chars: bigint | null; cjk: bigint | null }): boolean {
  const chars = Number(r.chars ?? 0);
  const cjk = Math.min(chars, Number(r.cjk ?? 0));
  // A tenth of headroom: Stitch counts the rendering, tags included.
  return cjk + (chars - cjk) / 4 > STITCH_WHOLE_THRESHOLD * 0.9 || chars > ASSISTANT_WHOLE_THRESHOLD;
}

/** The background refresh, after an add or an edit: builds the skeleton
    when the document has none or more than a tenth of it changed, and
    leaves it alone otherwise. It builds only when a project of the
    document reads skeletons (skeletonNeeded), and while the document is
    being written at most once per SKELETON_QUIET_MS (a stored skeleton
    built under that ago waits). force: the caller knows the skeleton is
    read (the graph opened): build now. A
    skeleton not built here is built at once when Stitch or the assistant
    needs it (ensureSkeleton). One build at a time per document
    (buildLocked): a build running in this process, or holding the lock
    from another, and this one yields. A page Stitch generated gets no
    skeleton here while the every-document read skips generated pages
    (STITCH_READS_GENERATED): a picked one is built when Stitch reads it.
    sqlStale: the caller ran the SQL drift already (warmSkeletons). */
export async function refreshSkeleton(
  documentId: string,
  userId: string | null,
  options: { force?: boolean; sqlStale?: boolean } = {},
): Promise<void> {
  if (!(await featureConfigured("skeleton"))) return;
  if (running.has(documentId)) return;
  // The cheap checks first, from one small row (COST4-04): an edit saves
  // every few seconds, and inside the quiet period nothing is read.
  const [head] = await db.$queryRaw<{ v: number | null; built: number | null; startedAt: Date | null; generated: boolean }[]>`
    SELECT CASE WHEN jsonb_typeof(d.skeleton->'v') = 'number' THEN (d.skeleton->>'v')::float8 END AS v,
      CASE WHEN jsonb_typeof(d.skeleton->'built') = 'number' THEN (d.skeleton->>'built')::float8 END AS built,
      d."skeletonStartedAt" AS "startedAt", d."generatedCommand" IS NOT NULL AS generated
    FROM "Document" d WHERE d.id = ${documentId}`;
  if (!head) return;
  if (head.generated && !STITCH_READS_GENERATED) return;
  if (head.startedAt && Date.now() - head.startedAt.getTime() < SKELETON_STALE_MS) return;
  const built = head.v === SKELETON_VERSION ? head.built : null;
  if (!options.force && built !== null && Date.now() - built < SKELETON_QUIET_MS) return;
  // Then the drift in SQL, no text read; the blocks load only when it says
  // stale, for the exact check.
  if (!options.sqlStale && !(await staleSkeletonDocument(documentId))) return;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { skeleton: true, blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } } },
  });
  if (!document) return;
  if (!skeletonStale(readSkeleton(document.skeleton), document.blocks)) return;
  if (!options.force && !(await skeletonNeeded({ documentId }))) return;
  try {
    await buildLocked(documentId, userId);
  } catch (err) {
    console.error(`[skeleton] refresh of ${documentId} failed:`, err);
  }
}

/** The documents of a project whose skeleton may be stale: skeletonDrift
    worked out in SQL, from each readable block's length and the hash of its
    text against the stored lines' hashes, so a graph open reads no block
    text into the server (COST3-07). A document with no skeleton, or one of
    an older version, is stale. Generated pages are left out while the
    every-document read skips them. The SQL's readable blocks are the text
    blocks with a non-space character: a block JS trims to nothing counts
    here as changed, which only sends it to refreshSkeleton, whose check
    is exact. */
export async function staleSkeletonDocuments(notebookId: string): Promise<string[]> {
  return staleIn(Prisma.sql`
    SELECT d.id, d.skeleton FROM "NotebookDocument" nd JOIN "Document" d ON d.id = nd."documentId"
    WHERE nd."notebookId" = ${notebookId} AND (${STITCH_READS_GENERATED} OR d."generatedCommand" IS NULL)`);
}

/** staleSkeletonDocuments for one document (COST4-04): whether its
    skeleton may be stale, in SQL, with no block text read into the
    server. True may be a block JS trims to nothing; refreshSkeleton then
    loads the blocks for the exact check. */
export async function staleSkeletonDocument(documentId: string): Promise<boolean> {
  const stale = await staleIn(Prisma.sql`
    SELECT d.id, d.skeleton FROM "Document" d
    WHERE d.id = ${documentId} AND (${STITCH_READS_GENERATED} OR d."generatedCommand" IS NULL)`);
  return stale.length > 0;
}

// skeletonDrift in SQL for the documents `docs` selects (id, skeleton).
async function staleIn(docs: Prisma.Sql): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string; v: number | null; total: bigint | null; changed: bigint | null; removed: bigint | null; lines: number | null }[]>`
    WITH docs AS (${docs}),
    lines AS MATERIALIZED (
      SELECT docs.id AS doc, l."blockId" AS "blockId", l.hash, length(l.text) AS len
      FROM docs, jsonb_to_recordset(CASE WHEN jsonb_typeof(docs.skeleton->'lines') = 'array' THEN docs.skeleton->'lines' ELSE '[]'::jsonb END)
        AS l("blockId" text, hash text, text text)
    ),
    blocks AS MATERIALIZED (
      SELECT b."documentId" AS doc, b.id, left(md5(b.text), 12) AS hash, length(b.text) AS len
      FROM "Block" b JOIN docs ON docs.id = b."documentId"
      WHERE b.type NOT IN ('VIDEO', 'PAGE') AND b.text ~ '[^[:space:]]'
    ),
    bl AS (
      SELECT b.doc, sum(b.len) AS total, sum(CASE WHEN l.hash IS NULL OR l.hash <> b.hash THEN b.len ELSE 0 END) AS changed
      FROM blocks b LEFT JOIN lines l ON l.doc = b.doc AND l."blockId" = b.id
      GROUP BY b.doc
    ),
    lr AS (
      SELECT l.doc, count(*)::int AS lines, sum(CASE WHEN b.id IS NULL THEN l.len ELSE 0 END) * 10 AS removed
      FROM lines l LEFT JOIN blocks b ON b.doc = l.doc AND b.id = l."blockId"
      GROUP BY l.doc
    )
    SELECT docs.id,
      CASE WHEN jsonb_typeof(docs.skeleton->'v') = 'number' THEN (docs.skeleton->>'v')::int END AS v,
      bl.total, bl.changed, lr.removed, lr.lines
    FROM docs LEFT JOIN bl ON bl.doc = docs.id LEFT JOIN lr ON lr.doc = docs.id`;
  return rows
    .filter((r) => {
      const total = Number(r.total ?? 0);
      if (r.v !== SKELETON_VERSION) return total > 0;
      if (total === 0) return (r.lines ?? 0) > 0;
      return Math.min(1, (Number(r.changed ?? 0) + Number(r.removed ?? 0)) / total) > SKELETON_STALE_FRACTION;
    })
    .map((r) => r.id);
}

const warmed = new Map<string, { key: string; at: number }>();

/** The graph opened: every document of a project that reads skeletons gets
    its missing or stale skeleton built now, so the first command does not
    wait for them. Under the threshold nothing is built. Only the documents
    the SQL finds stale are loaded (staleSkeletonDocuments); a build
    already running is not started again (buildLocked). */
export async function warmSkeletons(notebookId: string, userId: string | null): Promise<void> {
  if (!(await featureConfigured("skeleton"))) return;
  const [text] = await projectText({ notebookId });
  if (!text || !readsSkeletons(text)) return;
  // The same project text warmed under SKELETON_QUIET_MS ago is not
  // checked again: a graph opened twice reads no block twice. An edit that
  // keeps the length builds at the command (ensureSkeleton).
  const key = `${text.chars ?? 0}:${text.cjk ?? 0}:${text.blocks ?? 0}`;
  const last = warmed.get(notebookId);
  if (last && last.key === key && Date.now() - last.at < SKELETON_QUIET_MS) return;
  if (warmed.size > 500) warmed.clear();
  warmed.set(notebookId, { key, at: Date.now() });
  const stale = await staleSkeletonDocuments(notebookId);
  await mapLimit(stale, SKELETON_BUILD_CONCURRENCY, (id) => refreshSkeleton(id, userId, { force: true, sqlStale: true }).catch(() => {}));
}

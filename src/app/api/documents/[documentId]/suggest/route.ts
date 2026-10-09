import { NextResponse } from "next/server";
import { z } from "zod";
import { thinkingSchema } from "@/lib/assistant/thinking";
import { notebookAccess } from "@/lib/collab";
import { chatTurnSchema } from "@/lib/conversation";
import { db } from "@/lib/db";
import { SUGGEST_DEADLINE_MS, SUGGEST_MAX_NEW_CHARS, SUGGEST_MAX_WINDOWS, SUGGEST_PARALLEL } from "@/lib/derive/config";
import { loadProfile } from "@/lib/derive/context";
import { modelErrorMessage } from "@/lib/derive/json-call";
import { failureLine } from "@/app/api/assistant/failure-line";
import { runSuggest, suggestDocument } from "@/lib/derive/suggest";
import { orderSuggestOps, richTextUnits, runOrderPass } from "@/lib/assistant/reorder-run";
import { fitsOnePass, runOnePass } from "@/lib/assistant/one-pass";
import type { SuggestEvent } from "@/lib/docs/assistant-suggestions";
import { importShared, importSharedResponse } from "@/lib/docs/server";
import { scopeOf, takesSuggestions, windowsOf } from "@/lib/docs/suggest-ops";
import { runTargetPass } from "@/lib/assistant/target";
import { keepVersionBeforeSuggestions } from "@/lib/docs/versions";
import { featureConfigured } from "@/lib/feature-models";
import { currentLang, serverT } from "@/lib/i18n/server";
import { mapLimit } from "@/lib/jev";
import { ndjsonHeartbeat, ndjsonWriter } from "@/lib/ndjson";
import { parseBody } from "@/lib/validate";

export const maxDuration = 300;

// The assistant's suggestions over blocks or the whole document (SPEC.md
// §29): the panel's suggest action, run by the reader. The scope is the
// named blocks (a heading grows to its section), else the whole document,
// cut into windows; each window is one runSuggest call, SUGGEST_PARALLEL at
// once, and its ops stream to the page as it finishes. A command over the
// whole document, or over more than one window, first keeps the stored text
// as a version named "Before the assistant's suggestions". The response is
// NDJSON (SuggestEvent): {stage: "read"}, {windows}, one line per window,
// then {done}; a failure before the windows is one {error} line. A command
// that moves blocks (reorder) runs the order pass beside the windows: its
// moves are one more window, sent after the others, so a move carries the
// words its blocks' windows changed.
const requestSchema = z.object({
  notebookId: z.string().min(1),
  // The reader's message.
  command: z.string().trim().min(1).max(4000),
  // What the panel's answer passed on: the change to make.
  instruction: z.string().trim().min(1).max(4000).optional(),
  blockIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  // The block the caret stands in: "here".
  caretBlockId: z.string().min(1).max(64).optional(),
  // The panel's answer, which the command may ask to use.
  material: z.string().max(20_000).optional(),
  history: z.array(chatTurnSchema).max(20).optional(),
  thinking: thinkingSchema.optional(),
  // The command moves blocks too: the order pass runs beside the windows,
  // and its moves land after them (lib/assistant/reorder.ts).
  reorder: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const { data, error } = await parseBody(req, requestSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const attached = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId: data.notebookId, documentId } },
  });
  if (!attached) return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      title: true,
      references: true,
      richText: true,
      format: true,
      importRev: true,
      pageLabels: true,
      blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true, cell: true, page: true } },
    },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  if (!takesSuggestions(document)) return NextResponse.json({ error: t("api.suggestNeedsRichText") }, { status: 400 });
  // An import another account's project holds takes no edits (SPEC.md §29).
  if (await importShared(documentId)) return importSharedResponse(t);
  if (!(await featureConfigured("suggest"))) return NextResponse.json({ error: t("api.suggestNeedsKey") }, { status: 503 });

  const userId = access.user.id;
  // Windows not started by the deadline are reported, and calls still
  // running then stop: the route's 300 s keep the rest for the stream's end.
  const deadline = AbortSignal.timeout(SUGGEST_DEADLINE_MS);
  const signal = AbortSignal.any([req.signal, deadline]);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = ndjsonWriter(controller);
      // Nobody reads once the reader stopped.
      const send = (event: SuggestEvent) => {
        if (!cancelled) write(event);
      };
      const stopHeartbeat = ndjsonHeartbeat(controller);
      try {
        send({ stage: "read" });
        const [profile, lang] = await Promise.all([loadProfile(data.notebookId), currentLang()]);
        const doc = suggestDocument(document);
        const whole = !data.blockIds?.length;
        const scope = whole ? doc.rows.map((r) => r.id) : scopeOf(doc.rows, doc.places, data.blockIds!);
        if (scope.length === 0) throw new Error(t("api.blockNotInDocument"));
        let all = windowsOf(doc.rows, doc.places, scope);
        // A scope past the windows of one command: the target pass names the
        // blocks the command changes, and the windows run over those alone
        // (lib/assistant/target.ts).
        let targeted = false;
        if (all.length > SUGGEST_MAX_WINDOWS && !fitsOnePass(doc.rows, whole ? [] : scope)) {
          const rows = await runTargetPass({
            userId,
            document: { title: doc.title, references: doc.references, rows: doc.rows, pageName: doc.pageName },
            scope,
            whole,
            profile,
            command: data.command,
            instruction: data.instruction ?? null,
            history: data.history ?? [],
            signal,
          });
          if (rows) {
            all = windowsOf(doc.rows, doc.places, rows);
            targeted = true;
          }
        }
        const windows = all.slice(0, SUGGEST_MAX_WINDOWS);
        const warnings = all.length > windows.length ? [t("api.suggestTooLong")] : [];
        if (whole || windows.length > 1) await keepVersionBeforeSuggestions(documentId, t("api.suggestVersionName"));
        // A scope that fits one call: the one pass, the whole document read
        // at once and its answer by reference (lib/assistant/one-pass.ts).
        if (fitsOnePass(doc.rows, whole ? [] : scope)) {
          send({ windows: 1 });
          const units = richTextUnits(doc.richText!, doc.rows);
          const pass = await runOnePass({
            userId,
            document: { title: doc.title, references: doc.references, rows: doc.rows, pageName: doc.pageName },
            units,
            places: doc.places,
            scopeRowIds: whole ? [] : scope,
            profile,
            lang,
            t,
            command: data.command,
            instruction: data.instruction ?? null,
            material: data.material ?? null,
            history: data.history ?? [],
            caretBlockId: data.caretBlockId ?? null,
            thinking: data.thinking ?? "deep",
            plan: false,
            signal,
          });
          const first = Math.max(-1, ...pass.ops.map((op) => op.i)) + 1;
          const moves = pass.order ? orderSuggestOps(units, pass.scope, { ...pass.order, removed: [] }, doc.rows, pass.why, first) : [];
          const ops = [...pass.ops, ...moves];
          send({ window: 1, ops, warnings: pass.warnings, summary: pass.summary });
          console.log(`[suggest] ${documentId}: one pass, ${ops.length} ops`);
          send({ done: true, summary: pass.summary, warnings });
          return;
        }
        send({ windows: windows.length + (data.reorder ? 1 : 0) });
        const units = data.reorder ? richTextUnits(doc.richText!, doc.rows) : [];
        const ordering = data.reorder
          ? runOrderPass({
              userId,
              document: { title: doc.title, references: doc.references, rows: doc.rows, pageName: doc.pageName },
              units,
              scopeRowIds: whole ? [] : scope,
              profile,
              lang,
              t,
              command: data.command,
              instruction: data.instruction ?? null,
              material: data.material ?? null,
              history: data.history ?? [],
              thinking: data.thinking ?? "deep",
              signal,
            }).catch((err: unknown) => err instanceof Error ? err : new Error(String(err)))
          : null;

        const budget = { chars: SUGGEST_MAX_NEW_CHARS };
        const summaries: string[] = [];
        const changed = new Set<number>();
        let late = false;
        await mapLimit(windows, SUGGEST_PARALLEL, async (blockIds, i) => {
          // The first window writes the prefix to the cache; the others of the
          // first wave start a second later and read it.
          if (i > 0 && i < SUGGEST_PARALLEL) await new Promise((resolve) => setTimeout(resolve, 1000));
          if (signal.aborted) {
            late ||= deadline.aborted;
            return;
          }
          try {
            const result = await runSuggest({
              userId,
              document: doc,
              profile,
              lang,
              t,
              command: data.command,
              instruction: data.instruction ?? null,
              material: data.material ?? null,
              history: data.history ?? [],
              scope: { kind: "blocks", blockIds },
              window: { n: i + 1, of: windows.length, whole: whole && !targeted },
              caretBlockId: data.caretBlockId ?? null,
              thinking: data.thinking ?? "deep",
              budget,
              signal,
              reorder: data.reorder,
            });
            summaries[i] = result.summary;
            if (result.ops.length > 0) changed.add(i);
            send({ window: i + 1, ...result });
          } catch (err) {
            if (deadline.aborted) late = true;
            else send({ window: i + 1, error: failureLine(t, err, "suggest window") });
          }
        });
        if (late) warnings.push(t("api.suggestOutOfTime"));
        // The order's moves, after the windows' words.
        const order = ordering ? await ordering : null;
        let moved = "";
        if (order instanceof Error) send({ window: windows.length + 1, error: modelErrorMessage(order) });
        else if (order) {
          const ops = order.plan ? orderSuggestOps(units, order.scope, order.plan, doc.rows, order.why) : [];
          if (ops.length > 0) moved = order.summary;
          send({ window: windows.length + 1, ops, warnings: order.warnings, summary: order.summary });
        }
        // The distinct summaries of the windows that changed something, in
        // order; with none, the first window's word on why.
        const said = [...new Set([moved, ...summaries.filter((s, i) => s && changed.has(i))].filter(Boolean))];
        const summary = said.length > 0 ? said.join(" ") : (summaries.find(Boolean) ?? "");
        console.log(`[suggest] ${documentId}: ${windows.length} windows, ${changed.size} with changes${late ? ", out of time" : ""}`);
        send({ done: true, summary, warnings });
      } catch (err) {
        console.error("[suggest] failed:", err);
        send({ error: failureLine(t, err, "suggest") });
      } finally {
        stopHeartbeat();
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

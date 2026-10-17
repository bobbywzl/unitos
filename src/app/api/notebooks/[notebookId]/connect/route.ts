import { NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { linkScanRunsLeft, LINK_SCAN_RUNS_PER_MONTH, scanProject } from "@/lib/connect";
import { db } from "@/lib/db";
import { currentLang, serverT } from "@/lib/i18n/server";
import { kimiConfigured } from "@/lib/kimi";

// Two passes over whole documents, for several documents (lib/connect.ts).
export const maxDuration = 300;

// Recommend links (SPEC.md §13): the project scan the reader asks for from
// the graph. Nothing scans on its own — the scan reads whole documents
// against whole documents — so this route is the only way links are
// proposed, and an account gets LINK_SCAN_RUNS_PER_MONTH runs a calendar
// month. The run is recorded before the scan starts, so a run that fails
// still spends its place: the model calls it made were paid for.
export async function POST(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  if (!kimiConfigured()) {
    return NextResponse.json({ error: t("api.deriveNeedsKey") }, { status: 503 });
  }
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;

  const left = await linkScanRunsLeft(access.user.id);
  if (left <= 0) {
    return NextResponse.json(
      { error: t("api.linkScanQuotaSpent", { n: LINK_SCAN_RUNS_PER_MONTH }), runsLeft: 0 },
      { status: 429 },
    );
  }
  const run = await db.linkScanRun.create({
    data: { userId: access.user.id, notebookId },
    select: { id: true },
  });
  const lang = await currentLang();
  const result = await scanProject(notebookId, access.user.id, { lang, signal: req.signal });
  await db.linkScanRun
    .update({ where: { id: run.id }, data: { linkCount: result.linkCount } })
    .catch(() => {});
  return NextResponse.json({ ok: true, ...result, runsLeft: left - 1 });
}

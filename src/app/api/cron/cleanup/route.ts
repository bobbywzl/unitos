import { NextResponse } from "next/server";
import { CLICK_RETENTION_DAYS } from "@/lib/clicks";
import { db } from "@/lib/db";

// Rejected notes keep for 7 days for undo, then hard-delete (SPEC.md §3).
// Called by a scheduler (vercel.json cron). Requires CRON_SECRET.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const deleted = await db.note.deleteMany({
    where: { status: "REJECTED", updatedAt: { lt: cutoff } },
  });
  // Presence rows read as gone after 25 seconds; rows older than a day are litter.
  await db.notebookPresence.deleteMany({
    where: { lastSeenAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  // Click telemetry keeps 180 days (SPEC.md §7).
  await db.clickEvent.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - CLICK_RETENTION_DAYS * 24 * 60 * 60 * 1000) } },
  });
  return NextResponse.json({ ok: true, deleted: deleted.count });
}

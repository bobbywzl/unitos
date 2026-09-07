import { NextResponse } from "next/server";
import { updateModels } from "@/lib/model-update";

// The bimonthly model update (SPEC.md §2, lib/model-update.ts): every role
// moves to the newest version of its family as the provider publishes it.
// Called by a scheduler (vercel.json cron, the 1st of every second month).
// Requires CRON_SECRET.
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await updateModels();
  return NextResponse.json({ ok: true, results });
}

import { NextResponse } from "next/server";
import { adminApiGuard } from "@/lib/admin-auth";
import { updateModels } from "@/lib/model-update";

// Check now: the admin runs the model update outside its schedule
// (lib/model-update.ts).
export const maxDuration = 300;

export async function POST() {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const results = await updateModels();
  return NextResponse.json({ ok: true, results });
}

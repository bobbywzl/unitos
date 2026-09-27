import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { importPageEditorOn, setImportPageEditorOn } from "@/lib/docs/import-switch";
import { parseBody } from "@/lib/validate";

// Admin: the import switch (SPEC.md §30). It changes what the next add
// makes; documents already added keep the form they were made in.
const switchSchema = z.object({ on: z.boolean() });

export async function POST(req: Request) {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, switchSchema);
  if (error) return error;
  await setImportPageEditorOn(data.on);
  return NextResponse.json({ ok: true, on: await importPageEditorOn() });
}

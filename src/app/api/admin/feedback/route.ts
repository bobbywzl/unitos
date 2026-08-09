import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

export async function GET() {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const feedback = await db.feedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return NextResponse.json(feedback);
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["new", "seen", "resolved"]),
});

// Triage: new → seen → resolved.
export async function PATCH(req: Request) {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const updated = await db.feedback
    .update({ where: { id: data.id }, data: { status: data.status } })
    .catch(() => null);
  if (!updated) return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
  return NextResponse.json(updated);
}

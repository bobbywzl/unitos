import { NextResponse } from "next/server";
import { documentAccess } from "@/lib/collab";
import { documentFootprint, editableNotebooks } from "@/lib/document-footprint";

// What Delete document would reach, for the confirm dialog: how many
// annotations go with it, how many notes stay, and whether a project the
// caller cannot edit holds it (then Delete only removes it from the
// caller's projects, and nothing goes).
export async function GET(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const footprint = await documentFootprint(documentId);
  const editable = await editableNotebooks(footprint.involved, access.user);
  const shared = footprint.involved.some((id) => !editable.has(id));
  return NextResponse.json({ annotations: shared ? 0 : footprint.annotations.length, notes: footprint.notes, shared });
}

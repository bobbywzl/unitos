import { NextResponse } from "next/server";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { documentFootprint, editableNotebooks, openableNotebooks } from "@/lib/document-footprint";

// What Delete document would reach, for the confirm: how many annotations
// go with it, how many notes stay, whether a project the caller cannot edit
// holds it (then Delete only removes it from the caller's projects, and
// nothing goes), and where it is: the projects the caller can edit that
// hold it, by name, and how many other accounts' projects hold it. The
// reader sees every project a delete reaches before agreeing. `openProjects`
// are the projects holding it that the caller can open (any role): Remove
// from this project is offered only while another of them holds it.
export async function GET(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const footprint = await documentFootprint(documentId);
  const editable = await editableNotebooks(footprint.involved, access.user);
  const shared = footprint.involved.some((id) => !editable.has(id));
  const mine = footprint.attached.filter((id) => editable.has(id));
  const rows = await db.notebook.findMany({ where: { id: { in: mine } }, select: { id: true, title: true } });
  const projects = mine.flatMap((id) => rows.filter((r) => r.id === id));
  const open = await openableNotebooks(footprint.attached, access.user);
  return NextResponse.json({
    annotations: shared ? 0 : footprint.annotations.length,
    notes: footprint.notes,
    shared,
    projects,
    otherProjects: footprint.attached.length - mine.length,
    openProjects: footprint.attached.filter((id) => open.has(id)),
  });
}

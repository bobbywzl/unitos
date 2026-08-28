import { NextResponse } from "next/server";
import { z } from "zod";
import { authEnabled } from "@/lib/auth";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { personOf, type Person } from "@/lib/person";
import { parseBody } from "@/lib/validate";

// Share management (Google Docs pattern): the owner adds collaborators by
// email with a role — editor writes like the owner, viewer reads only. Rows key
// on the email, so an invite works before the account exists. The owner manages
// the list; a collaborator can read it and remove themself (leave).

const MAX_COLLABORATORS = 30;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(320));

type CollaboratorRow = {
  email: string;
  role: "editor" | "viewer";
  // The badge once the account exists; null = invited, not signed up yet.
  person: Person | null;
};

async function collaboratorList(notebookId: string): Promise<{
  owner: (Person & { email: string }) | null;
  collaborators: CollaboratorRow[];
}> {
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    select: {
      userId: true,
      collaborators: { orderBy: { createdAt: "asc" }, select: { email: true, role: true } },
    },
  });
  if (!notebook) return { owner: null, collaborators: [] };
  const owner = await db.user.findUnique({ where: { id: notebook.userId } });
  const users = await db.user.findMany({
    where: { email: { in: notebook.collaborators.map((c) => c.email) } },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  return {
    owner: owner ? { ...personOf(owner), email: owner.email } : null,
    collaborators: notebook.collaborators.map((c) => {
      const user = byEmail.get(c.email);
      return {
        email: c.email,
        role: c.role === "EDITOR" ? "editor" : "viewer",
        person: user ? personOf(user) : null,
      };
    }),
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const list = await collaboratorList(notebookId);
  return NextResponse.json({ ...list, myRole: access.role });
}

const addSchema = z.object({
  email: emailSchema,
  role: z.enum(["editor", "viewer"]),
});

// Add or re-role one collaborator. Owner only.
export async function POST(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  if (!authEnabled()) {
    return NextResponse.json({ error: t("api.sharingNeedsSignIn") }, { status: 400 });
  }
  const access = await notebookAccess(notebookId, "owner");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, addSchema);
  if (error) return error;

  if (data.email === access.user.email) {
    return NextResponse.json({ error: t("api.cannotShareWithOwner") }, { status: 400 });
  }
  const count = await db.notebookCollaborator.count({ where: { notebookId } });
  const existing = await db.notebookCollaborator.findUnique({
    where: { notebookId_email: { notebookId, email: data.email } },
  });
  if (!existing && count >= MAX_COLLABORATORS) {
    return NextResponse.json({ error: t("api.collaboratorLimit") }, { status: 400 });
  }
  await db.notebookCollaborator.upsert({
    where: { notebookId_email: { notebookId, email: data.email } },
    update: { role: data.role === "editor" ? "EDITOR" : "VIEWER" },
    create: {
      notebookId,
      email: data.email,
      role: data.role === "editor" ? "EDITOR" : "VIEWER",
      addedById: access.user.id,
    },
  });
  await bumpNotebook(notebookId);
  const list = await collaboratorList(notebookId);
  return NextResponse.json({ ...list, myRole: access.role }, { status: existing ? 200 : 201 });
}

const removeSchema = z.object({ email: emailSchema });

// Remove one collaborator: the owner removes anyone; a collaborator removes
// themself (leave).
export async function DELETE(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, removeSchema);
  if (error) return error;

  if (access.role !== "owner" && data.email !== access.user.email) {
    return NextResponse.json({ error: t("api.ownerOnly") }, { status: 403 });
  }
  const removed = await db.notebookCollaborator
    .delete({ where: { notebookId_email: { notebookId, email: data.email } } })
    .catch(() => null);
  if (!removed) {
    return NextResponse.json({ error: t("api.collaboratorNotFound") }, { status: 404 });
  }
  const removedUser = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (removedUser) {
    await db.notebookPresence
      .deleteMany({ where: { notebookId, userId: removedUser.id } })
      .catch(() => {});
  }
  await bumpNotebook(notebookId);
  const list = await collaboratorList(notebookId);
  return NextResponse.json({ ...list, myRole: data.email === access.user.email ? null : access.role });
}

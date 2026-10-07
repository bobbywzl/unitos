import { Prisma, type User } from "@prisma/client";
import { NextResponse } from "next/server";
import { authEnabled, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { personOf, type NotebookRole, type Person } from "@/lib/person";

// Per-object access control (the migration SPEC.md §2 announced). A corpus has
// one owner (Notebook.userId) and any number of collaborators
// (NotebookCollaborator rows, keyed by email, role EDITOR or VIEWER). Every
// route that reads a corpus requires viewer; every route that writes requires
// editor; delete and share management require owner. With sign-in off there is
// one reader and every check answers owner.

const RANK: Record<NotebookRole, number> = { viewer: 0, editor: 1, owner: 2 };

export type NotebookAccess = { user: User; role: NotebookRole };

type NotebookForRole = {
  userId: string;
  collaborators: { email: string; role: "EDITOR" | "VIEWER" }[];
};

export function roleOf(notebook: NotebookForRole, user: User): NotebookRole | null {
  if (notebook.userId === user.id) return "owner";
  const row = notebook.collaborators.find((c) => c.email === user.email);
  if (!row) return null;
  return row.role === "EDITOR" ? "editor" : "viewer";
}

// The role denial: a member below the required role answers 403; a non-member
// answers 404 — the corpus's existence is not disclosed.
async function denied(role: NotebookRole | null, min: NotebookRole): Promise<NextResponse | null> {
  if (role !== null && RANK[role] >= RANK[min]) return null;
  const t = await serverT();
  if (role === null) {
    return NextResponse.json({ error: t("common.corpusNotFound") }, { status: 404 });
  }
  return NextResponse.json(
    { error: t(min === "owner" ? "api.ownerOnly" : "api.viewingOnly") },
    { status: 403 },
  );
}

async function requireUser(): Promise<User | NextResponse> {
  const user = await currentUser();
  if (user) return user;
  const t = await serverT();
  return NextResponse.json({ error: t("common.signInToContinue") }, { status: 401 });
}

// Access gate for corpus routes: the signed-in account and its role, or the
// response to send.
export async function notebookAccess(
  notebookId: string,
  min: NotebookRole,
): Promise<NotebookAccess | NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  if (!authEnabled()) return { user, role: "owner" };
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    select: { userId: true, collaborators: { select: { email: true, role: true } } },
  });
  if (!notebook) {
    const t = await serverT();
    return NextResponse.json({ error: t("common.corpusNotFound") }, { status: 404 });
  }
  const role = roleOf(notebook, user);
  const deny = await denied(role, min);
  if (deny) return deny;
  return { user, role: role! };
}

// Access gate for document routes (blocks, links, reparse): the best role
// across the corpora the document is attached to. A document attached to
// nothing keeps the id-capability behavior — any signed-in reader.
export async function documentAccess(
  documentId: string,
  min: NotebookRole,
): Promise<NotebookAccess | NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  if (!authEnabled()) return { user, role: "owner" };
  const attachments = await db.notebookDocument.findMany({
    where: { documentId },
    select: {
      notebook: {
        select: { userId: true, collaborators: { select: { email: true, role: true } } },
      },
    },
  });
  if (attachments.length === 0) return { user, role: "owner" };
  let best: NotebookRole | null = null;
  for (const a of attachments) {
    const role = roleOf(a.notebook, user);
    if (role && (best === null || RANK[role] > RANK[best])) best = role;
  }
  const deny = await denied(best, min);
  if (deny) return deny;
  return { user, role: best! };
}

// ── Links ───────────────────────────────────────────────────────────────────
// A link is changed only in its own project (DocLink.notebookId, SPEC.md
// §13); the reads are lib/link-scope.ts.

/** Access gate for one link. A link of a project answers to the caller's role
    there; a link with no project to the best role over its from-document.
    `scope` is the project the request comes from: a link of another project
    is not found there (404), and so is a link of a project the caller is not
    in. */
export async function linkAccess(
  link: { notebookId: string | null; fromDocumentId: string },
  min: NotebookRole,
  scope?: string | null,
): Promise<NotebookAccess | NextResponse> {
  if (!link.notebookId) return documentAccess(link.fromDocumentId, min);
  const notFound = async () => {
    const t = await serverT();
    return NextResponse.json({ error: t("api.linkNotFound") }, { status: 404 });
  };
  if (scope && scope !== link.notebookId) return notFound();
  const access = await notebookAccess(link.notebookId, min);
  if (access instanceof NextResponse && access.status === 404) return notFound();
  return access;
}

/** A link with no project whose documents sit in projects of more than one
    account: removing it would remove it for the others too, so only the
    account that made it removes it (rule zero item 2). */
export async function legacyLinkSharedAcrossAccounts(link: {
  notebookId: string | null;
  fromDocumentId: string;
  toDocumentId: string;
}): Promise<boolean> {
  if (link.notebookId || !authEnabled()) return false;
  const holders = await db.notebook.findMany({
    where: {
      AND: [
        { documents: { some: { documentId: link.fromDocumentId } } },
        { documents: { some: { documentId: link.toDocumentId } } },
      ],
    },
    select: { userId: true },
  });
  return new Set(holders.map((h) => h.userId)).size > 1;
}

/** A document's edit history read from one project, without the LINK_ADD and
    LINK_REMOVE edits of another project's links: meta.notebookId names the
    link's project (edits since links carried one); an older LINK_ADD whose
    link still exists answers by the link's project. An older edit that
    tells neither keeps showing, as before. */
export async function withoutOtherProjectLinkEdits<T extends { kind: string; meta: Prisma.JsonValue }>(
  edits: T[],
  notebookId: string,
): Promise<T[]> {
  const metaOf = (e: T) =>
    (e.meta && typeof e.meta === "object" && !Array.isArray(e.meta) ? e.meta : {}) as Record<string, unknown>;
  const isLinkEdit = (e: T) => e.kind === "LINK_ADD" || e.kind === "LINK_REMOVE";
  const linkIds = [
    ...new Set(
      edits.flatMap((e) => {
        const m = metaOf(e);
        return isLinkEdit(e) && typeof m.notebookId !== "string" && typeof m.linkId === "string" ? [m.linkId] : [];
      }),
    ),
  ];
  const projectOf = new Map(
    linkIds.length > 0
      ? (
          await db.docLink.findMany({ where: { id: { in: linkIds } }, select: { id: true, notebookId: true } })
        ).map((l) => [l.id, l.notebookId] as const)
      : [],
  );
  return edits.filter((e) => {
    if (!isLinkEdit(e)) return true;
    const m = metaOf(e);
    const project =
      typeof m.notebookId === "string" ? m.notebookId : typeof m.linkId === "string" ? projectOf.get(m.linkId) : null;
    return !project || project === notebookId;
  });
}

export async function sectionAccess(
  sectionId: string,
  min: NotebookRole,
): Promise<NotebookAccess | NextResponse> {
  const section = await db.section.findUnique({
    where: { id: sectionId },
    select: { notebookId: true },
  });
  if (!section) {
    const t = await serverT();
    return NextResponse.json({ error: t("api.sectionNotFound") }, { status: 404 });
  }
  return notebookAccess(section.notebookId, min);
}

export async function noteAccess(
  noteId: string,
  min: NotebookRole,
): Promise<NotebookAccess | NextResponse> {
  const note = await db.note.findUnique({
    where: { id: noteId },
    select: { section: { select: { notebookId: true } } },
  });
  if (!note) {
    const t = await serverT();
    return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  }
  return notebookAccess(note.section.notebookId, min);
}

// ── Live sync ───────────────────────────────────────────────────────────────
// Every write bumps the corpus's rev; open workspaces poll the rev and refresh
// when it moves. Document writes bump every corpus the document is attached to.

export async function bumpNotebook(notebookId: string): Promise<void> {
  await db.notebook
    .update({ where: { id: notebookId }, data: { rev: { increment: 1 } } })
    .catch(() => {});
}

/** Answers each corpus's new rev, so a page that made the change knows it. */
export async function bumpDocument(documentId: string): Promise<Record<string, number>> {
  const attachments = await db.notebookDocument.findMany({
    where: { documentId },
    select: { notebookId: true },
  });
  if (attachments.length === 0) return {};
  const ids = attachments.map((a) => a.notebookId);
  const rows = await db
    .$queryRaw<{ id: string; rev: number }[]>`
      UPDATE "Notebook" SET "rev" = "rev" + 1 WHERE "id" IN (${Prisma.join(ids)}) RETURNING "id", "rev"`
    .catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.id, r.rev]));
}

// ── People ──────────────────────────────────────────────────────────────────

// Badges for a set of account ids. Ids without an account (the local reader,
// a deleted account) are dropped; callers fall back to no label.
export async function peopleByIds(userIds: Iterable<string>): Promise<Record<string, Person>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return {};
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      symbol: true,
      color: true,
      picture: true,
      tier: true,
      trialEndsAt: true,
    },
  });
  return Object.fromEntries(users.map((u) => [u.id, personOf(u)]));
}

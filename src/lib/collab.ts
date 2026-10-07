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

type LinkForAccess = {
  id: string;
  notebookId: string | null;
  formerNotebookId: string | null;
  fromDocumentId: string;
  toDocumentId: string;
};

/** Access gate for one link. A link of a project answers to the caller's role
    there. `scope` is the project the request comes from: a link of another
    project is not found there (404), and so is a link of a project the
    caller is not in. A link with no project, asked from a project, answers
    to the caller's role there, and is not found unless both its documents
    sit in that project; asked from no project (an older tab), to the best
    role over its from-document. A link whose project was deleted is not
    found, and neither is a link removed from the project it is asked from
    (DocLinkHidden). */
export async function linkAccess(
  link: LinkForAccess,
  min: NotebookRole,
  scope?: string | null,
): Promise<NotebookAccess | NextResponse> {
  const notFound = async () => {
    const t = await serverT();
    return NextResponse.json({ error: t("api.linkNotFound") }, { status: 404 });
  };
  if (!link.notebookId) {
    if (link.formerNotebookId) return notFound();
    if (!scope) {
      const access = await documentAccess(link.fromDocumentId, min);
      if (access instanceof NextResponse || !authEnabled() || RANK[min] < RANK.editor) return access;
      // An older tab names no project: a change answers 404 when the link
      // was removed from any project the caller edits that holds both its
      // documents, as the same change asked from that project would.
      const editable = await editableHolders(link, access.user, null);
      const hidden =
        editable.length > 0 &&
        (await db.docLinkHidden.count({ where: { docLinkId: link.id, notebookId: { in: editable } } })) > 0;
      return hidden ? notFound() : access;
    }
    const access = await notebookAccess(scope, min);
    if (access instanceof NextResponse) return access.status === 404 ? notFound() : access;
    if (!authEnabled()) return access;
    const ends = [...new Set([link.fromDocumentId, link.toDocumentId])];
    const held = await db.notebookDocument.count({ where: { notebookId: scope, documentId: { in: ends } } });
    if (held !== ends.length || (await hiddenIn(link.id, scope))) return notFound();
    return access;
  }
  if (scope && scope !== link.notebookId) return notFound();
  if (await hiddenIn(link.id, link.notebookId)) return notFound();
  const access = await notebookAccess(link.notebookId, min);
  if (access instanceof NextResponse && access.status === 404) return notFound();
  return access;
}

/** The link was removed from this project while its row stays. */
async function hiddenIn(docLinkId: string, notebookId: string): Promise<boolean> {
  return (await db.docLinkHidden.count({ where: { docLinkId, notebookId } })) > 0;
}

/** What one account may do on a link with no project whose documents sit in
    projects of more than one account (SPEC.md §13). Such a link answers to
    its maker's projects: the maker, and the editors of a project of the
    maker's that holds both documents, change it as on a link of that
    project. Everyone else who sees it reads it, and changes only the
    replies they wrote. No one deletes another account's reply on it. */
export type CrossAccountLink = {
  /** The link has no project, and its documents sit in projects of more
      than one account. */
  crossAccount: boolean;
  /** The caller is outside the maker's projects: no Reply, no reason edit,
      no Accept, no resolve of another account's reply. */
  outside: boolean;
  /** The caller made the link: only the maker removes or dismisses it. */
  removable: boolean;
};

type LinkForRule = LinkForAccess & { id: string; createdById: string | null; createdAt: Date };

/** The cross-account rule for many links at once: one query over the
    projects that hold their documents. Links of a project, and every link
    with sign-in off, are not cross-account. */
export async function crossAccountLinks(
  links: LinkForRule[],
  user: User | null,
): Promise<Map<string, CrossAccountLink>> {
  const out = new Map<string, CrossAccountLink>();
  const legacy = links.filter((l) => !l.notebookId && !l.formerNotebookId);
  if (legacy.length === 0 || !authEnabled()) return out;
  const docIds = [...new Set(legacy.flatMap((l) => [l.fromDocumentId, l.toDocumentId]))];
  const holders = await db.notebook.findMany({
    where: { documents: { some: { documentId: { in: docIds } } } },
    select: {
      userId: true,
      createdAt: true,
      collaborators: { select: { email: true, role: true } },
      documents: { where: { documentId: { in: docIds } }, select: { documentId: true } },
    },
  });
  for (const link of legacy) {
    const both = holders.filter((h) => {
      const held = new Set(h.documents.map((d) => d.documentId));
      return held.has(link.fromDocumentId) && held.has(link.toDocumentId);
    });
    if (new Set(both.map((h) => h.userId)).size <= 1) continue;
    // The maker's accounts: the account that made the link; for a link from
    // before links named their maker, the owners of the projects that
    // existed when it was made (a project made later is not where it was
    // made). When that is more than one account, no one is: the link reads
    // only, and each account changes only its own replies.
    const earlier = new Set(both.filter((h) => h.createdAt <= link.createdAt).map((h) => h.userId));
    const makers = link.createdById !== null ? new Set([link.createdById]) : earlier.size === 1 ? earlier : new Set();
    const inside =
      user !== null &&
      (makers.has(user.id) ||
        both.some((h) => {
          if (!makers.has(h.userId)) return false;
          const role = roleOf(h, user);
          return role !== null && RANK[role] >= RANK.editor;
        }));
    out.set(link.id, { crossAccount: true, outside: !inside, removable: user !== null && link.createdById === user.id });
  }
  return out;
}

/** The cross-account rule for one link. */
export async function crossAccountLink(link: LinkForRule, user: User): Promise<CrossAccountLink> {
  return (await crossAccountLinks([link], user)).get(link.id) ?? { crossAccount: false, outside: false, removable: true };
}

/** The projects that hold both documents of a link and that the caller
    edits: of `owner` only when one is named, else of every account. */
async function editableHolders(link: LinkForAccess, user: User, owner: string | null): Promise<string[]> {
  const ends = [...new Set([link.fromDocumentId, link.toDocumentId])];
  const holders = await db.notebook.findMany({
    where: {
      ...(authEnabled() && owner ? { userId: owner } : {}),
      AND: ends.map((documentId) => ({ documents: { some: { documentId } } })),
    },
    select: { id: true, userId: true, collaborators: { select: { email: true, role: true } } },
  });
  return holders
    .filter((h) => {
      if (!authEnabled()) return true;
      const role = roleOf(h, user);
      return role !== null && RANK[role] >= RANK.editor;
    })
    .map((h) => h.id);
}

/** Where a removal hides a link whose row has to stay (another account
    replied on it, or another account's project shows it; SPEC.md §13): a
    link of a project, in that project; a link with no project, in every
    project of the asking project's owner that holds both documents and
    that the caller edits, so it leaves the same projects a delete took it
    from and stays in every other account's project. Asked from no project
    (an older tab), in every project of any account that holds both
    documents and that the caller edits. An empty answer means the row
    can't be kept hidden anywhere: the caller refuses the removal. */
export async function linkHideProjects(
  link: LinkForAccess,
  user: User,
  scope: string | null,
): Promise<string[]> {
  if (link.notebookId) return [link.notebookId];
  if (!scope) return editableHolders(link, user, null);
  const owner = (await db.notebook.findUnique({ where: { id: scope }, select: { userId: true } }))?.userId ?? user.id;
  const ids = await editableHolders(link, user, owner);
  return ids.includes(scope) ? ids : [...ids, scope];
}

/** The answer when the cross-account rule refuses a change. */
export async function linkOfOtherAccount(): Promise<NextResponse> {
  const t = await serverT();
  return NextResponse.json({ error: t("api.linkOfOtherAccount") }, { status: 403 });
}

/** A link with no project whose documents sit in projects of more than one
    account: removing it would remove it for the others too, so only the
    account that made it removes it (rule zero item 2). */
export async function legacyLinkSharedAcrossAccounts(link: LinkForRule, user: User): Promise<boolean> {
  return (await crossAccountLink(link, user)).crossAccount;
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
          await db.docLink.findMany({
            where: { id: { in: linkIds } },
            select: { id: true, notebookId: true, formerNotebookId: true },
          })
        ).map((l) => [l.id, l.notebookId ?? l.formerNotebookId] as const)
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

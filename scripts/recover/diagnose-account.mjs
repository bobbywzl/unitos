// What happened to one account's notes and annotations: a read-only report.
//
// Usage: DATABASE_URL=... node scripts/recover/diagnose-account.mjs <email> [days]
//
// Every query runs in one READ ONLY transaction, so the script cannot change
// the database. days (default 14) is how far back the history and click
// sections look.
//
// The report:
//   1. The account: id, created, last seen. A createdAt newer than the
//      account's projects means an admin Reset account ran (lib/account-reset.ts
//      stamps createdAt anew).
//   2. Each project the account owns: sections, notes, annotations, documents.
//   3. The project history (NotebookEvent): note, section, and document
//      removals, with who did them.
//   4. Quotes that lost their document (Source.documentId null, the document
//      deleted) and notes whose document was deleted.
//   5. Documents in the account's projects that another account's project
//      also holds: the same file dedupes to one document, and before the
//      delete guard any editor of either project could delete it for both.
//   6. Clicks on delete, remove, reset, and merge controls in the account's
//      projects, by any account.
//   7. The notes the account wrote anywhere, by status.

import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.trim().toLowerCase();
const days = Number(process.argv[3] ?? 14);
if (!email || !Number.isFinite(days)) {
  console.error("Usage: DATABASE_URL=... node scripts/recover/diagnose-account.mjs <email> [days]");
  process.exit(1);
}
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const db = new PrismaClient();

function table(title, rows) {
  console.log(`\n== ${title} (${rows.length})`);
  if (rows.length > 0) console.table(rows);
}

try {
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

      const users = await tx.$queryRaw`
        SELECT "id", "email", "name", "tier", "createdAt", "lastSeenAt"
        FROM "User" WHERE lower("email") = ${email}`;
      table("Account", users);
      if (users.length === 0) {
        console.log("No account with this email.");
        return;
      }
      const userId = users[0].id;

      const projects = await tx.$queryRaw`
        SELECT n."id", n."title", n."createdAt", n."updatedAt",
          (SELECT count(*)::int FROM "Section" s WHERE s."notebookId" = n."id" AND NOT s."hidden") AS "sections",
          (SELECT count(*)::int FROM "Note" x JOIN "Section" s ON s."id" = x."sectionId"
             WHERE s."notebookId" = n."id" AND NOT s."hidden") AS "notes",
          (SELECT count(*)::int FROM "Note" x JOIN "Section" s ON s."id" = x."sectionId"
             WHERE s."notebookId" = n."id" AND s."hidden") AS "hiddenNotes",
          (SELECT count(*)::int FROM "NotebookDocument" d WHERE d."notebookId" = n."id") AS "documents"
        FROM "Notebook" n WHERE n."userId" = ${userId}
        ORDER BY n."createdAt"`;
      table("Projects the account owns (hiddenNotes = annotations and assistant conversations)", projects);

      const shared = await tx.$queryRaw`
        SELECT n."id", n."title", c."role", o."email" AS "owner"
        FROM "NotebookCollaborator" c
        JOIN "Notebook" n ON n."id" = c."notebookId"
        LEFT JOIN "User" o ON o."id" = n."userId"
        WHERE lower(c."email") = ${email}`;
      table("Projects shared with the account", shared);

      const events = await tx.$queryRaw`
        SELECT e."createdAt", n."title" AS "project", e."kind", left(e."content", 60) AS "content",
          e."meta", coalesce(u."email", e."userId") AS "by"
        FROM "NotebookEvent" e
        JOIN "Notebook" n ON n."id" = e."notebookId"
        LEFT JOIN "User" u ON u."id" = e."userId"
        WHERE n."userId" = ${userId} AND e."createdAt" >= ${since}
        ORDER BY e."createdAt"`;
      table(`Project history, last ${days} days`, events);

      const lostQuotes = await tx.$queryRaw`
        SELECT n."title" AS "project", s."hidden" AS "inHiddenSection", count(*)::int AS "sources",
          count(DISTINCT src."noteId")::int AS "notes"
        FROM "Source" src
        JOIN "Note" x ON x."id" = src."noteId"
        JOIN "Section" s ON s."id" = x."sectionId"
        JOIN "Notebook" n ON n."id" = s."notebookId"
        WHERE n."userId" = ${userId} AND src."documentId" IS NULL
        GROUP BY n."title", s."hidden"`;
      table("Quotes whose document was deleted", lostQuotes);

      const orphaned = await tx.$queryRaw`
        SELECT n."title" AS "project", count(*)::int AS "sources"
        FROM "Source" src
        JOIN "Note" x ON x."id" = src."noteId"
        JOIN "Section" s ON s."id" = x."sectionId"
        JOIN "Notebook" n ON n."id" = s."notebookId"
        WHERE n."userId" = ${userId} AND src."orphaned"
        GROUP BY n."title"`;
      table("Orphaned quotes (anchor not found, or document deleted)", orphaned);

      const sharedDocs = await tx.$queryRaw`
        SELECT d."id", left(d."title", 50) AS "title", mine."title" AS "project",
          other."title" AS "otherProject", ou."email" AS "otherOwner"
        FROM "NotebookDocument" nd
        JOIN "Notebook" mine ON mine."id" = nd."notebookId" AND mine."userId" = ${userId}
        JOIN "Document" d ON d."id" = nd."documentId"
        JOIN "NotebookDocument" nd2 ON nd2."documentId" = nd."documentId" AND nd2."notebookId" <> nd."notebookId"
        JOIN "Notebook" other ON other."id" = nd2."notebookId" AND other."userId" <> ${userId}
        LEFT JOIN "User" ou ON ou."id" = other."userId"`;
      table("Documents another account's project also holds", sharedDocs);

      const clicks = await tx.$queryRaw`
        SELECT c."createdAt", n."title" AS "project", c."surface", c."control",
          coalesce(u."email", c."userId") AS "by"
        FROM "ClickEvent" c
        LEFT JOIN "Notebook" n ON n."id" = c."notebookId"
        LEFT JOIN "User" u ON u."id" = c."userId"
        WHERE c."createdAt" >= ${since}
          AND (c."userId" = ${userId} OR n."userId" = ${userId})
          AND c."control" ~* '(delete|remove|reset|merge|clear|reparse|re-parse|detach)'
        ORDER BY c."createdAt"`;
      table(`Delete, remove, reset, merge, and re-parse clicks, last ${days} days`, clicks);

      const written = await tx.$queryRaw`
        SELECT x."status", s."hidden" AS "inHiddenSection", count(*)::int AS "notes",
          max(x."updatedAt") AS "lastUpdated"
        FROM "Note" x JOIN "Section" s ON s."id" = x."sectionId"
        WHERE x."createdById" = ${userId}
        GROUP BY x."status", s."hidden"`;
      table("Notes the account wrote, in any project", written);

      const edits = await tx.$queryRaw`
        SELECT count(*)::int AS "noteEdits", max("createdAt") AS "lastEdit"
        FROM "NoteEdit" WHERE "userId" = ${userId}`;
      table("Note edits the account made (these go when their note is deleted)", edits);
    },
    { timeout: 120_000 },
  );
} finally {
  await db.$disconnect();
}

// Fill DocLink.notebookId for the links made before links carried a project
// (migration 20261007100000_doclink_notebook, SPEC.md §13).
//
// Usage: DATABASE_URL=... node scripts/backfill-doclink-notebook.mjs [--apply] [--verbose]
//
// Without --apply it is a dry run: every query runs in one READ ONLY
// transaction and the script prints what it would write. With --apply it
// writes the one column DocLink.notebookId, only on rows where it is null,
// in one transaction. It never writes another column, never writes another
// table, and never inserts or deletes a row.
//
// The rule, for each link whose notebookId is null:
//   1. The projects that hold both of its documents (NotebookDocument rows
//      for the from-document and the to-document; for a link inside one
//      document, the projects that hold that document).
//   2. Certain: exactly one such project. The link gets it.
//   3. By creator: several such projects, and the account that made the link
//      (DocLink.createdById) can edit exactly one of them (its owner, or an
//      EDITOR collaborator by email). The link gets that one: a link is made
//      from a project the maker can edit.
//   4. Kept for others: a link of case 2 or 3 stays null when an account
//      that wrote a reply on it, or accepted it (a LINK_ADD edit naming it),
//      cannot open the chosen project (not its owner, not a collaborator by
//      email). Scoping it would hide that account's reply or accept from the
//      project it was written in (rule zero items 1 and 4).
//   5. Otherwise the link stays null and keeps showing in every project that
//      holds both documents, as before (rule zero item 4):
//        ambiguous: several projects, and the maker can edit none or several;
//        unknown: no project holds both documents.
//   A link whose project was deleted (formerNotebookId set) is never given a
//   project: it stays kept and shown nowhere.

import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const verbose = process.argv.includes("--verbose");
const db = new PrismaClient();

/** The plan: the links to write, and the counts by case. */
async function plan(tx) {
  const column = await tx.$queryRaw`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'DocLink' AND column_name = 'notebookId'`;
  if (column.length === 0) {
    throw new Error('DocLink.notebookId does not exist: run "prisma migrate deploy" first.');
  }
  const former = await tx.$queryRaw`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'DocLink' AND column_name = 'formerNotebookId'`;
  if (former.length === 0) {
    throw new Error('DocLink.formerNotebookId does not exist: run "prisma migrate deploy" first.');
  }
  const total = await tx.$queryRaw`SELECT count(*)::int AS n FROM "DocLink"`;
  const scoped = await tx.$queryRaw`SELECT count(*)::int AS n FROM "DocLink" WHERE "notebookId" IS NOT NULL`;
  // Each null link with the projects that hold both its documents, and the
  // ones of those its maker can edit.
  const rows = await tx.$queryRaw`
    SELECT l."id",
      coalesce(array_agg(DISTINCT n."id") FILTER (WHERE n."id" IS NOT NULL), '{}') AS "projects",
      coalesce(array_agg(DISTINCT n."id") FILTER (
        WHERE n."id" IS NOT NULL AND l."createdById" IS NOT NULL AND (
          n."userId" = l."createdById"
          OR EXISTS (
            SELECT 1 FROM "NotebookCollaborator" c JOIN "User" u ON lower(u."email") = lower(c."email")
            WHERE c."notebookId" = n."id" AND c."role" = 'EDITOR' AND u."id" = l."createdById"
          )
        )
      ), '{}') AS "makerProjects"
    FROM "DocLink" l
    LEFT JOIN "NotebookDocument" a ON a."documentId" = l."fromDocumentId"
    LEFT JOIN "NotebookDocument" b ON b."notebookId" = a."notebookId" AND b."documentId" = l."toDocumentId"
    LEFT JOIN "Notebook" n ON n."id" = b."notebookId"
    WHERE l."notebookId" IS NULL AND l."formerNotebookId" IS NULL
    GROUP BY l."id"
    ORDER BY l."id"`;
  // The accounts that acted on each null link: reply authors, and the
  // accounts whose LINK_ADD edit names it (accepters).
  const actorRows = await tx.$queryRaw`
    SELECT x."linkId", array_agg(DISTINCT x."userId") AS "actors"
    FROM (
      SELECT r."docLinkId" AS "linkId", r."userId" FROM "Reply" r
      WHERE r."docLinkId" IS NOT NULL
      UNION
      SELECT e."meta"->>'linkId', e."userId" FROM "BlockEdit" e
      WHERE e."kind" = 'LINK_ADD' AND e."userId" IS NOT NULL AND e."meta"->>'linkId' IS NOT NULL
    ) x
    JOIN "DocLink" l ON l."id" = x."linkId" AND l."notebookId" IS NULL
    GROUP BY x."linkId"`;
  const actorsOf = new Map(actorRows.map((r) => [r.linkId, r.actors]));
  // Who can open each project: its owner, and its collaborators by email.
  const memberRows = await tx.$queryRaw`
    SELECT n."id", n."userId" AS "uid" FROM "Notebook" n
    UNION
    SELECT c."notebookId", u."id" FROM "NotebookCollaborator" c
    JOIN "User" u ON lower(u."email") = lower(c."email")`;
  const members = new Map();
  for (const m of memberRows) {
    if (!members.has(m.id)) members.set(m.id, new Set());
    members.get(m.id).add(m.uid);
  }
  /** The accounts that acted on the link and cannot open the project. */
  const outsiders = (linkId, notebookId) =>
    (actorsOf.get(linkId) ?? []).filter((uid) => !members.get(notebookId)?.has(uid));

  const writes = [];
  const counts = { certain: 0, byCreator: 0, keptForOthers: 0, ambiguous: 0, unknown: 0 };
  for (const r of rows) {
    const chosen =
      r.projects.length === 1
        ? { notebookId: r.projects[0], why: "certain" }
        : r.projects.length > 1 && r.makerProjects.length === 1
          ? { notebookId: r.makerProjects[0], why: "by creator" }
          : null;
    const outside = chosen ? outsiders(r.id, chosen.notebookId) : [];
    if (chosen && outside.length > 0) {
      counts.keptForOthers++;
      if (verbose) console.log(`kept      ${r.id}: ${chosen.why} ${chosen.notebookId}, but ${outside.join(", ")} cannot open it`);
    } else if (chosen) {
      counts[chosen.why === "certain" ? "certain" : "byCreator"]++;
      writes.push({ id: r.id, ...chosen });
    } else if (r.projects.length > 1) {
      counts.ambiguous++;
      if (verbose) console.log(`ambiguous ${r.id}: ${r.projects.join(", ")}`);
    } else {
      counts.unknown++;
      if (verbose) console.log(`unknown   ${r.id}`);
    }
  }
  return { total: total[0].n, alreadyScoped: scoped[0].n, nullLinks: rows.length, counts, writes };
}

function report(p) {
  console.log(`Links: ${p.total} (already with a project: ${p.alreadyScoped}, with none: ${p.nullLinks})`);
  console.log(`  certain    (one project holds both documents):      ${p.counts.certain}`);
  console.log(`  by creator (the maker edits one of those projects): ${p.counts.byCreator}`);
  console.log(`  ambiguous  (replies or accepts from accounts outside that project, left null): ${p.counts.keptForOthers}`);
  console.log(`  ambiguous  (several projects, left null):           ${p.counts.ambiguous}`);
  console.log(`  unknown    (no project holds both, left null):      ${p.counts.unknown}`);
  if (verbose) for (const w of p.writes) console.log(`write ${w.id} -> ${w.notebookId} (${w.why})`);
}

try {
  if (!apply) {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      report(await plan(tx));
    });
    console.log("Dry run: nothing written. Run with --apply to write DocLink.notebookId.");
  } else {
    await db.$transaction(
      async (tx) => {
        const p = await plan(tx);
        report(p);
        let written = 0;
        for (let i = 0; i < p.writes.length; i += 500) {
          const chunk = p.writes.slice(i, i + 500);
          // Only the new column, only where it is still null.
          written += await tx.$executeRawUnsafe(
            `UPDATE "DocLink" AS l SET "notebookId" = v.nb
             FROM unnest($1::text[], $2::text[]) AS v(id, nb)
             WHERE l."id" = v.id AND l."notebookId" IS NULL AND l."formerNotebookId" IS NULL`,
            chunk.map((w) => w.id),
            chunk.map((w) => w.notebookId),
          );
        }
        console.log(`Applied: ${written} link(s) got a project.`);
      },
      { timeout: 120_000 },
    );
  }
} finally {
  await db.$disconnect();
}

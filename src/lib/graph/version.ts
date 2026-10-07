import { createHash } from "node:crypto";
import type { User } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { authEnabled } from "@/lib/auth";
import { db } from "@/lib/db";
import { LINK_SCAN_RUNS_PER_MONTH, monthStart } from "@/lib/connect";
import { SKELETON_VERSION } from "@/lib/graph/skeleton";

// The graph's version key (COST4-07): a hash, from one query, of every input
// graphData reads for (project, viewer, provenance), so GET .../graph can
// answer 304 before it builds the body. The body costs 80–160 ms to build;
// the key reads no block text and sends no link or reply text to the server
// (the hashes run in the database).
//
// Contract:
// - Same inputs, same key: the key changes whenever graphData's answer can
//   change. It covers the attached documents (id, title, generatedCommand,
//   createdAt, video, the gist), each document's block count, the
//   project's links (projectLinks: in the project or in none, not hidden in
//   it; every field graphData reads), their replies (every field), the
//   people who made them or replied (the Person fields and whether a trial
//   is running), the cross-account inputs of a link with no project (the
//   projects that hold its documents: owner, createdAt, collaborators and
//   roles, which of the documents they hold), and the viewer's part (id,
//   email, the Recommend links runs this month, the month, sign-in on or
//   off), the provenance flag, the deploy, and GRAPH_KEY_VERSION.
// - A key can change when the answer did not (a reply on a provenance link
//   with ?provenance off): that costs one full answer, never a stale one.
// - Bump GRAPH_KEY_VERSION whenever graphData reads a new input, and add
//   the input here; graph-version-check.ts compares the key against the
//   body hash on every change it makes.
// - Route wiring (left to the integrator): ETag = `"k<GRAPH_KEY_VERSION>-<key>"`;
//   when If-None-Match carries it, answer 304 without graphData; otherwise
//   build the body and send it with that ETag. Anything else the ETag must
//   cover (SAFE4: the link ends' block versions) goes into this query as
//   one more part, not into a body hash.
export const GRAPH_KEY_VERSION = 1;

export async function graphVersionKey(
  notebookId: string,
  viewer: User,
  { provenance = false }: { provenance?: boolean } = {},
): Promise<string> {
  const since = monthStart();
  const [row] = await db.$queryRaw<{ key: string }[]>(Prisma.sql`
    WITH docs AS (
      SELECT d.id, d.title, d."generatedCommand", d."createdAt",
        EXISTS (SELECT 1 FROM "VideoAsset" v WHERE v."documentId" = d.id) AS video,
        CASE WHEN jsonb_typeof(d.skeleton) = 'object' AND (d.skeleton->>'v') = ${String(SKELETON_VERSION)}
          THEN md5(coalesce(d.skeleton->>'gist', '')) END AS gist
      FROM "NotebookDocument" nd JOIN "Document" d ON d.id = nd."documentId"
      WHERE nd."notebookId" = ${notebookId}
    ),
    counts AS (
      SELECT b."documentId" AS id, count(*) AS n FROM "Block" b
      WHERE b."documentId" IN (SELECT id FROM docs) GROUP BY b."documentId"
    ),
    links AS (
      SELECT l.id, l.recommended, l.reason, l."quotedText", l."toQuotedText", l."startOffset", l.prefix, l.suffix,
        l."notebookId", l."formerNotebookId", l."createdById", l."createdAt", l."fromDocumentId", l."toDocumentId"
      FROM "DocLink" l
      WHERE l."fromDocumentId" IN (SELECT id FROM docs) AND l."toDocumentId" IN (SELECT id FROM docs)
        AND (l."notebookId" = ${notebookId} OR (l."notebookId" IS NULL AND l."formerNotebookId" IS NULL))
        AND NOT EXISTS (SELECT 1 FROM "DocLinkHidden" h WHERE h."docLinkId" = l.id AND h."notebookId" = ${notebookId})
    ),
    replies AS (
      SELECT r.id, r."docLinkId", r.content, r."userId", r."resolvedById", r."createdAt"
      FROM "Reply" r WHERE r."docLinkId" IN (SELECT id FROM links)
    ),
    legacy AS (
      SELECT DISTINCT unnest(ARRAY[l."fromDocumentId", l."toDocumentId"]) AS id
      FROM links l WHERE l."notebookId" IS NULL AND l."formerNotebookId" IS NULL
    ),
    holders AS (
      SELECT n.id, n."userId", n."createdAt",
        (SELECT string_agg(c.email || ':' || c.role::text, ',' ORDER BY c.email) FROM "NotebookCollaborator" c WHERE c."notebookId" = n.id) AS collaborators,
        (SELECT string_agg(nd."documentId", ',' ORDER BY nd."documentId") FROM "NotebookDocument" nd
          WHERE nd."notebookId" = n.id AND nd."documentId" IN (SELECT id FROM legacy)) AS held
      FROM "Notebook" n
      WHERE EXISTS (SELECT 1 FROM "NotebookDocument" nd WHERE nd."notebookId" = n.id AND nd."documentId" IN (SELECT id FROM legacy))
    ),
    authors AS (
      SELECT u.id, u.name, u.symbol, u.color, md5(u.picture) AS picture, u.tier::text AS tier, u."trialEndsAt",
        coalesce(u."trialEndsAt" > now(), false) AS trial
      FROM "User" u
      WHERE u.id IN (SELECT "createdById" FROM links WHERE "createdById" IS NOT NULL UNION SELECT "userId" FROM replies)
    )
    SELECT md5(concat_ws('|',
      (SELECT md5(string_agg(md5(ROW(d.*)::text), '' ORDER BY d.id)) FROM docs d),
      (SELECT md5(string_agg(c.id || ':' || c.n, ',' ORDER BY c.id)) FROM counts c),
      (SELECT md5(string_agg(md5(ROW(l.*)::text), '' ORDER BY l.id)) FROM links l),
      (SELECT md5(string_agg(md5(ROW(r.*)::text), '' ORDER BY r.id)) FROM replies r),
      (SELECT md5(string_agg(md5(ROW(h.*)::text), '' ORDER BY h.id)) FROM holders h),
      (SELECT md5(string_agg(md5(ROW(a.*)::text), '' ORDER BY a.id)) FROM authors a),
      (SELECT count(*) FROM "LinkScanRun" s WHERE s."userId" = ${viewer.id} AND s."createdAt" >= ${since})
    )) AS key
  `);
  const viewerPart = [
    viewer.id,
    viewer.email ?? "",
    since.toISOString(),
    authEnabled() ? "auth" : "open",
    provenance ? "provenance" : "",
    LINK_SCAN_RUNS_PER_MONTH,
    process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  ].join("|");
  return createHash("sha1").update(`${row?.key ?? ""}|${viewerPart}`).digest("base64url");
}

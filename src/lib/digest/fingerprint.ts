import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Bump when the digest format changes: every stored row goes stale at once.
export const DIGEST_VERSION = "v1";

// Cheap grouped aggregates over every table that feeds the digest — never the
// block text itself. Any content change moves at least one aggregate, so equal
// fingerprints mean the stored digest is current. A false rebuild is harmless;
// a missed change is not, so every mutation path is covered: notes carry
// updatedAt, block edits write BlockEdit rows, re-parses and transcripts change
// the block id set, layers hash their Json, renames hash titles.
export async function contentFingerprints(notebookIds?: string[]): Promise<Map<string, string>> {
  const ids = notebookIds && notebookIds.length > 0 ? notebookIds : null;

  const [notebooks, sections, notes, sources, layers, attachments, docs, blocks, edits, links, videos] =
    await Promise.all([
      db.$queryRaw<{ id: string; title: string; updatedat: Date; profile: string }[]>(Prisma.sql`
        SELECT id, title, "updatedAt" AS updatedat, md5(coalesce(profile::text, '')) AS profile
        FROM "Notebook"
        ${ids ? Prisma.sql`WHERE id IN (${Prisma.join(ids)})` : Prisma.empty}`),
      db.$queryRaw<{ nid: string; agg: string }[]>(Prisma.sql`
        SELECT "notebookId" AS nid,
               md5(string_agg(id || ':' || title || ':' || "order"::text || ':' || coalesce("parentId", '') || ':' || hidden::text, '|' ORDER BY id)) AS agg
        FROM "Section"
        ${ids ? Prisma.sql`WHERE "notebookId" IN (${Prisma.join(ids)})` : Prisma.empty}
        GROUP BY 1`),
      db.$queryRaw<{ nid: string; c: number; m: Date | null }[]>(Prisma.sql`
        SELECT s."notebookId" AS nid, count(*)::int AS c, max(n."updatedAt") AS m
        FROM "Note" n JOIN "Section" s ON n."sectionId" = s.id
        ${ids ? Prisma.sql`WHERE s."notebookId" IN (${Prisma.join(ids)})` : Prisma.empty}
        GROUP BY 1`),
      db.$queryRaw<{ nid: string; c: number; o: number }[]>(Prisma.sql`
        SELECT s."notebookId" AS nid, count(*)::int AS c, (count(*) FILTER (WHERE src.orphaned))::int AS o
        FROM "Source" src
        JOIN "Note" n ON src."noteId" = n.id
        JOIN "Section" s ON n."sectionId" = s.id
        ${ids ? Prisma.sql`WHERE s."notebookId" IN (${Prisma.join(ids)})` : Prisma.empty}
        GROUP BY 1`),
      db.$queryRaw<{ nid: string; agg: string }[]>(Prisma.sql`
        SELECT "notebookId" AS nid,
               md5(string_agg("documentId"
                 || ':' || md5(coalesce(salience::text, ''))
                 || ':' || md5(coalesce(summaries::text, ''))
                 || ':' || md5(coalesce(distillations::text, ''))
                 || ':' || md5(coalesce(extractions::text, ''))
                 || ':' || md5(coalesce(formalized::text, '')), '|' ORDER BY "documentId")) AS agg
        FROM "NotebookDocument"
        ${ids ? Prisma.sql`WHERE "notebookId" IN (${Prisma.join(ids)})` : Prisma.empty}
        GROUP BY 1`),
      db.$queryRaw<{ nid: string; did: string }[]>(Prisma.sql`
        SELECT "notebookId" AS nid, "documentId" AS did
        FROM "NotebookDocument"
        ${ids ? Prisma.sql`WHERE "notebookId" IN (${Prisma.join(ids)})` : Prisma.empty}
        ORDER BY "documentId"`),
      db.$queryRaw<{ id: string; meta: string }[]>(Prisma.sql`
        SELECT id, title || ':' || "parserVersion"::text || ':' || coalesce("sourceUrl", '')
                 || ':' || md5(coalesce(glossary::text, ''))
                 || ':' || md5(coalesce("references"::text, '')) AS meta
        FROM "Document"`),
      db.$queryRaw<{ did: string; c: number; h: string }[]>(Prisma.sql`
        SELECT "documentId" AS did, count(*)::int AS c, md5(string_agg(id, ',' ORDER BY "order", id)) AS h
        FROM "Block" GROUP BY 1`),
      db.$queryRaw<{ did: string; c: number; m: Date | null }[]>(Prisma.sql`
        SELECT "documentId" AS did, count(*)::int AS c, max("createdAt") AS m
        FROM "BlockEdit" GROUP BY 1`),
      db.$queryRaw<{ did: string; c: number; m: Date | null; o: number }[]>(Prisma.sql`
        SELECT "fromDocumentId" AS did, count(*)::int AS c, max("createdAt") AS m,
               ((count(*) FILTER (WHERE "fromOrphaned")) + (count(*) FILTER (WHERE "toOrphaned")))::int AS o
        FROM "DocLink" GROUP BY 1`),
      db.$queryRaw<{ did: string; v: string }[]>(Prisma.sql`
        SELECT "documentId" AS did,
               kind::text || ':' || coalesce("youtubeId", '') || ':' || coalesce(duration::text, '')
                 || ':' || "transcriptStatus"::text AS v
        FROM "VideoAsset"`),
    ]);

  const sectionAgg = new Map(sections.map((r) => [r.nid, r.agg]));
  const noteAgg = new Map(notes.map((r) => [r.nid, `${r.c}:${r.m?.toISOString() ?? ""}`]));
  const sourceAgg = new Map(sources.map((r) => [r.nid, `${r.c}:${r.o}`]));
  const layerAgg = new Map(layers.map((r) => [r.nid, r.agg]));
  const docMeta = new Map(docs.map((r) => [r.id, r.meta]));
  const blockAgg = new Map(blocks.map((r) => [r.did, `${r.c}:${r.h}`]));
  const editAgg = new Map(edits.map((r) => [r.did, `${r.c}:${r.m?.toISOString() ?? ""}`]));
  const linkAgg = new Map(links.map((r) => [r.did, `${r.c}:${r.m?.toISOString() ?? ""}:${r.o}`]));
  const videoAgg = new Map(videos.map((r) => [r.did, r.v]));

  const docsByNotebook = new Map<string, string[]>();
  for (const a of attachments) {
    const list = docsByNotebook.get(a.nid) ?? [];
    list.push(a.did);
    docsByNotebook.set(a.nid, list);
  }

  const out = new Map<string, string>();
  for (const nb of notebooks) {
    const hash = createHash("sha256");
    hash.update(
      [
        DIGEST_VERSION,
        nb.id,
        nb.title,
        nb.updatedat.toISOString(),
        nb.profile,
        sectionAgg.get(nb.id) ?? "-",
        noteAgg.get(nb.id) ?? "-",
        sourceAgg.get(nb.id) ?? "-",
        layerAgg.get(nb.id) ?? "-",
      ].join("\n"),
    );
    for (const did of docsByNotebook.get(nb.id) ?? []) {
      hash.update(
        [
          did,
          docMeta.get(did) ?? "-",
          blockAgg.get(did) ?? "-",
          editAgg.get(did) ?? "-",
          linkAgg.get(did) ?? "-",
          videoAgg.get(did) ?? "-",
        ].join("\n"),
      );
    }
    out.set(nb.id, hash.digest("hex"));
  }
  return out;
}

// Put back one account's projects, notes, and annotations from a backup.
//
// Usage:
//   DATABASE_URL=<production> BACKUP_DATABASE_URL=<backup copy> \
//     node scripts/recover/restore-account.mjs <email>            # dry run
//   ... node scripts/recover/restore-account.mjs <email> --apply   # write
//
// BACKUP_DATABASE_URL is a copy of the database from before the loss: a
// Supabase backup restored into a new project, or a point-in-time restore
// into a new project. Never the production database itself.
//
// What it does, for every project the account owned in the backup:
//   - Inserts every row that is in the backup and missing in production: the
//     project, its sections, notes, annotations, quotes (Source), replies,
//     note edits, history, collaborators, folders, and document attachments;
//     and every document the project held or quoted that production no longer
//     has, with its blocks, pages, figures, images, video, versions, edits,
//     and links.
//   - Relinks what a document delete cut: a quote or a note in production
//     whose document is gone (documentId null) gets its document, anchor,
//     and orphaned flag back when the backup has them and the document is in
//     production after the restore.
//   - Puts back a restored project's links: a project delete keeps its links
//     and their replies, with notebookId null and formerNotebookId set (the
//     trigger in 20261007120000_doclink_former_notebook). Each such link of a
//     project restored here gets its notebookId back and formerNotebookId
//     cleared, so the project shows its links and their replies again.
//   - Bumps each project's rev, so an open tab refreshes.
//
// What it never does: delete a row, or change a row production already has
// (the relinks above change only rows whose documentId is null, and links
// whose notebookId is null with formerNotebookId naming a restored project,
// back to that project). A document
// that is still in production keeps its blocks as they are now. A row that
// clashes with a unique key production already holds is skipped and counted.
//
// The dry run reads both databases and prints what --apply would write.
// --apply writes everything in one transaction: all of it lands, or none.

import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const targetUrl = process.env.DATABASE_URL;
const backupUrl = process.env.BACKUP_DATABASE_URL;
if (!email || !targetUrl || !backupUrl) {
  console.error(
    "Usage: DATABASE_URL=<production> BACKUP_DATABASE_URL=<backup copy> node scripts/recover/restore-account.mjs <email> [--apply]",
  );
  process.exit(1);
}
if (targetUrl === backupUrl) {
  console.error("DATABASE_URL and BACKUP_DATABASE_URL are the same database. Stop.");
  process.exit(1);
}

const target = new PrismaClient({ datasourceUrl: targetUrl });
const backup = new PrismaClient({ datasourceUrl: backupUrl });

// Rows per insert. Tables that hold file bytes go one row at a time.
const BATCH = 200;
const BYTES_TABLES = new Set(["Document", "VideoChunk", "PageImage", "ImageAsset"]);
const IMAGE_RE = /\/api\/images\/([A-Za-z0-9_-]+)/g;

const ids = (rows, key = "id") => [...new Set(rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined))];

async function rows(client, sql, ...params) {
  return client.$queryRawUnsafe(sql, ...params);
}

// The rows of a table in the backup, whole, as JSON objects.
async function backupRows(table, where, ...params) {
  const found = await rows(backup, `SELECT to_jsonb(t) AS "row" FROM "${table}" t WHERE ${where}`, ...params);
  return found.map((r) => r.row);
}

async function presentIds(table, key, values) {
  if (values.length === 0) return new Set();
  const found = await rows(target, `SELECT "${key}" AS "k" FROM "${table}" WHERE "${key}" = ANY($1::text[])`, values);
  return new Set(found.map((r) => r.k));
}

// Parents before children, for a table that points at itself.
function parentsFirst(list, parentKey) {
  const byId = new Map(list.map((r) => [r.id, r]));
  const out = [];
  const done = new Set();
  const visit = (r, depth) => {
    if (done.has(r.id) || depth > list.length) return;
    const parent = r[parentKey] ? byId.get(r[parentKey]) : undefined;
    if (parent) visit(parent, depth + 1);
    done.add(r.id);
    out.push(r);
  };
  for (const r of list) visit(r, 0);
  return out;
}

async function columns(client, table) {
  const found = await rows(
    client,
    `SELECT column_name AS "c" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
    table,
  );
  return new Set(found.map((r) => r.c));
}

async function main() {
  // ── The account ──────────────────────────────────────────────────────────
  const [backupUser] = await rows(backup, `SELECT "id", "email" FROM "User" WHERE lower("email") = $1`, email);
  const [targetUser] = await rows(target, `SELECT "id", "email" FROM "User" WHERE lower("email") = $1`, email);
  if (!backupUser) throw new Error(`No account ${email} in the backup.`);
  if (!targetUser) throw new Error(`No account ${email} in production.`);
  if (backupUser.id !== targetUser.id) {
    throw new Error(`The account's id differs: backup ${backupUser.id}, production ${targetUser.id}. Stop.`);
  }
  const userId = targetUser.id;

  // ── What the backup holds for the account ────────────────────────────────
  // [{ table, rows, keysOnly }] in insert order. A keysOnly step holds the
  // keys alone and fetches each row whole at the write: its rows hold file
  // bytes.
  const plan = [];
  const add = (table, list, keysOnly = false) => plan.push({ table, rows: list, keysOnly });

  const notebooks = await backupRows("Notebook", `t."userId" = $1`, userId);
  const N = ids(notebooks);
  if (N.length === 0) throw new Error("The account owned no project in the backup.");
  const inN = `t."notebookId" = ANY($1::text[])`;

  const collaborators = await backupRows("NotebookCollaborator", inN, N);
  const digests = await backupRows("NotebookDigest", inN, N);
  const events = await backupRows("NotebookEvent", inN, N);
  const folders = parentsFirst(await backupRows("DocumentFolder", inN, N), "parentId");
  const sections = parentsFirst(await backupRows("Section", inN, N), "parentId");
  const notes = parentsFirst(
    await backupRows("Note", `t."sectionId" = ANY($1::text[])`, ids(sections)),
    "sideChatOfId",
  );
  const X = ids(notes);
  const sources = await backupRows("Source", `t."noteId" = ANY($1::text[])`, X);
  const noteEdits = await backupRows("NoteEdit", `t."noteId" = ANY($1::text[])`, X);
  const attachments = await backupRows("NotebookDocument", inN, N);

  // Documents: held by the projects, quoted by their notes, or written in.
  const D = [...new Set([...ids(attachments, "documentId"), ...ids(sources, "documentId"), ...ids(notes, "documentId")])];
  const present = await presentIds("Document", "id", D);
  const missingDocIds = D.filter((id) => !present.has(id));
  const docKeys = await rows(backup, `SELECT "id" FROM "Document" WHERE "id" = ANY($1::text[])`, missingDocIds);
  const restoredDocs = new Set(docKeys.map((r) => r.id));
  const available = new Set([...present, ...restoredDocs]);
  const Dm = [...restoredDocs];

  const blocks = await backupRows("Block", `t."documentId" = ANY($1::text[])`, Dm);
  const B = ids(blocks);
  const figureMedia = await backupRows("FigureMedia", `t."documentId" = ANY($1::text[])`, Dm);
  const translations = await backupRows("BlockTranslation", `t."blockId" = ANY($1::text[])`, B);
  const videoAssets = await backupRows("VideoAsset", `t."documentId" = ANY($1::text[])`, Dm);
  const versions = await backupRows("DocumentVersion", `t."documentId" = ANY($1::text[])`, Dm);
  const blockEdits = await backupRows("BlockEdit", `t."documentId" = ANY($1::text[])`, Dm);
  const docLinks = (
    await backupRows(
      "DocLink",
      `t."fromDocumentId" = ANY($1::text[]) OR t."toDocumentId" = ANY($1::text[])`,
      Dm,
    )
  ).filter((l) => available.has(l.fromDocumentId) && available.has(l.toDocumentId));
  const readingPositions = await backupRows(
    "ReadingPosition",
    `t."documentId" = ANY($1::text[]) AND t."userId" = $2`,
    Dm,
    userId,
  );
  const replies = await backupRows(
    "Reply",
    `t."noteId" = ANY($1::text[]) OR t."blockEditId" = ANY($2::text[]) OR t."docLinkId" = ANY($3::text[])`,
    X,
    ids(blockEdits),
    ids(docLinks),
  );

  // Images: the ones the restored documents hold, and the ones notes and
  // blocks point at by URL.
  const imageIds = new Set();
  for (const n of notes) for (const m of String(n.content ?? "").matchAll(IMAGE_RE)) imageIds.add(m[1]);
  for (const b of blocks) {
    for (const m of `${b.text ?? ""} ${b.html ?? ""}`.matchAll(IMAGE_RE)) imageIds.add(m[1]);
  }
  const imageKeys = (
    await rows(
      backup,
      `SELECT "id", "documentId" FROM "ImageAsset" WHERE "documentId" = ANY($1::text[]) OR "id" = ANY($2::text[])`,
      Dm,
      [...imageIds],
    )
  ).filter((r) => r.documentId === null || available.has(r.documentId));

  // Quotes and notes point at no document that is gone in both databases.
  for (const n of notes) if (n.documentId && !available.has(n.documentId)) n.documentId = null;
  for (const s of sources) {
    if (s.documentId && !available.has(s.documentId)) {
      s.documentId = null;
      s.orphaned = true;
    }
  }

  add("Notebook", notebooks);
  add("NotebookCollaborator", collaborators);
  add("NotebookDigest", digests);
  add("NotebookEvent", events);
  add("DocumentFolder", folders);
  add("Section", sections);
  add("Document", docKeys, true);
  add("Block", blocks);
  add("PageImage", [], true); // filled below
  add("BlockTranslation", translations);
  add("FigureMedia", figureMedia);
  add("VideoAsset", videoAssets);
  add("VideoChunk", [], true); // filled below
  add("DocumentVersion", versions);
  add("BlockEdit", blockEdits);
  add("DocLink", docLinks);
  add("ReadingPosition", readingPositions);
  add("ImageAsset", imageKeys.map((r) => ({ id: r.id })), true);
  add("NotebookDocument", attachments);
  add("Note", notes);
  add("Source", sources);
  add("Reply", replies);
  add("NoteEdit", noteEdits);

  const chunkKeys = await rows(backup, `SELECT "id" FROM "VideoChunk" WHERE "videoId" = ANY($1::text[])`, ids(videoAssets));
  plan.find((p) => p.table === "VideoChunk").rows = chunkKeys;
  const pageKeys = await rows(backup, `SELECT "blockId" FROM "PageImage" WHERE "blockId" = ANY($1::text[])`, B);
  plan.find((p) => p.table === "PageImage").rows = pageKeys;

  // ── What production is missing ───────────────────────────────────────────
  const COMPOSITE = {
    NotebookDocument: ["notebookId", "documentId"],
    ReadingPosition: ["userId", "documentId"],
  };
  for (const step of plan) {
    const composite = COMPOSITE[step.table];
    if (composite) {
      const [a, b] = composite;
      const have = await rows(
        target,
        `SELECT "${a}" AS "a", "${b}" AS "b" FROM "${step.table}" WHERE "${a}" = ANY($1::text[])`,
        ids(step.rows, a),
      );
      const keys = new Set(have.map((r) => `${r.a}\u0000${r.b}`));
      step.missing = step.rows.filter((r) => !keys.has(`${r[a]}\u0000${r[b]}`));
    } else {
      const key = step.table === "PageImage" ? "blockId" : "id";
      const have = await presentIds(step.table, key, ids(step.rows, key));
      step.missing = step.rows.filter((r) => !have.has(r[key]));
      step.key = key;
    }
  }

  // Relinks: rows production still has whose document a delete cut.
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const cutSources = sources.length
    ? await rows(
        target,
        `SELECT "id" FROM "Source" WHERE "id" = ANY($1::text[]) AND "documentId" IS NULL`,
        ids(sources),
      )
    : [];
  const sourceRelinks = cutSources.map((r) => sourceById.get(r.id)).filter((s) => s && s.documentId);
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const cutNotes = notes.length
    ? await rows(target, `SELECT "id" FROM "Note" WHERE "id" = ANY($1::text[]) AND "documentId" IS NULL`, X)
    : [];
  const noteRelinks = cutNotes.map((r) => noteById.get(r.id)).filter((n) => n && n.documentId);
  // Links a project delete kept (notebookId null, formerNotebookId set). The
  // column exists from 20261007120000_doclink_former_notebook on.
  const linkRelinks = (await columns(target, "DocLink")).has("formerNotebookId")
    ? await rows(
        target,
        `SELECT "id", "formerNotebookId" FROM "DocLink" WHERE "formerNotebookId" = ANY($1::text[]) AND "notebookId" IS NULL`,
        N,
      )
    : [];

  // ── Report ───────────────────────────────────────────────────────────────
  const targetNotes = await rows(
    target,
    `SELECT s."notebookId" AS "notebookId", count(*)::int AS "n"
     FROM "Note" x JOIN "Section" s ON s."id" = x."sectionId"
     WHERE s."notebookId" = ANY($1::text[]) GROUP BY s."notebookId"`,
    N,
  );
  const nowById = new Map(targetNotes.map((r) => [r.notebookId, r.n]));
  const sectionProject = new Map(sections.map((s) => [s.id, s.notebookId]));
  const thenById = new Map();
  for (const n of notes) {
    const p = sectionProject.get(n.sectionId);
    thenById.set(p, (thenById.get(p) ?? 0) + 1);
  }
  console.log(`\nAccount ${email} (${userId})`);
  console.table(
    notebooks.map((n) => ({
      project: n.title,
      notesInBackup: thenById.get(n.id) ?? 0,
      notesNow: nowById.get(n.id) ?? 0,
    })),
  );
  console.table(
    plan.map((p) => ({ table: p.table, inBackup: p.rows.length, missingInProduction: p.missing.length })),
  );
  console.log(`Quotes to relink to their document: ${sourceRelinks.length}`);
  console.log(`Notes to relink to their document: ${noteRelinks.length}`);
  console.log(`Links to put back in their project: ${linkRelinks.length}`);

  if (!apply) {
    console.log("\nDry run: nothing was written. Run again with --apply to write the rows above.");
    return;
  }

  // ── Write ────────────────────────────────────────────────────────────────
  const shared = new Map();
  for (const step of plan) {
    const [a, b] = await Promise.all([columns(backup, step.table), columns(target, step.table)]);
    shared.set(step.table, [...b].filter((c) => a.has(c)));
  }

  await target.$transaction(
    async (tx) => {
      for (const step of plan) {
        if (step.missing.length === 0) continue;
        const cols = shared.get(step.table).map((c) => `"${c}"`).join(", ");
        const size = BYTES_TABLES.has(step.table) ? 1 : BATCH;
        let inserted = 0;
        for (let i = 0; i < step.missing.length; i += size) {
          let batch = step.missing.slice(i, i + size);
          if (step.keysOnly) {
            batch = await backupRows(step.table, `t."${step.key}" = ANY($1::text[])`, ids(batch, step.key));
          }
          inserted += await tx.$executeRawUnsafe(
            `INSERT INTO "${step.table}" (${cols})
             SELECT ${cols} FROM jsonb_populate_recordset(NULL::"${step.table}", $1::jsonb)
             ON CONFLICT DO NOTHING`,
            JSON.stringify(batch),
          );
        }
        const skipped = step.missing.length - inserted;
        console.log(`${step.table}: inserted ${inserted}${skipped ? `, skipped ${skipped} (unique key clash)` : ""}`);
      }
      for (const s of sourceRelinks) {
        await tx.$executeRawUnsafe(
          `UPDATE "Source" SET "documentId" = $2, "blockId" = $3, "startOffset" = $4, "endOffset" = $5,
             "anchoredText" = $6, "orphaned" = $7
           WHERE "id" = $1 AND "documentId" IS NULL`,
          s.id,
          s.documentId,
          s.blockId,
          s.startOffset,
          s.endOffset,
          s.anchoredText ?? null,
          Boolean(s.orphaned),
        );
      }
      for (const n of noteRelinks) {
        await tx.$executeRawUnsafe(
          `UPDATE "Note" SET "documentId" = $2 WHERE "id" = $1 AND "documentId" IS NULL`,
          n.id,
          n.documentId,
        );
      }
      // After the inserts: the project row exists again. Only a link whose
      // project is in production now goes back to it.
      const relinkedLinks = linkRelinks.length
        ? await tx.$executeRawUnsafe(
            `UPDATE "DocLink" l SET "notebookId" = l."formerNotebookId", "formerNotebookId" = NULL
             WHERE l."id" = ANY($1::text[]) AND l."notebookId" IS NULL
               AND EXISTS (SELECT 1 FROM "Notebook" n WHERE n."id" = l."formerNotebookId")`,
            ids(linkRelinks),
          )
        : 0;
      console.log(
        `Relinked ${sourceRelinks.length} quotes, ${noteRelinks.length} notes, and ${relinkedLinks} links.`,
      );
      await tx.$executeRawUnsafe(`UPDATE "Notebook" SET "rev" = "rev" + 1 WHERE "id" = ANY($1::text[])`, N);
    },
    { maxWait: 60_000, timeout: 30 * 60_000 },
  );
  console.log("\nDone. Every write above landed in one transaction.");
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await Promise.all([target.$disconnect(), backup.$disconnect()]);
}

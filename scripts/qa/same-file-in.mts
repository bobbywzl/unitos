// The notice for a new copy (SPEC.md §30): an add whose file or web address
// this project already holds as an edited import makes a new copy, since
// dedupe hands out only an unedited document, and its result names the
// edited import (sameFileIn, lib/parse/attach.ts) so the upload box can say
// so and open it.
//
// The check makes its own two projects and documents (titles carry the
// run's stamp), calls sameFileIn and addedResult the way the add routes do,
// and checks: the edited import of the same file in this project is named;
// the same file with other pages, an unedited import, a block document, and
// an edited import in another account's project are not; a deduped add
// names nothing; a web page matches by its address. The check only reads:
// every row it made is the same after the calls. At the end it deletes the
// rows it made, by id, and nothing else.
//
// Needs DATABASE_URL (read from .env when unset). Run:
//   npx tsx --tsconfig tsconfig.json scripts/qa/same-file-in.mts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

if (!process.env.DATABASE_URL && existsSync(join(process.cwd(), ".env"))) {
  const m = /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync(join(process.cwd(), ".env"), "utf8"));
  if (m) process.env.DATABASE_URL = m[1];
}
const { db } = await import("@/lib/db");
const { addedResult, sameFileIn } = await import("@/lib/parse/attach");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const hash = (name: string) => createHash("sha256").update(`${STAMP}-${name}`).digest("hex");
const RICH_TEXT = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "QA" }] }] };

const notebookIds: string[] = [];
const documentIds: string[] = [];

async function project(title: string, userId: string) {
  const notebook = await db.notebook.create({ data: { title: `QA same file ${title} ${STAMP}`, userId } });
  notebookIds.push(notebook.id);
  return notebook.id;
}

// An import: edited when its rich text moved past the import's revision; a
// block document has no import revision.
type Shape = "edited" | "unedited" | "blocks";
async function documentIn(
  notebookId: string,
  title: string,
  shape: Shape,
  where: { fileHash?: string; sourceUrl?: string; pdfPages?: { ranges: [number, number][]; count: number } },
) {
  const revs =
    shape === "edited"
      ? { richText: RICH_TEXT, importRev: 1, richTextRev: 3 }
      : shape === "unedited"
        ? { richText: RICH_TEXT, importRev: 2, richTextRev: 2 }
        : {};
  const document = await db.document.create({
    data: { title: `${title} ${STAMP}`, ...where, ...revs },
  });
  documentIds.push(document.id);
  await db.notebookDocument.create({ data: { notebookId, documentId: document.id } });
  return document;
}

const snapshot = () =>
  db.document.findMany({
    where: { id: { in: documentIds } },
    orderBy: { id: "asc" },
    select: { id: true, title: true, richText: true, richTextRev: true, importRev: true, fileHash: true, sourceUrl: true, pdfPages: true },
  });

try {
  const mine = await project("mine", `qa-same-file-${STAMP}`);
  const theirs = await project("theirs", `qa-same-file-other-${STAMP}`);

  // The finding: an edited import, and the new copy the add made beside it.
  const h1 = hash("pdf");
  const edited = await documentIn(mine, "Edited import", "edited", { fileHash: h1 });
  const copy = await documentIn(mine, "New copy", "unedited", { fileHash: h1 });
  const named = await sameFileIn(mine, copy, false);
  check("the edited import of the same file is named", named?.id === edited.id && named.page === false, JSON.stringify(named));
  check("a deduped add names nothing", (await sameFileIn(mine, edited, true)) === null);

  // The add's terminal line keeps id, title, and deduped, and adds the flag.
  const line = await addedResult(mine, copy, false);
  check(
    "the terminal line carries sameFileIn",
    line.id === copy.id && line.title === copy.title && line.deduped === false && line.sameFileIn?.id === edited.id,
    JSON.stringify(line),
  );
  const plain = await addedResult(mine, edited, true);
  check("a deduped add's line is as before", JSON.stringify(Object.keys(plain)) === JSON.stringify(["id", "title", "deduped"]), JSON.stringify(plain));

  // Another account's project: never read.
  const h2 = hash("other");
  await documentIn(theirs, "Their edited import", "edited", { fileHash: h2 });
  const mineOnly = await documentIn(mine, "My copy", "unedited", { fileHash: h2 });
  check("an edited import in another project is not named", (await sameFileIn(mine, mineOnly, false)) === null);

  // The same PDF with other pages is another document, no copy.
  const h3 = hash("pages");
  const pagesEdited = await documentIn(mine, "Pages 1-3", "edited", { fileHash: h3, pdfPages: { ranges: [[1, 3]], count: 10 } });
  const whole = await documentIn(mine, "Every page", "unedited", { fileHash: h3 });
  check("the same file with other pages is not named", (await sameFileIn(mine, whole, false)) === null);
  const samePages = await documentIn(mine, "Pages 1-3 again", "unedited", { fileHash: h3, pdfPages: { ranges: [[1, 3]], count: 10 } });
  check("the same file with the same pages is named", (await sameFileIn(mine, samePages, false))?.id === pagesEdited.id);

  // Unedited imports and block documents are handed out by dedupe: no copy.
  const h4 = hash("unedited");
  await documentIn(mine, "Unedited import", "unedited", { fileHash: h4 });
  const besideUnedited = await documentIn(mine, "Beside unedited", "unedited", { fileHash: h4 });
  check("an unedited import is not named", (await sameFileIn(mine, besideUnedited, false)) === null);
  const h5 = hash("blocks");
  await documentIn(mine, "Block document", "blocks", { fileHash: h5 });
  const besideBlocks = await documentIn(mine, "Beside blocks", "unedited", { fileHash: h5 });
  check("a block document is not named", (await sameFileIn(mine, besideBlocks, false)) === null);

  // A web page: the address, no file.
  const url = `https://qa.invalid/same-file/${STAMP}`;
  const pageEdited = await documentIn(mine, "Edited page", "edited", { sourceUrl: url });
  const pageCopy = await documentIn(mine, "Page copy", "unedited", { sourceUrl: url });
  const pageNamed = await sameFileIn(mine, pageCopy, false);
  check("the edited import of the same web page is named, as a page", pageNamed?.id === pageEdited.id && pageNamed.page === true, JSON.stringify(pageNamed));

  // Read-only: every row the check made is as it was.
  const before = JSON.stringify(await snapshot());
  for (const id of documentIds) {
    const row = await db.document.findUniqueOrThrow({ where: { id } });
    await addedResult(mine, row, false);
    await addedResult(theirs, row, false);
  }
  check("the check writes nothing", JSON.stringify(await snapshot()) === before, `${documentIds.length} documents`);
} finally {
  // Only the rows this run made, by id.
  await db.notebookDocument.deleteMany({ where: { documentId: { in: documentIds } } });
  await db.document.deleteMany({ where: { id: { in: documentIds } } });
  await db.notebook.deleteMany({ where: { id: { in: notebookIds } } });
  await db.$disconnect();
}

console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);

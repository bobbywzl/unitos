// COST6-08: the page sends each document row with its default fields left
// out (lib/attached-document.ts), and the workspace puts them back. Every
// reader of a row (document bar, Documents list, folders, re-parse) reads
// the row after withDocumentDefaults, so the round trip must give back the
// row exactly: every field at its default, each field off its default
// alone, every field off at once, and editedAt equal to addedAt or not.
//   npx tsx scripts/qa/attached-rows-check.ts
import { isDeepStrictEqual } from "node:util";
import { compactDocument, withDocumentDefaults, type AttachedDocument } from "../../src/lib/attached-document";

const base: AttachedDocument = {
  id: "d1",
  title: "A title",
  sourceUrl: null,
  parserVersion: 0,
  hasFile: false,
  pdf: false,
  hasVideo: false,
  handwritten: false,
  figureRenderAt: null,
  figureRenderError: null,
  folderId: null,
  importEdited: false,
  kind: "page",
  addedAt: "2026-10-01T00:00:00.000Z",
  editedAt: "2026-10-01T00:00:00.000Z",
};
const off: Partial<AttachedDocument> = {
  sourceUrl: "https://example.org/a",
  parserVersion: 7,
  hasFile: true,
  pdf: true,
  hasVideo: true,
  handwritten: true,
  figureRenderAt: "2026-10-02T00:00:00.000Z",
  figureRenderError: "timeout",
  folderId: "f1",
  importEdited: true,
  editedAt: "2026-10-05T00:00:00.000Z",
};
let failed = 0;
const check = (name: string, row: AttachedDocument) => {
  const compact = compactDocument(row);
  const back = withDocumentDefaults(compact);
  const ok = isDeepStrictEqual(back, row);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(compact).length} bytes${ok ? "" : ` ${JSON.stringify(back)}`}`);
};
check("every field at its default", base);
for (const [key, value] of Object.entries(off)) check(`${key} off its default`, { ...base, [key]: value });
check("every field off its default", { ...base, ...off });
check("parserVersion 1 (an older parse)", { ...base, parserVersion: 1 });
console.log(`full row ${JSON.stringify(base).length} bytes`);
console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);

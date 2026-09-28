/**
 * One time for every generated PDF, so a run makes the same bytes: pdflatex reads SOURCE_DATE_EPOCH, and
 * `pinPdf` rewrites the dates and the /ID that Chromium and LibreOffice stamp, keeping every byte offset.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const SOURCE_DATE_EPOCH = "1790553600";
const EPOCH = new Date(Number(SOURCE_DATE_EPOCH) * 1000);

/** A .docx that is the same bytes on every run: the core properties' dates and every zip entry's time are
    the epoch, and the random relationship ids the `docx` package gives hyperlinks are numbered in order. */
export function pinDocx(bytes: Uint8Array): Uint8Array {
  const parts = unzipSync(bytes);
  const core = parts["docProps/core.xml"];
  if (core) parts["docProps/core.xml"] = strToU8(strFromU8(core).replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*/g, (_, open: string) => open + EPOCH.toISOString()));
  const ids = new Map<string, string>();
  for (const name of Object.keys(parts).filter((n) => n.endsWith(".rels"))) {
    for (const [, id] of strFromU8(parts[name]).matchAll(/Id="(rId[^"]*[^\d"][^"]*)"/g)) if (!ids.has(id)) ids.set(id, `rIdLink${ids.size + 1}`);
  }
  if (ids.size) {
    for (const name of Object.keys(parts).filter((n) => n.endsWith(".xml") || n.endsWith(".rels"))) {
      parts[name] = strToU8(strFromU8(parts[name]).replace(/"(rId[^"]+)"/g, (all, id: string) => (ids.has(id) ? `"${ids.get(id)}"` : all)));
    }
  }
  return zipSync(parts, { mtime: EPOCH, level: 6 });
}

/** The epoch as a PDF date's 14 digits (YYYYMMDDHHmmss, UTC). */
const STAMP = EPOCH.toISOString().replace(/\D/g, "").slice(0, 14);

/** Rewrites the PDF's creation and modification dates to the epoch and its /ID to a hash of its content;
    every replacement has the length of what it replaces, so the cross-reference table stays right. */
export function pinPdf(path: string): void {
  let text = readFileSync(path).toString("latin1");
  text = text.replace(/(\/(?:CreationDate|ModDate)\s*\(D:)\d{14}/g, (_, head: string) => head + STAMP);
  // LibreOffice's checksum covers the time it wrote; it becomes a hash of the pinned content.
  const withoutIds = text.replace(/\/ID\s*\[[^\]]*\]/, "").replace(/\/DocChecksum\s*\/[0-9A-Fa-f]{32}/, "");
  const id = createHash("md5").update(withoutIds).digest("hex").toUpperCase();
  text = text.replace(/(\/DocChecksum\s*\/)[0-9A-Fa-f]{32}/, (_, head: string) => head + id);
  text = text.replace(/(\/ID\s*\[\s*<)[0-9A-Fa-f]{32}(>\s*<)[0-9A-Fa-f]{32}(>)/, (_, a: string, c: string, e: string) => a + id + c + id + e);
  writeFileSync(path, Buffer.from(text, "latin1"));
}

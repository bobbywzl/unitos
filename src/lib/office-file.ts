// Slides and sheets uploads (SPEC.md §27): the file input's accept lists and
// the file tests the document bar, the upload assistant, the Drive picker,
// and the documents routes share. Client-safe: no parser imports. The
// server never trusts these for stored bytes — sniffOfficeFile
// (lib/parse/office.ts) reads the format from the bytes.

export type OfficeFormat = "slides" | "sheets";

export const SLIDES_EXTENSIONS = /\.pptx$/i;
export const SHEETS_EXTENSIONS = /\.(xlsx|csv|tsv)$/i;

export const SLIDES_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const SHEETS_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const SLIDES_MIME_TYPES = new Set<string>([SLIDES_MIME_TYPE]);
const SHEETS_MIME_TYPES = new Set<string>([
  SHEETS_MIME_TYPE,
  "text/csv",
  "text/tab-separated-values",
]);

// The file input's accept list: the same formats.
export const SLIDES_ACCEPT = `${SLIDES_MIME_TYPE},.pptx`;
export const SHEETS_ACCEPT = `${SHEETS_MIME_TYPE},text/csv,text/tab-separated-values,.xlsx,.csv,.tsv`;

export function isSlidesFile(file: { type: string; name: string }): boolean {
  return SLIDES_MIME_TYPES.has(file.type) || SLIDES_EXTENSIONS.test(file.name);
}

export function isSheetsFile(file: { type: string; name: string }): boolean {
  return SHEETS_MIME_TYPES.has(file.type) || SHEETS_EXTENSIONS.test(file.name);
}

/** The format a picked file has by its type or name; null for anything else. */
export function officeFormatOf(file: { type: string; name: string }): OfficeFormat | null {
  if (isSlidesFile(file)) return "slides";
  if (isSheetsFile(file)) return "sheets";
  return null;
}

/** A document title from a file name: the extension dropped. */
export function officeTitle(filename: string): string {
  return filename.replace(SLIDES_EXTENSIONS, "").replace(SHEETS_EXTENSIONS, "");
}

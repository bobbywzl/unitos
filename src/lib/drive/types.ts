import { MEDIA_EXTENSIONS } from "@/lib/video/types";
import {
  SHEETS_EXTENSIONS,
  SHEETS_MIME_TYPE,
  SLIDES_EXTENSIONS,
  SLIDES_MIME_TYPE,
  WORD_MIME_TYPE,
  isWordFile,
} from "@/lib/office-file";

// Google Drive upload (SPEC.md §14): a new way to add a document, picked from
// Drive instead of the local disk. This file is imported by both the client
// (the picker's own mime filter, and an instant pre-check before the file
// reaches the network) and the server (the authoritative check) — one
// definition of what is supported, never two that can drift apart.

// Drive access: what the app asks Google for (GOOGLE_DRIVE_ACCESS,
// lib/drive/config.ts). "all": read access to every file the account can
// read — Google calls this scope restricted: the deployer lists it on the
// OAuth consent screen, and until Google verifies the app the consent shows
// Google's unverified-app warning. "picked": the files the reader picks in
// the Google Picker only — non-sensitive, no verification. Neither scope
// writes to Drive. A per-visit token is requested fresh in the browser
// (lib/drive/picker-client.ts) and never written to the database; a linked
// account stores a refresh token (lib/drive/link.ts).
export type DriveAccess = "all" | "picked";

export const DRIVE_SCOPES: Record<DriveAccess, string> = {
  all: "https://www.googleapis.com/auth/drive.readonly",
  picked: "https://www.googleapis.com/auth/drive.file",
};

// What a stored grant reaches, read from the scope string Google returned at
// link time (space-separated). Any scope that reads the whole Drive counts
// as "all"; drive.file, or a grant stored before the scope was, is "picked".
export function driveGrant(scope: string): DriveAccess {
  const scopes = scope.split(/\s+/);
  return scopes.includes(DRIVE_SCOPES.all) ||
    scopes.includes("https://www.googleapis.com/auth/drive")
    ? "all"
    : "picked";
}

// The Cloud project number the Google Picker needs (setAppId) so a picked
// file reaches a drive.file grant: it is the numeric prefix of the OAuth
// client id (<project-number>-<hash>.apps.googleusercontent.com). Without
// it Drive answers 404 for every picked file.
export function driveAppId(clientId: string): string | null {
  return /^(\d+)-/.exec(clientId)?.[1] ?? null;
}

// A Google Doc exports as a .docx (Drive's own conversion, lib/drive/fetch.ts)
// and the Word parser reads it as it reads an uploaded Word file: headings,
// lists, tables, equations, and footnotes from the file's own structure,
// where Drive's PDF export left them to be guessed from the page. The PDF
// export stays the fallback when the .docx export fails. A Google Drawing
// has no reader of its own here: Drive exports it to PDF, which ingests
// exactly like an uploaded PDF. Google Slides exports as a .pptx and Google
// Sheets as a .xlsx (SPEC.md §27): the slides and sheets parsers read those,
// the same as an uploaded file.
const GOOGLE_DOCS_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_DRAWINGS_MIME_TYPE = "application/vnd.google-apps.drawing";
export const GOOGLE_SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";
export const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

const MEDIA_MIME_RX = /^(?:video|audio)\//i;
const SHEETS_FILE_MIME_TYPES = new Set([SHEETS_MIME_TYPE, "text/csv", "text/tab-separated-values"]);

// What a picked file becomes: "docx" asks Drive for the .docx of a Google
// Doc (its PDF export the fallback); "export" asks Drive to convert a
// Google Drawing to PDF; "slides" and "sheets" ask Drive for the .pptx or
// .xlsx of a Google Slides or Sheets file; "docx-file", "slides-file", and
// "sheets-file" are a .docx, a .pptx, or a .xlsx/.csv/.tsv sitting in
// Drive; "pdf" and "media" download the bytes directly. Every kind ingests
// exactly like the same file uploaded (SPEC.md §4 discipline extended to
// ingest — Drive is a new source, never a new parser).
export type DriveFileKind =
  | "docx"
  | "export"
  | "slides"
  | "sheets"
  | "docx-file"
  | "slides-file"
  | "sheets-file"
  | "pdf"
  | "media"
  | "unsupported";

export function classifyDriveFile(mimeType: string, name: string): DriveFileKind {
  if (mimeType === GOOGLE_DOCS_MIME_TYPE) return "docx";
  if (mimeType === GOOGLE_DRAWINGS_MIME_TYPE) return "export";
  if (mimeType === GOOGLE_SLIDES_MIME_TYPE) return "slides";
  if (mimeType === GOOGLE_SHEETS_MIME_TYPE) return "sheets";
  if (isWordFile({ type: mimeType, name })) return "docx-file";
  if (mimeType === SLIDES_MIME_TYPE || SLIDES_EXTENSIONS.test(name)) return "slides-file";
  if (SHEETS_FILE_MIME_TYPES.has(mimeType) || SHEETS_EXTENSIONS.test(name)) return "sheets-file";
  if (mimeType === "application/pdf") return "pdf";
  if (MEDIA_MIME_RX.test(mimeType) || MEDIA_EXTENSIONS.test(name)) return "media";
  return "unsupported";
}

// A Drive folder. It is in the picker's filter so folders survive it: the
// filter is a whitelist over every item the view lists, folders included, and
// a picker filtered to documents alone shows a Drive of folders as empty. It
// never reaches an import — the picker does not let a folder be selected
// (setSelectFolderEnabled(false)), and classifyDriveFile calls it
// unsupported.
export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

// The picker's own filter: images, Forms, plain text, and everything else
// stay greyed out before the reader ever selects them.
const PICKER_MIME_TYPES = [
  GOOGLE_DOCS_MIME_TYPE,
  GOOGLE_DRAWINGS_MIME_TYPE,
  GOOGLE_SLIDES_MIME_TYPE,
  GOOGLE_SHEETS_MIME_TYPE,
  WORD_MIME_TYPE,
  SLIDES_MIME_TYPE,
  ...SHEETS_FILE_MIME_TYPES,
  DRIVE_FOLDER_MIME_TYPE,
  "application/pdf",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/ogg",
];
export const DRIVE_PICKER_MIME_TYPES = PICKER_MIME_TYPES.join(",");

// The assistant's own picker filter (SPEC.md §7): what an attachment takes —
// the exportable formats and PDF (text), video and audio (transcribed),
// images (shown to the model), and plain text. A raw .docx stays greyed
// out: an attachment has no text rendering of it (classifyDriveAttachment).
export const DRIVE_ASSISTANT_MIME_TYPES = [
  ...PICKER_MIME_TYPES.filter((type) => type !== WORD_MIME_TYPE),
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "text/plain",
  "text/markdown",
  "text/csv",
].join(",");

// What a picked file becomes as an attachment (classifyDriveFile, then the
// kinds an attachment adds): an image is stored and shown to the model, a
// text file rides as its text.
export type DriveAttachmentKind = DriveFileKind | "image" | "text";

export function classifyDriveAttachment(mimeType: string, name: string): DriveAttachmentKind {
  const kind = classifyDriveFile(mimeType, name);
  // An attachment reads as text: a Google Doc, Slides, or Sheets file rides
  // as Drive's PDF export, as every Google file does; a raw .docx, .pptx,
  // or .xlsx has no text rendering for the assistant and stays out.
  if (kind === "docx" || kind === "slides" || kind === "sheets") return "export";
  if (kind === "docx-file" || kind === "slides-file" || kind === "sheets-file") return "unsupported";
  if (kind !== "unsupported") return kind;
  if (/^image\//i.test(mimeType)) return "image";
  if (/^text\//i.test(mimeType) || /\.(txt|md|markdown|csv|tsv)$/i.test(name)) return "text";
  return "unsupported";
}

// One file the reader selected in the picker.
export type DrivePickedFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
};

// The file id inside a pasted Google Drive or Google Docs link, so Add URL can
// route it to the Drive import instead of failing the article parse. Covers
// drive.google.com/file/d/{id}, open?id={id}, uc?id={id}, and the
// docs.google.com/{document|spreadsheets|presentation|drawings}/d/{id} forms.
export function parseDriveFileId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.host.replace(/^www\./, "");
  if (host !== "drive.google.com" && host !== "docs.google.com") return null;
  const byPath = /\/(?:file|document|spreadsheets|presentation|drawings)\/d\/([\w-]{10,})/.exec(
    url.pathname,
  );
  if (byPath) return byPath[1];
  const byQuery = url.searchParams.get("id");
  if ((url.pathname === "/open" || url.pathname === "/uc") && byQuery && /^[\w-]{10,}$/.test(byQuery)) {
    return byQuery;
  }
  return null;
}

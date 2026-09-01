import { MEDIA_EXTENSIONS } from "@/lib/video/types";

// Google Drive upload (SPEC.md §14): a new way to add a document, picked from
// Drive instead of the local disk. This file is imported by both the client
// (the picker's own mime filter, and an instant pre-check before the file
// reaches the network) and the server (the authoritative check) — one
// definition of what is supported, never two that can drift apart.

// drive.file: the app only ever sees files the reader explicitly picks in the
// Google Picker, never the rest of their Drive. Google classifies this scope
// as non-sensitive — the OAuth token is requested fresh in the browser
// (lib/drive/picker-client.ts) and is never written to the database.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// Google Docs, Sheets, and Slides have no reader of their own here; Drive
// exports them to PDF first (lib/drive/fetch.ts), then they ingest exactly
// like an uploaded PDF.
const EXPORTABLE_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
]);

const MEDIA_MIME_RX = /^(?:video|audio)\//i;

// What a picked file becomes: "export" asks Drive to convert it to PDF first;
// "pdf" and "media" download the bytes directly and ingest exactly like an
// uploaded PDF or an uploaded video/audio file (SPEC.md §4 discipline
// extended to ingest — Drive is a new source, never a new parser).
export type DriveFileKind = "export" | "pdf" | "media" | "unsupported";

export function classifyDriveFile(mimeType: string, name: string): DriveFileKind {
  if (EXPORTABLE_MIME_TYPES.has(mimeType)) return "export";
  if (mimeType === "application/pdf") return "pdf";
  if (MEDIA_MIME_RX.test(mimeType) || MEDIA_EXTENSIONS.test(name)) return "media";
  return "unsupported";
}

// The picker's own filter: images, Forms, Drawings, raw .docx/.xlsx/.pptx,
// plain text, and everything else stay greyed out before the reader ever
// selects them.
export const DRIVE_PICKER_MIME_TYPES = [
  ...EXPORTABLE_MIME_TYPES,
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
].join(",");

// One file the reader selected in the picker.
export type DrivePickedFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
};

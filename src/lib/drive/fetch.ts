import type { DriveAccess } from "@/lib/drive/types";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { outboundFetch, type OutboundResponse } from "@/lib/outbound-fetch";

// Google Drive downloads (SPEC.md §14), authorized with a bearer token: the
// one the client obtained from Google Identity Services and forwarded on the
// import request, or one minted from the linked account's refresh token. The
// token is spent here and never stored. `grant` is what the token reaches
// (lib/drive/types.ts) — it picks the message when Drive refuses a file.

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// The direct-download URL doubles as the document's sourceUrl: re-picking the
// same Drive file dedupes against it, the same as re-adding a web link. It
// is the stored key, so it never changes; the fetch goes to driveFetchUrl.
export function driveDownloadUrl(fileId: string): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`;
}

// The URL a download fetches. supportsAllDrives: without it Drive answers
// 404 for every file on a shared drive, and the picker lists shared drives.
export function driveFetchUrl(fileId: string): string {
  return `${driveDownloadUrl(fileId)}&supportsAllDrives=true`;
}

function driveExportUrl(fileId: string, mimeType = "application/pdf"): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType)}`;
}

// Drive's refusal as one line for the reader: the app's own line for the
// cases it knows, and Google's own words on the rest, so "private or
// removed" is never the whole answer. Every refusal logs status, reason,
// and message.
async function driveErrorMessage(
  t: TFunc,
  res: OutboundResponse,
  grant: DriveAccess,
): Promise<string> {
  if (res.status === 401) return t("api.driveTokenExpired");
  let reason = "";
  let message = "";
  try {
    const body = (await res.json()) as {
      error?: { message?: string; errors?: { reason?: string; message?: string }[] };
    };
    reason = body.error?.errors?.[0]?.reason ?? "";
    message = body.error?.message ?? body.error?.errors?.[0]?.message ?? "";
  } catch {
    // Drive's error body is not always JSON (a proxy 502, a truncated
    // response) — the status code alone still picks a reasonable message.
  }
  console.error("[drive] fetch refused:", res.status, reason, message);
  if (reason === "exportSizeLimitExceeded") return t("api.driveExportTooLarge");
  // The Cloud project has the Drive API off: every file fails the same way.
  if (reason === "accessNotConfigured") return t("api.driveApiDisabled");
  // A picked-files grant reaches only what the reader picked in the Google
  // Picker; Drive answers 404 (or 403) for anything else — a pasted link to a
  // file the app never touched. Say so, instead of "private or removed".
  if (grant === "picked" && (res.status === 404 || res.status === 403)) {
    return t("api.driveNotPicked");
  }
  const base = t("api.driveFetchFailed");
  return message ? `${base} ${t("api.driveSaid", { message })}` : base;
}

// The picked file's facts, for imports that arrive as a bare file id — a
// pasted Drive link (SPEC.md §14). The picker sends name and mimeType itself.
export async function fetchDriveMetadata(
  fileId: string,
  token: string,
  grant: DriveAccess,
  t: TFunc,
): Promise<{ name: string; mimeType: string }> {
  const url = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent("name,mimeType")}&supportsAllDrives=true`;
  const res = await outboundFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await driveErrorMessage(t, res, grant));
  const data = (await res.json()) as { name?: string; mimeType?: string };
  if (!data.name || !data.mimeType) throw new Error(t("api.driveFetchFailed"));
  return { name: data.name, mimeType: data.mimeType };
}

// A Google file exported — Drive's own conversion — in the format asked
// for: PDF for Docs and Drawings (then ingested exactly like an uploaded
// PDF), .pptx for Slides and .xlsx for Sheets (SPEC.md §27; then ingested
// exactly like the uploaded file), and PDF again for a Slides file's
// pictures. Drive caps an export at 10 MB.
export async function fetchExported(
  fileId: string,
  token: string,
  grant: DriveAccess,
  t: TFunc,
  mimeType: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await outboundFetch(driveExportUrl(fileId, mimeType), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await driveErrorMessage(t, res, grant));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error(t("api.driveFetchFailed"));
  return bytes;
}

export function fetchExportedPdf(
  fileId: string,
  token: string,
  grant: DriveAccess,
  t: TFunc,
): Promise<Uint8Array<ArrayBuffer>> {
  return fetchExported(fileId, token, grant, t, "application/pdf");
}

// A file sitting in Drive as it is — a .pptx, a .xlsx, a .csv — the same
// bytes a direct upload would send.
export async function fetchDriveFile(
  fileId: string,
  token: string,
  grant: DriveAccess,
  t: TFunc,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await outboundFetch(driveFetchUrl(fileId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await driveErrorMessage(t, res, grant));
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_FILE_BYTES) throw new Error(t("api.pdfTooLarge"));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error(t("api.pdfTooLarge"));
  if (bytes.length === 0) throw new Error(t("api.driveFetchFailed"));
  return bytes;
}

// A PDF already sitting in Drive: the same bytes a direct upload would send,
// just fetched with a bearer token instead of a browser file picker.
export async function fetchDrivePdf(
  fileId: string,
  token: string,
  grant: DriveAccess,
  t: TFunc,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await outboundFetch(driveFetchUrl(fileId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await driveErrorMessage(t, res, grant));
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_PDF_BYTES) throw new Error(t("api.pdfTooLarge"));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES) throw new Error(t("api.pdfTooLarge"));
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error(t("api.notPdf"));
  }
  return bytes;
}

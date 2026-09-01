import type { TFunc } from "@/lib/i18n/dictionaries";
import { outboundFetch, type OutboundResponse } from "@/lib/outbound-fetch";

// Google Drive downloads (SPEC.md §14), authorized with the bearer token the
// client obtained from Google Identity Services and forwarded on the import
// request — the server never sees a stored Drive token, only this one-off one.

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const MAX_PDF_BYTES = 50 * 1024 * 1024;

// The direct-download URL doubles as the document's sourceUrl: re-picking the
// same Drive file dedupes against it, the same as re-adding a web link.
export function driveDownloadUrl(fileId: string): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`;
}

function driveExportUrl(fileId: string): string {
  const mimeType = encodeURIComponent("application/pdf");
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export?mimeType=${mimeType}`;
}

async function driveErrorMessage(t: TFunc, res: OutboundResponse): Promise<string> {
  if (res.status === 401) return t("api.driveTokenExpired");
  let reason = "";
  try {
    const body = (await res.json()) as { error?: { errors?: { reason?: string }[] } };
    reason = body.error?.errors?.[0]?.reason ?? "";
  } catch {
    // Drive's error body is not always JSON (a proxy 502, a truncated
    // response) — the status code alone still picks a reasonable message.
  }
  if (reason === "exportSizeLimitExceeded") return t("api.driveExportTooLarge");
  return t("api.driveFetchFailed");
}

// The picked file's facts, for imports that arrive as a bare file id — a
// pasted Drive link (SPEC.md §14). The picker sends name and mimeType itself.
export async function fetchDriveMetadata(
  fileId: string,
  token: string,
  t: TFunc,
): Promise<{ name: string; mimeType: string }> {
  const url = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent("name,mimeType")}`;
  const res = await outboundFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await driveErrorMessage(t, res));
  const data = (await res.json()) as { name?: string; mimeType?: string };
  if (!data.name || !data.mimeType) throw new Error(t("api.driveFetchFailed"));
  return { name: data.name, mimeType: data.mimeType };
}

// Google Docs, Sheets, Slides, and Drawings export to PDF — Drive's own
// conversion — then ingest exactly like an uploaded PDF; the app has no other
// reader for the native formats. Drive caps an export at 10 MB.
export async function fetchExportedPdf(
  fileId: string,
  token: string,
  t: TFunc,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await outboundFetch(driveExportUrl(fileId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await driveErrorMessage(t, res));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error(t("api.driveFetchFailed"));
  return bytes;
}

// A PDF already sitting in Drive: the same bytes a direct upload would send,
// just fetched with a bearer token instead of a browser file picker.
export async function fetchDrivePdf(
  fileId: string,
  token: string,
  t: TFunc,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await outboundFetch(driveDownloadUrl(fileId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await driveErrorMessage(t, res));
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_PDF_BYTES) throw new Error(t("api.pdfTooLarge"));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES) throw new Error(t("api.pdfTooLarge"));
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error(t("api.notPdf"));
  }
  return bytes;
}

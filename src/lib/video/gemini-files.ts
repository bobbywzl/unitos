import { outboundFetch } from "@/lib/outbound-fetch";
import { recordUsage } from "@/lib/usage";

// Gemini's file store (SPEC.md §11). A video or audio file too big to send
// inline is uploaded here first and then referred to by its URI, exactly the
// way a YouTube URL is referred to — so the same long-context transcription
// path serves both. Inline parts ride inside a 20 MB request; the store takes
// 2 GB, which is every upload this app accepts.
//
// The upload is Google's resumable protocol: a start request that answers with
// a URL, then the bytes to that URL. A video is processed after it lands, so
// the file is PROCESSING for a while and only an ACTIVE file can be read.

const BASE = "https://generativelanguage.googleapis.com";
// A stored file lives 48 hours; the id is kept on the asset so a retry inside
// that window skips the upload (VideoAsset.geminiFileUri).
export const GEMINI_FILE_TTL_MS = 47 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;

export type GeminiFile = { uri: string; name: string; mimeType: string };

function key(): string {
  const value = process.env.GEMINI_API_KEY;
  if (!value) throw new Error("GEMINI_API_KEY is not set");
  return value;
}

async function reason(res: { json(): Promise<unknown> ; status: number }): Promise<string> {
  const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return detail?.error?.message ?? `request failed (${res.status})`;
}

/** Put the bytes in the store and wait until they can be read. `deadline` is
    epoch ms: the wait gives up before it rather than running past the caller's
    own budget. */
export async function uploadGeminiFile(
  bytes: Uint8Array,
  mimeType: string,
  opts: { displayName?: string; deadline?: number } = {},
): Promise<GeminiFile> {
  const start = await outboundFetch(`${BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key(),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: opts.displayName ?? "media" } }),
  });
  if (!start.ok) throw new Error(`file upload could not start: ${await reason(start)}`);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("file upload could not start: no upload URL");

  const sent = await outboundFetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  if (!sent.ok) throw new Error(`file upload failed: ${await reason(sent)}`);
  const body = (await sent.json()) as {
    file?: { uri?: string; name?: string; mimeType?: string; state?: string };
  };
  const file = body.file;
  if (!file?.uri || !file.name) throw new Error("file upload returned no file");
  // The bytes are billed as input on the call that reads them; the upload
  // itself is free. Record the size so the admin page shows the traffic.
  recordUsage({ userId: null, feature: "transcribe-upload", model: "gemini-files" }, { inputTokens: 0 }, 0);

  const ready = await waitForActive(file.name, file.state ?? "PROCESSING", opts.deadline);
  return { uri: file.uri, name: file.name, mimeType: ready.mimeType ?? mimeType };
}

/** Poll until the file can be read. A video is processed after it lands. */
async function waitForActive(
  name: string,
  state: string,
  deadline?: number,
): Promise<{ mimeType?: string }> {
  let current = state;
  let file: { state?: string; mimeType?: string; error?: { message?: string } } = {};
  while (current === "PROCESSING") {
    if (deadline !== undefined && Date.now() > deadline) {
      throw new Error("the file was still processing when the time ran out");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const res = await outboundFetch(`${BASE}/v1beta/${name}`, {
      headers: { "x-goog-api-key": key() },
    });
    if (!res.ok) throw new Error(`file could not be read: ${await reason(res)}`);
    file = (await res.json()) as typeof file;
    current = file.state ?? "PROCESSING";
  }
  if (current !== "ACTIVE") {
    throw new Error(file.error?.message ?? `the file could not be processed (${current})`);
  }
  return file;
}

/** True while a stored file is still readable. */
export function geminiFileFresh(expiresAt: Date | null | undefined): boolean {
  return expiresAt !== null && expiresAt !== undefined && expiresAt.getTime() > Date.now();
}

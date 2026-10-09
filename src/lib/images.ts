// Images dropped into a note or into the reader's edit mode (SPEC.md §16):
// the caps, the tier rule, and the URL the reader loads them from. The client
// checks the size before the upload so the refusal is instant; the route
// checks it again, because the client's check is a courtesy, not the gate.

import { IMAGE_EXTENSIONS, isImageFile } from "@/lib/handwritten/image";
import { DEFAULT_LANG, isLang, LANG_COOKIE } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

export { IMAGE_ACCEPT, IMAGE_EXTENSIONS, isImageFile, sniffImage } from "@/lib/handwritten/image";

/** Unitos Free drops images up to this size (TIERS.md). */
export const FREE_IMAGE_BYTES = 5 * 1024 * 1024;
/** The largest image any tier stores. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Why a dropped file cannot be added, or null when it can. The reader turns
    the reason into the message; the route answers with the same reasons. */
export type ImageRefusal = "not-image" | "premium" | "too-large";

export function refuseImage(
  file: { type: string; name: string; size: number },
  premium: boolean,
): ImageRefusal | null {
  if (!isImageFile(file)) return "not-image";
  if (file.size > MAX_IMAGE_BYTES) return "too-large";
  if (file.size > FREE_IMAGE_BYTES && !premium) return "premium";
  return null;
}

/** Where the reader loads a stored image from. */
export function imageUrl(id: string): string {
  return `/api/images/${id}`;
}

/** The stored image an address points at (`/api/images/<id>`, on this site),
    or null for any other address. */
export function storedImageId(src: string): string | null {
  let path = src;
  if (/^https?:/i.test(src)) {
    try {
      const url = new URL(src);
      if (typeof window === "undefined" || url.origin !== window.location.origin) return null;
      path = url.pathname;
    } catch {
      return null;
    }
  }
  return /^\/api\/images\/([a-z0-9]+)(?:[?#]|$)/i.exec(path)?.[1] ?? null;
}

/** The image markdown a note carries: the alt text is the file's name, so a
    note read without the image still says what was there. */
export function imageMarkdown(id: string, name: string): string {
  return `![${name.replace(IMAGE_EXTENSIONS, "").replace(/[[\]]/g, "")}](${imageUrl(id)})`;
}

/** The html a FIGURE block carries for a dropped image: `src` is the stored
    image's URL, or the address of a picture from another page that the
    browser could not read. */
export function imageFigureHtml(src: string, alt: string): string {
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<figure><img src="${escape(src)}" alt="${escape(alt)}" /></figure>`;
}

/** Store one dropped image and get its URL back. Throws with the server's
    plain reason — too large, not an image, or Unitos Premium — or, when the
    server gave none (a server error, no network), the one failure line
    "Not saved. Try again." (offline: "Not saved. Try again when you are
    online."); the status and the error go to the console. */
export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  let res: Response;
  try {
    res = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch (err) {
    console.warn("Image not saved:", err instanceof Error ? err.message : String(err));
    throw new Error(notSavedLine());
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    if (detail?.error && res.status < 500) throw new Error(detail.error);
    console.warn("Image not saved:", res.status, detail?.error ?? "");
    throw new Error(notSavedLine());
  }
  return (await res.json()) as { id: string; url: string };
}

/** "Not saved. Try again." in the page's language (the lang cookie); offline,
    "Not saved. Try again when you are online.", the line of every write
    (`src/lib/api.ts`). */
function notSavedLine(): string {
  const value = typeof document === "undefined" ? null : document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`))?.[1];
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return translate(isLang(value) ? value : DEFAULT_LANG, offline ? "common.offline" : "common.notSaved");
}

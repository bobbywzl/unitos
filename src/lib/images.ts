// Images dropped into a note or into the reader's edit mode (SPEC.md §16):
// the caps, the tier rule, and the URL the reader loads them from. The client
// checks the size before the upload so the refusal is instant; the route
// checks it again, because the client's check is a courtesy, not the gate.

import { IMAGE_EXTENSIONS, isImageFile } from "@/lib/handwritten/image";

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

/** The image markdown a note carries: the alt text is the file's name, so a
    note read without the image still says what was there. */
export function imageMarkdown(id: string, name: string): string {
  return `![${name.replace(IMAGE_EXTENSIONS, "").replace(/[[\]]/g, "")}](${imageUrl(id)})`;
}

/** The html a FIGURE block carries for a dropped image. */
export function imageFigureHtml(id: string, alt: string): string {
  const safe = alt.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<figure><img src="${imageUrl(id)}" alt="${safe}" /></figure>`;
}

/** Store one dropped image and get its URL back. Throws with the server's
    plain reason — too large, not an image, or Unitos Premium. */
export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  const res = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as { id: string; url: string };
}

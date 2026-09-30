// A picture dragged from another web page (SPEC.md §16, §29). The drag
// carries the picture's address (text/uri-list) and a copy of its <img>
// (text/html); Chrome often adds the picture itself as a file, which then
// drops like any file. One reader of that data for the page editor and the
// block reader.

import { isImageFile } from "@/lib/handwritten/image";

export type DroppedImageUrl = { url: string; alt: string };

// An address that names an image file by its extension.
const IMAGE_ADDRESS = /\.(png|jpe?g|gif|webp|bmp|avif)([?#]|$)/i;

/** True when a drag without files may be a picture from another page: it
    carries an address. A selection of words dragged in the page carries
    none. */
export function mayCarryPageImage(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types);
  return !types.includes("Files") && (types.includes("text/uri-list") || types.includes("text/x-moz-url"));
}

function usable(url: string): boolean {
  if (/^data:image\//i.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** The pictures a drop from another page carries, when it carries nothing
    else: the <img> addresses of its html when the html holds no words, else
    the addresses of its uri-list that name an image file. Empty for words, a
    link to a page, or a mix of words and pictures (those paste as words). */
export function droppedImageUrls(dt: DataTransfer | null): DroppedImageUrl[] {
  if (!dt) return [];
  const html = dt.getData("text/html");
  if (html && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const images = Array.from(doc.querySelectorAll("img"));
    const words = (doc.body.textContent ?? "").replace(/\s+/g, "");
    if (words) return [];
    const found = images
      .map((img) => ({ url: img.getAttribute("src") ?? "", alt: (img.getAttribute("alt") ?? "").trim() }))
      .filter((image) => usable(image.url));
    if (found.length > 0) return found;
  }
  const list = dt.getData("text/uri-list") || dt.getData("text/x-moz-url").split("\n")[0] || "";
  return list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((url) => url && !url.startsWith("#") && usable(url) && (IMAGE_ADDRESS.test(url) || url.startsWith("data:")))
    .map((url) => ({ url, alt: "" }));
}

/** The file name an address stands for: its last part, else "image". */
function nameOf(url: string, type: string): string {
  if (!url.startsWith("data:")) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
      if (last && isImageFile({ name: last, type })) return last;
    } catch {
      // Not an address with a path: the generic name.
    }
  }
  return `image.${type.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`;
}

/** The picture at `url` as a file, when the browser may read it: a data:
    address, an address of this site, or a site that allows it. Null when it
    may not, or when what comes back is not an image. */
export async function imageFileFrom(url: string): Promise<File | null> {
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const type = blob.type.split(";")[0].trim();
    const file = new File([blob], nameOf(url, type), { type });
    return isImageFile(file) ? file : null;
  } catch {
    return null;
  }
}

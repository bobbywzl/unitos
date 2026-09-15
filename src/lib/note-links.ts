// Links dragged into a note (SPEC.md §6): a link from a page, a bookmark, or
// the address bar lands in the note as a markdown link on its own line, and
// the rendered note draws it as a link card (components/markdown.tsx). One
// reader of the drag's data for every note surface — the card, the floating
// card, the editor.

export type DroppedLink = { url: string; title: string };

const URL_TYPES = ["text/uri-list", "text/x-moz-url"];

/** True when the drag carries a link and no file. */
export function hasDroppedLinks(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types);
  if (types.includes("Files")) return false;
  return URL_TYPES.some((type) => types.includes(type));
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** The link's text as the address reads: no scheme, no www., no trailing
    slash, cut at 60 characters. What the note shows when the drag brought
    no title of its own. */
export function linkLabel(url: string): string {
  const bare = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return bare.length > 60 ? `${bare.slice(0, 59)}…` : bare;
}

/** The titles a drag from a page carries: the text of each anchor in its html. */
function titlesFromHtml(html: string): Map<string, string> {
  const titles = new Map<string, string>();
  if (typeof DOMParser === "undefined") return titles;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    if (href && text && !titles.has(href)) titles.set(href, text);
  }
  return titles;
}

/** The links the drag carries, in order, each with the best title the drag
    brought: the anchor's text, a Firefox title line, else the address. */
export function readDroppedLinks(dt: DataTransfer | null): DroppedLink[] {
  if (!dt) return [];
  const urls: string[] = [];
  const titles = new Map<string, string>();
  const moz = dt.getData("text/x-moz-url");
  if (moz) {
    // Firefox: url and title on alternate lines.
    const lines = moz.split("\n").map((l) => l.trim());
    for (let i = 0; i < lines.length; i += 2) {
      if (lines[i]) {
        urls.push(lines[i]);
        if (lines[i + 1]) titles.set(lines[i], lines[i + 1]);
      }
    }
  }
  const list = dt.getData("text/uri-list");
  if (list) {
    for (const line of list.split(/\r?\n/)) {
      const url = line.trim();
      if (url && !url.startsWith("#") && !urls.includes(url)) urls.push(url);
    }
  }
  const html = dt.getData("text/html");
  if (html) {
    for (const [href, text] of titlesFromHtml(html)) if (!titles.has(href)) titles.set(href, text);
  }
  return urls
    .filter(isHttpUrl)
    .map((url) => ({ url, title: titles.get(url) ?? linkLabel(url) }));
}

/** The markdown a dropped link lands as. The title never breaks the link:
    brackets in it are dropped. */
export function linkMarkdown(link: DroppedLink): string {
  const title = link.title.replace(/[[\]]/g, "").trim() || linkLabel(link.url);
  const url = link.url.replace(/[()\s]/g, (c) => encodeURIComponent(c));
  return `[${title}](${url})`;
}

/** The host a link card shows under its title. */
export function linkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

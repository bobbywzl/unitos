import type { CitationSpan, DocumentReference, ParsedBlock } from "@/lib/parse/types";
import { findWeblinks } from "@/lib/weblinks";

// Citations and references for URL ingestion (SPEC.md §2). Two jobs, one pass:
// 1. Find the article's reference list, turn each entry into a DocumentReference,
//    and remove the list from the DOM — the reader renders it as the expandable
//    References section instead of a wall of blocks.
// 2. Find in-text citations — fragment links into the reference list, and
//    hyperlinks in the article text — and mark them so each becomes a
//    CitationSpan on its block, pointing at a reference.
//
// Marking protocol: a citation link is replaced with its own child nodes wrapped
// in private-use sentinel characters (OPEN + refId + MID … CLOSE). The sentinels
// survive text normalization; takeCitations lifts them back out as spans against
// the clean block text. Nothing here writes text: entry text is the page's text,
// URLs are the page's URLs.

const CITE_OPEN = "\uE000";
const CITE_MID = "\uE001";
const CITE_CLOSE = "\uE002";

const REF_TEXT_MAX = 600; // one reference entry
const CITATION_TEXT_MAX = 300; // linked text longer than this is a promo card, not a citation
const REFERENCES_MAX = 1000;

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ── Reference list detection ────────────────────────────────────────────────

// Leading decoration tolerated: "§ References", "8. References".
const REF_HEADING_RX =
  /^[^a-z]*(references?|bibliography|works cited|citations?|notes|endnotes|footnotes|sources|literature cited)\b[\s\d.:]*$/i;
// Paragraph-style reference lists only under an unambiguous heading.
const STRONG_REF_HEADING_RX = /^[^a-z]*(references?|bibliography|works cited|literature cited)\b[\s\d.:]*$/i;
// Class or id hints that a container is the reference list.
// No content words here: "literature" matched section ids like
// #literature-review and swallowed body lists (unitoscompareloop).
const REF_HINT_RX =
  /\b(references|bibliography|footnotes|endnotes|citation-list|works[-_]?cited|ref[-_]?list|reflist|refbegin|biblist)\b/i;
// Entry element ids that in-text citation links point at.
const ENTRY_ID_RX = /^(cite[_-]?note|citeref|ref|reference|fn|footnote|note|bib|endnote)[-_:.]?/i;
const SHORT_ENTRY_ID_RX = /^(b|r|cr)-?\d+$/i;
const BACKLINK_SELECTOR =
  'a[role="doc-backlink"], .mw-cite-backlink, a[rev="footnote"], .footnote-backref, .footnote-return';

function isList(el: Element): boolean {
  return /^(ol|ul)$/i.test(el.tagName);
}

function hasReferenceHint(el: Element): boolean {
  return REF_HINT_RX.test(`${el.getAttribute("class") ?? ""} ${el.id}`);
}

function hasEntryId(li: Element): boolean {
  return ENTRY_ID_RX.test(li.id) || SHORT_ENTRY_ID_RX.test(li.id);
}

function isHeading(el: Element): boolean {
  return /^h[1-6]$/i.test(el.tagName);
}

function directItems(list: Element): Element[] {
  return [...list.children].filter((c) => c.tagName.toLowerCase() === "li");
}

// A group of DOM elements that together form (part of) the reference list:
// the entry elements, plus everything to remove once citations are marked.
type ReferenceGroup = {
  entries: Element[];
  removal: Element[];
};

/** A "References"-style heading, possibly inside a wrapper div whose only real
    content is the heading (Wikipedia's .mw-heading). Returns the element to
    remove: the heading, or its wrapper. */
function referenceHeading(candidate: Element | null | undefined): Element | null {
  if (!candidate) return null;
  const heading = isHeading(candidate)
    ? candidate
    : candidate.querySelector("h1, h2, h3, h4, h5, h6");
  if (!heading || !REF_HEADING_RX.test(normalizeText(heading.textContent ?? ""))) return null;
  if (heading === candidate) return candidate;
  // A wrapper counts only when the heading is essentially all of it (edit
  // links and anchors aside) — never a whole section.
  const slack = normalizeText(candidate.textContent ?? "").length -
    normalizeText(heading.textContent ?? "").length;
  return slack <= 24 ? candidate : null;
}

/** The previous sibling that has content, skipping empty placeholder elements
    (Wikipedia leaves .mw-empty-elt spans between a heading and its list). */
function previousContentSibling(el: Element): Element | null {
  let sib = el.previousElementSibling;
  while (
    sib &&
    !normalizeText(sib.textContent ?? "") &&
    !sib.querySelector("img, svg, video")
  ) {
    sib = sib.previousElementSibling;
  }
  return sib;
}

/** The heading that labels a reference list: the previous sibling of the list
    or of a wrapper above it (wrappers nest — .reflist > .mw-references-wrap >
    ol), or the first heading inside a hinted wrapper. A wrapper is an ancestor
    that holds little text beyond the list itself. */
function labelingHeading(list: Element): Element | null {
  const listLength = normalizeText(list.textContent ?? "").length;
  let node: Element | null = list;
  for (let depth = 0; node && depth < 4; depth++) {
    const heading = referenceHeading(previousContentSibling(node));
    if (heading) return heading;
    const parent: Element | null = node.parentElement;
    if (!parent || normalizeText(parent.textContent ?? "").length > listLength + 200) break;
    node = parent;
  }
  const wrapper = list.parentElement;
  if (wrapper && hasReferenceHint(wrapper)) {
    const first = wrapper.querySelector("h1, h2, h3, h4, h5, h6");
    if (first && REF_HEADING_RX.test(normalizeText(first.textContent ?? ""))) return first;
  }
  return null;
}

/** Lists that declare themselves the reference list: a class/id hint on the
    list or a close ancestor, or entry-shaped ids on the items. */
function hintedLists(root: Element, captured: Set<Element>): ReferenceGroup[] {
  const groups: ReferenceGroup[] = [];
  for (const list of root.querySelectorAll("ol, ul")) {
    if (captured.has(list)) continue;
    if (list.parentElement?.closest("ol, ul")) continue; // nested list: the outer one decides
    const items = directItems(list);
    if (items.length === 0) continue;
    // The hint must sit on the list or its direct wrapper — a hinted section
    // three levels up captures body lists that merely live in that section.
    let hinted = false;
    let ancestor: Element | null = list;
    for (let depth = 0; ancestor && depth < 2; depth++) {
      if (hasReferenceHint(ancestor)) {
        hinted = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    // A hinted list must also be shaped like citations — years, entry
    // numbers, DOIs — or it is body content wearing a hinted wrapper.
    const shaped =
      items.filter((li) => {
        const text = normalizeText(li.textContent ?? "");
        return (
          text.length <= 800 &&
          (/\b(19|20)\d{2}\b/.test(text) ||
            /^\[?\d{1,4}[\]).]/.test(text) ||
            /doi\.org|arxiv\.org/i.test(text))
        );
      }).length *
        2 >
      items.length;
    const idMatches = items.filter(hasEntryId).length;
    const byIds = items.length >= 3 && idMatches * 2 > items.length;
    if (!(hinted && shaped && items.length >= 2) && !byIds) continue;
    captured.add(list);
    const heading = labelingHeading(list);
    groups.push({ entries: items, removal: heading ? [heading, list] : [list] });
  }
  return groups;
}

/** Reference-shaped paragraph: most reference strings carry a year, a link,
    or a leading entry number. */
function looksLikeReferenceParagraph(p: Element): boolean {
  const text = normalizeText(p.textContent ?? "");
  if (!text || text.length > 800) return false;
  return /\b(19|20)\d{2}\b/.test(text) || /^\[?\d{1,4}[\]).]/.test(text) || p.querySelector("a[href]") !== null;
}

/** Lists (or a guarded paragraph run) under a "References"-style heading. */
function headedLists(root: Element, captured: Set<Element>): ReferenceGroup[] {
  const groups: ReferenceGroup[] = [];
  for (const heading of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const title = normalizeText(heading.textContent ?? "");
    if (!REF_HEADING_RX.test(title)) continue;

    const lists: Element[] = [];
    const removal: Element[] = [heading];
    let sib = heading.nextElementSibling;
    let hops = 0;
    while (sib && hops < 4) {
      if (isList(sib)) {
        lists.push(sib);
        removal.push(sib);
        sib = sib.nextElementSibling;
        continue;
      }
      if (lists.length > 0 || isHeading(sib)) break;
      // One wrapper deep: a div that is essentially the list.
      const innerLists = [...sib.children].filter(isList);
      if (
        innerLists.length > 0 &&
        normalizeText(sib.textContent ?? "").length <
          innerLists.reduce((n, l) => n + normalizeText(l.textContent ?? "").length, 0) + 80
      ) {
        lists.push(...innerLists);
        removal.push(sib);
        break;
      }
      sib = sib.nextElementSibling;
      hops++;
    }

    if (lists.length > 0) {
      const fresh = lists.filter((l) => !captured.has(l));
      for (const l of lists) captured.add(l);
      // The lists may already be captured by a hint group; the heading still goes.
      const entries = fresh.flatMap(directItems);
      if (entries.length > 0 || fresh.length !== lists.length) {
        groups.push({ entries, removal });
      }
      continue;
    }

    // Paragraph-style reference list: consecutive reference-shaped paragraphs.
    if (!STRONG_REF_HEADING_RX.test(title)) continue;
    const paragraphs: Element[] = [];
    for (let p = heading.nextElementSibling; p; p = p.nextElementSibling) {
      if (p.tagName.toLowerCase() !== "p") break;
      paragraphs.push(p);
    }
    const shaped = paragraphs.filter(looksLikeReferenceParagraph).length;
    if (paragraphs.length >= 3 && shaped * 2 >= paragraphs.length) {
      groups.push({ entries: paragraphs, removal: [heading, ...paragraphs] });
    }
  }
  return groups;
}

// ── Entry building ──────────────────────────────────────────────────────────

/** First outbound http(s) URL in an entry, resolved absolute. Fragment links
    (backlinks, cross-entry links) never count. With no link element, a
    URL-shaped token in the entry text still gives the entry its target —
    plain-text "mcap.dev" style references. */
function entryUrl(el: Element, baseUrl: string): string | null {
  for (const a of el.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (!href || href.startsWith("#")) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") return resolved.toString();
    } catch {
      continue;
    }
  }
  const [weblink] = findWeblinks(normalizeText(el.textContent ?? ""));
  return weblink?.href ?? null;
}

function buildEntry(
  el: Element,
  id: string,
  fallbackLabel: string,
  baseUrl: string,
): DocumentReference | null {
  const clone = el.cloneNode(true) as Element;
  for (const backlink of clone.querySelectorAll(BACKLINK_SELECTOR)) backlink.remove();
  // Tiny fragment links inside an entry are jump-backs (↩, ^, a b c).
  for (const a of [...clone.querySelectorAll('a[href^="#"]')]) {
    if (normalizeText(a.textContent ?? "").length <= 2) a.remove();
  }
  let text = normalizeText(clone.textContent ?? "");
  if (!text) return null;

  // The entry's own number: li value attribute, or a leading marker in the text
  // (stripped — the References section numbers entries itself).
  let label = el.getAttribute("value") || fallbackLabel;
  const marker = /^\[?(\d{1,4})[\]).:]?\s+/.exec(text);
  if (marker) {
    label = marker[1];
    text = text.slice(marker[0].length);
  }
  if (text.length > REF_TEXT_MAX) text = `${text.slice(0, REF_TEXT_MAX)}…`;

  return { id, label, text, url: entryUrl(clone, baseUrl) };
}

// ── Citation marking ────────────────────────────────────────────────────────

function wrapCitation(a: Element, refId: string) {
  const doc = a.ownerDocument;
  a.replaceWith(
    doc.createTextNode(`${CITE_OPEN}${refId}${CITE_MID}`),
    ...a.childNodes,
    doc.createTextNode(CITE_CLOSE),
  );
}

function withoutHash(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}

// ── The pass ────────────────────────────────────────────────────────────────

/** Extract the reference list, mark every in-text citation with sentinel
    tokens, and remove the reference list from the DOM. Returns the references
    in document order — reference-list entries first (formalCount of them),
    then entries created from hyperlinks in the text. Blocks lift their
    citation spans later via takeCitations. */
export function prepareCitations(
  document: Document,
  root: Element,
  pageUrl: string,
): { references: DocumentReference[]; formalCount: number } {
  const captured = new Set<Element>();
  const groups = [...hintedLists(root, captured), ...headedLists(root, captured)];
  // Explicit containers can sit outside the content root (a sibling of <article>).
  if (groups.length === 0 && root !== document.body) {
    groups.push(...hintedLists(document.body, captured));
  }

  // Entries in document order, numbered r1, r2, …
  const entryElements = groups
    .flatMap((g) => g.entries)
    .sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1)); // 4 = DOCUMENT_POSITION_FOLLOWING
  const references: DocumentReference[] = [];
  const refIdByTargetId = new Map<string, string>();
  const refIdByUrl = new Map<string, string>();
  for (const el of entryElements) {
    if (references.length >= REFERENCES_MAX) break;
    const id = `r${references.length + 1}`;
    const entry = buildEntry(el, id, String(references.length + 1), pageUrl);
    if (!entry) continue;
    references.push(entry);
    // Fragment citations resolve by target id: the entry's own id, its
    // descendants' ids, and a data stamp for ids nested deeper.
    el.setAttribute("data-uref", id);
    if (el.id) refIdByTargetId.set(el.id, id);
    for (const inner of [...el.querySelectorAll("[id]")].slice(0, 10)) {
      refIdByTargetId.set(inner.id, id);
    }
    if (entry.url) refIdByUrl.set(entry.url.replace(/\/$/, ""), id);
  }
  const formalCount = references.length;

  // Mark in-text citations. Links inside figures, tables, and code keep their
  // element form (their html renders as-is); links inside the reference list
  // itself are entry content, not citations.
  const removalRoots = groups.flatMap((g) => g.removal);
  const insideReferences = (a: Element) =>
    removalRoots.some((el) => el.contains(a)) || a.closest("[data-uref]") !== null;
  let pageBase: URL | null = null;
  try {
    pageBase = new URL(pageUrl);
  } catch {
    pageBase = null;
  }

  for (const a of [...root.querySelectorAll("a[href]")]) {
    if (!a.isConnected || a.closest("figure, table, pre, svg")) continue;
    if (insideReferences(a)) continue;
    const href = a.getAttribute("href") ?? "";

    // Fragment link: a citation when it lands on (or inside) a reference entry.
    const resolveFragment = (fragment: string) => {
      let id = fragment;
      try {
        id = decodeURIComponent(fragment);
      } catch {
        // keep the raw fragment
      }
      const target = document.getElementById(id);
      return (
        refIdByTargetId.get(id) ??
        target?.closest("[data-uref]")?.getAttribute("data-uref") ??
        null
      );
    };
    if (href.startsWith("#")) {
      const refId = resolveFragment(href.slice(1));
      if (refId) wrapCitation(a, refId);
      continue;
    }

    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    // A link back to this page is a fragment citation or nothing.
    if (pageBase && withoutHash(resolved) === withoutHash(pageBase)) {
      if (resolved.hash) {
        const refId = resolveFragment(resolved.hash.slice(1));
        if (refId) wrapCitation(a, refId);
      }
      continue;
    }
    // With a formal reference list, same-site links are navigation, not
    // citations (a wiki links half its words to itself). Without one, the
    // article's hyperlinks ARE its references.
    if (formalCount > 0 && pageBase && resolved.hostname === pageBase.hostname) continue;

    const text = normalizeText(a.textContent ?? "");
    if (!text || text.length > CITATION_TEXT_MAX) continue;
    if (a.querySelector("h1, h2, h3, h4, h5, h6, img, svg, video, figure")) continue; // card link

    const key = resolved.toString().replace(/\/$/, "");
    let refId = refIdByUrl.get(key);
    if (!refId) {
      if (references.length >= REFERENCES_MAX) continue;
      refId = `r${references.length + 1}`;
      references.push({
        id: refId,
        label: String(references.length + 1),
        text,
        url: resolved.toString(),
      });
      refIdByUrl.set(key, refId);
    }
    wrapCitation(a, refId);
  }

  for (const el of removalRoots) el.remove();
  // A hinted wrapper left holding only its title or backlink cruft goes too.
  for (const group of groups) {
    for (const el of group.removal) {
      const parent = el.parentElement;
      if (
        parent &&
        parent !== root &&
        parent.isConnected &&
        hasReferenceHint(parent) &&
        normalizeText(parent.textContent ?? "").length < 40
      ) {
        parent.remove();
      }
    }
  }
  return { references, formalCount };
}

/** Drop link references nothing cites — their citing blocks fell to the core
    or structure pass (site chrome carries links too) — and renumber the kept
    link references so the list stays gapless. Reference-list entries always
    stay: the article's reference list belongs in the References section even
    where no in-text citation resolved. */
export function pruneReferences(
  blocks: ParsedBlock[],
  references: DocumentReference[],
  formalCount: number,
): DocumentReference[] {
  const cited = new Set(blocks.flatMap((b) => (b.citations ?? []).map((c) => c.refId)));
  return references
    .filter((r, i) => i < formalCount || cited.has(r.id))
    .map((r, i) => (i < formalCount ? r : { ...r, label: String(i + 1) }));
}

// ── Lifting sentinel tokens out of block text ───────────────────────────────

function hasCitationTokens(s: string): boolean {
  return s.includes(CITE_OPEN) || s.includes(CITE_MID) || s.includes(CITE_CLOSE);
}

/** Remove citation tokens from a string without recording spans. */
export function stripCitationTokens(s: string): string {
  return s.replace(/\uE000r\d+\uE001|[\uE000-\uE002]/g, "");
}

/** Lift citation tokens out of block text: returns the clean text and the
    citation spans against it. Whitespace that doubles up where a token sat is
    collapsed as the clean text builds, so span offsets stay honest. Stray
    private-use characters (icon fonts) drop without becoming spans. */
export function takeCitations(raw: string): { text: string; citations: CitationSpan[] } {
  if (!hasCitationTokens(raw)) return { text: raw, citations: [] };
  let out = "";
  const citations: CitationSpan[] = [];
  const open: { refId: string; start: number }[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === CITE_OPEN) {
      const mid = raw.indexOf(CITE_MID, i + 1);
      const refId = mid === -1 ? "" : raw.slice(i + 1, mid);
      if (/^r\d+$/.test(refId)) {
        open.push({ refId, start: out.length });
        i = mid + 1;
        continue;
      }
      i++; // stray OPEN: drop the character
      continue;
    }
    if (ch === CITE_CLOSE) {
      const span = open.pop();
      if (span) {
        let start = span.start;
        let end = out.length;
        while (start < end && out[start] === " ") start++;
        while (end > start && out[end - 1] === " ") end--;
        if (end > start) {
          citations.push({ start, end, refId: span.refId, quotedText: out.slice(start, end) });
        }
      }
      i++;
      continue;
    }
    if (ch === CITE_MID) {
      i++; // stray MID: drop the character
      continue;
    }
    if (ch === " " && (out.endsWith(" ") || out.endsWith("\n") || out.length === 0)) {
      i++; // token removal must not leave doubled or leading spaces
      continue;
    }
    out += ch;
    i++;
  }
  while (out.endsWith(" ")) out = out.slice(0, -1);
  return { text: out, citations };
}

const CITED_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST"]);

function headingHtml(oldHtml: string | undefined, text: string): string | undefined {
  const level = oldHtml?.match(/^<h([1-3])/)?.[1];
  if (!level) return oldHtml;
  return `<h${level}>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h${level}>`;
}

/** Lift citation tokens across a parsed block list. Text-rendered types keep
    their spans; every other type just sheds the tokens. Blocks emptied by the
    lift drop. */
export function liftCitations(blocks: ParsedBlock[]): ParsedBlock[] {
  return blocks
    .map((block) => {
      if (!hasCitationTokens(block.text)) return block;
      if (CITED_TYPES.has(block.type)) {
        const { text, citations } = takeCitations(block.text);
        return {
          ...block,
          text,
          html: block.type === "HEADING" ? headingHtml(block.html, text) : block.html,
          ...(citations.length > 0 ? { citations } : {}),
        };
      }
      const stripped = stripCitationTokens(block.text);
      // CODE keeps its spacing; prose-ish text collapses the doubled spaces.
      return {
        ...block,
        text: block.type === "CODE" ? stripped : stripped.replace(/ {2,}/g, " ").trim(),
      };
    })
    .filter((block) => block.text.trim().length > 0);
}

/** Unlinked bracket citations: with a formal reference list, plain "[12]" in
    block text resolves to the entry labeled 12. Spans already lifted from
    links win; multi-number groups ([3, 7]) point at their first entry. */
export function inferBracketCitations(
  blocks: ParsedBlock[],
  references: DocumentReference[],
): ParsedBlock[] {
  const byLabel = new Map(references.map((r) => [r.label, r.id]));
  if (byLabel.size === 0) return blocks;
  return blocks.map((block) => {
    if (!CITED_TYPES.has(block.type) || !block.text.includes("[")) return block;
    const existing = block.citations ?? [];
    const found: CitationSpan[] = [];
    for (const m of block.text.matchAll(/\[(\d{1,4})(?:\s*[,–-]\s*\d{1,4})*\]/g)) {
      const refId = byLabel.get(m[1]);
      if (!refId) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (existing.some((c) => c.start < end && c.end > start)) continue;
      found.push({ start, end, refId, quotedText: m[0] });
    }
    if (found.length === 0) return block;
    return { ...block, citations: [...existing, ...found].sort((a, b) => a.start - b.start) };
  });
}

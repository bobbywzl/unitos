import type { ParsedBlock } from "@/lib/parse/types";

// Split (SPEC.md §14): separating very long content into multiple documents at
// heading boundaries, for easier parsing and reading. The upload assistant
// proposes it before any content is saved; the reader decides. Text is never
// rewritten — blocks move whole into their part.

// One printed page of text, for the estimates the upload assistant shows.
export const PAGE_CHARS = 3_000;
// Below this, a split is noise: the document reads fine whole.
export const SPLIT_MIN_CHARS = 45_000;
// The page estimate at which the split question is always asked.
export const SPLIT_ASK_PAGES = 40;
// Target pages per split part.
const PART_PAGES = 25;
const MAX_PARTS = 12;

export function pageEstimate(chars: number): number {
  return Math.max(1, Math.round(chars / PAGE_CHARS));
}

export function splitPartCount(chars: number): number {
  return Math.min(MAX_PARTS, Math.max(2, Math.ceil(pageEstimate(chars) / PART_PAGES)));
}

export type SplitPart = { title: string; blocks: ParsedBlock[] };

function headingLevel(block: ParsedBlock): number | null {
  if (block.type !== "HEADING") return null;
  const m = /^<h([1-6])/.exec(block.html ?? "");
  return m ? Number(m[1]) : 2;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Partition blocks into about `parts` parts, breaking at headings of the
    shallowest level that occurs more than once; with no such headings, at any
    block boundary once a part is full. Returns one part (unsplit) when the
    content is too short to split. */
export function splitBlocks(title: string, blocks: ParsedBlock[], parts: number): SplitPart[] {
  const totalChars = blocks.reduce((n, b) => n + b.text.length, 0);
  if (totalChars < SPLIT_MIN_CHARS || parts < 2) return [{ title, blocks }];

  const levelCounts = new Map<number, number>();
  for (const block of blocks) {
    const level = headingLevel(block);
    if (level !== null) levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
  }
  const breakLevel =
    [1, 2, 3, 4, 5, 6].find((level) => (levelCounts.get(level) ?? 0) >= 2) ?? null;

  const budget = totalChars / parts;
  const groups: ParsedBlock[][] = [];
  let current: ParsedBlock[] = [];
  let currentChars = 0;
  for (const block of blocks) {
    const boundary =
      current.length > 0 &&
      (breakLevel !== null
        ? headingLevel(block) === breakLevel && currentChars >= budget * 0.6
        : currentChars >= budget);
    if (boundary) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(block);
    currentChars += block.text.length;
  }
  if (current.length > 0) groups.push(current);

  // A tiny trailing part reads better merged into the one before it.
  if (groups.length >= 2) {
    const last = groups[groups.length - 1];
    const lastChars = last.reduce((n, b) => n + b.text.length, 0);
    if (lastChars < budget * 0.25) {
      groups[groups.length - 2].push(...groups.pop()!);
    }
  }
  if (groups.length < 2) return [{ title, blocks }];

  const usedTitles = new Set<string>();
  return groups.map((group, i) => {
    const heading = group.find((b) => b.type === "HEADING")?.text;
    let partTitle =
      heading && clip(heading, 80).toLowerCase() !== title.toLowerCase()
        ? `${title} — ${clip(heading, 80)}`
        : `${title} — Part ${i + 1}`;
    if (usedTitles.has(partTitle)) partTitle = `${title} — Part ${i + 1}`;
    usedTitles.add(partTitle);
    return { title: partTitle, blocks: group };
  });
}

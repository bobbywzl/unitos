import type { BlockType } from "@prisma/client";

export type ParsedBlock = {
  type: BlockType;
  text: string;
  html?: string;
};

export type ParsedDocument = {
  title: string | null;
  blocks: ParsedBlock[];
};

// Progress reported while a URL parses: "extract" when the fetch lands and
// extraction begins, again with a detail line when extraction finishes.
export type UrlParseProgress = (stage: "extract", detail?: string) => void;

// Version of the parse pipeline that produced a document's blocks. Bump when
// parsing improves; documents stamped with an older version re-parse
// automatically — on open, and when their URL is added again.
// 2: structural DOM walk + structure pass. 3: core pass separates article from page chrome.
// 4: marker lists (icon or numbered rows → LIST) and styled dividers → SEPARATOR.
export const PARSER_VERSION = 4;

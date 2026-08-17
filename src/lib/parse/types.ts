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

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

import type { AnyExtension } from "@tiptap/core";
import { AtMenu } from "@/components/docs/insert/at-plugin";
import { Bookmark } from "@/components/docs/insert/bookmark";
import { CHIP_EXTENSIONS } from "@/components/docs/insert/chips";
import { FOOTNOTE_EXTENSIONS } from "@/components/docs/insert/footnotes";
import { MultiRangeDraw } from "@/components/docs/insert/format-match";
import { DocsImage } from "@/components/docs/insert/image";
import { DocsLinks } from "@/components/docs/insert/links";
import { MATH_EXTENSIONS } from "@/components/docs/insert/math";
import { DocsTable } from "@/components/docs/insert/table";
import { TOC_EXTENSIONS } from "@/components/docs/insert/toc";

// The page editor's insert extensions (SPEC.md §29): the "@" menu's
// trigger, the smart chips, bookmarks, footnotes, equations, the table of
// contents, and Google Docs' image and table behavior. extensions.ts spreads
// this list into the editor; the windows they open are the InsertLayer's
// (areas/insert.tsx).
export const insertExtensions: AnyExtension[] = [
  AtMenu,
  ...CHIP_EXTENSIONS,
  Bookmark,
  ...FOOTNOTE_EXTENSIONS,
  ...MATH_EXTENSIONS,
  ...TOC_EXTENSIONS,
  DocsImage,
  DocsTable,
  DocsLinks,
  MultiRangeDraw,
];

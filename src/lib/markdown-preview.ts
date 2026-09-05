import { parseNote, visibleText } from "@/lib/note-markup";

// Markdown as one plain line, for small previews (a collapsed note or
// annotation, a Visual card, an overlay caption) where rendered markdown has
// no room.
//
// The markers come off through the note's own parser, not through a list of
// patterns: a hand-rolled strip only knows the shapes it was written for, so
// one effect came out clean and two left their markers behind — "**_word_**"
// read as "_word_", "~~word~~" as itself. parseNote knows every shape the
// editor writes, at every nesting, so the preview is exactly the text the
// reader sees (lib/note-markup.ts).

const BLOCK_TAG = /\[block [a-zA-Z0-9]+\]/g;
const IMAGE = /!\[([^\]\n]*)\]\([^)\n]*\)/g;
const FENCE = /```[\s\S]*?```/g;

export function markdownPreview(text: string): string {
  const source = text
    // A fenced block is code, not a line to preview.
    .replace(FENCE, " ")
    // The two atoms carry no words of their own: a chip reads as nothing, an
    // image as its alt — a preview line has no room for a picture, and none
    // for a URL.
    .replace(BLOCK_TAG, "")
    .replace(IMAGE, "$1");
  return visibleText(parseNote(source)).replace(/\s+/g, " ").trim();
}

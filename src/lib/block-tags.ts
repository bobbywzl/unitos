// AI text cites document blocks as [block <id>] and notes as [note <id>] —
// the tags the model sees in its context. components/markdown.tsx turns them
// into links that render as chips: ¶ scrolls the reader to the block and
// flashes it, ✎ opens the note.

const BLOCK_TAG = /\[block ([a-zA-Z0-9]+)\]/g;

// Block tags side by side (only spaces or commas between them) cite the
// blocks named together ("both Evidence paragraphs"): one chip with their
// count, which scrolls to the first and flashes each, in place of a row of ¶.
const BLOCK_TAG_RUN = /\[block [a-zA-Z0-9]+\](?:[\s,]*\[block [a-zA-Z0-9]+\])+/g;

const NOTE_TAG = /\[note ([a-zA-Z0-9]+)\]/g;

export const BLOCK_HREF = "#dissect-block-";
export const BLOCKS_HREF = "#dissect-blocks-";
export const NOTE_HREF = "#dissect-note-";

/** The tags of `text` as markdown links: one block, a run of blocks named
    together (its ids, each once, in the order cited), or one note. */
export function linkifyBlockTags(text: string): string {
  return text
    .replace(BLOCK_TAG_RUN, (run) => {
      const ids = [...new Set([...run.matchAll(BLOCK_TAG)].map((m) => m[1]))];
      return ids.length === 1 ? `[¶](${BLOCK_HREF}${ids[0]})` : `[¶${ids.length}](${BLOCKS_HREF}${ids.join(",")})`;
    })
    .replace(BLOCK_TAG, `[¶](${BLOCK_HREF}$1)`)
    .replace(NOTE_TAG, `[✎](${NOTE_HREF}$1)`);
}

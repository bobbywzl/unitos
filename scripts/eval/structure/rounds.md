# Breakwork loop rounds

Model agents: Sonnet, standing in for `STRUCTURE_MODEL` (Claude Sonnet 5). Judges: one agent per two cases. Overall is 1 to 5; the mean is over 8 cases.

| round | change | mean overall | lowest case | kept |
|---|---|---|---|---|
| r0 | ranges answer format, Sonnet 5 at medium, failed turns kept | 3.63 | 2 (named sides) | base |
| r1 | place every content block when the request names kinds of blocks; named sides get one top bucket each with topics inside; a comment goes with its quote; a block on two buckets goes where it serves most, a connection records the other tie; the talking turn names three or four ways; code: the assistant's new connection from a block to its own bucket drops | 4.13 | 4 | yes |
| r2 | pair comments before sorting; follow the document's own index; labels say what a block adds; connection labels name the relation; talking turn recommends one way; sizes only for whole-document sorts; the same topics on both sides | 4.00 | 4 | no: reverted to r1 |

After r2 the prompt is r1's plus one line: a quotation mark inside a JSON string is escaped or written as the document's own (「」). A model agent's Chinese answer broke the parse with a bare quotation mark.

Faults still open after r1, each seen in one or two cases:
- A lecture point or critique still lands apart from the quote it explains in a few places on the long notes.
- The document's own review list is not always followed when it files a passage under a theme.
- Labels on heading lines repeat the heading.
- The talking reply runs past four sentences.

## Your exact request, before and after

"Sort FN's quotes and my commentaries by themes/ major topics and by archetypes", on 206 blocks of course notes:

| round | blocks placed | buckets | answer tokens | overall |
|---|---|---|---|---|
| r0 | 96 of 206 (47%) | 13 | 1015 | 4 |
| r1 | 190 of 206 (92%; the 16 left are the two title lines and the 14 week headings, since a theme runs across weeks) | 14 | 1357 | 4 |

The answer under the old format (one object per block with a label) would be about 10,000 tokens for the same document.

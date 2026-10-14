# Breakwork loop rounds

Model agents: Sonnet, standing in for `STRUCTURE_MODEL` (Claude Sonnet 5). Judges: one agent per two cases. Overall is 1 to 5; the mean is over 8 cases.

From r3 on, every judge also compares the candidate with the current best answer side by side, blind (`run.ts pair`), and a change is kept when it wins more cases than it loses and no case falls under 3. Two cases joined at r3: a keyword request (nz-keyword) and a rework of a structure on the canvas (nz-rework); their baseline is r3base, the r1 prompt.

| round | change | mean overall | lowest case | side by side (wins / losses / ties) | kept |
|---|---|---|---|---|---|
| r0 | ranges answer format, Sonnet 5 at medium, failed turns kept | 3.63 | 2 (named sides) | – | base |
| r1 | place every content block when the request names kinds of blocks; named sides get one top bucket each with topics inside; a comment goes with its quote; a block on two buckets goes where it serves most, a connection records the other tie; the talking turn names three or four ways; code: the assistant's new connection from a block to its own bucket drops | 4.13 | 4 | – | yes |
| r2 | pair comments before sorting; follow the document's own index; labels say what a block adds; connection labels name the relation; talking turn recommends one way; sizes only for whole-document sorts; the same topics on both sides | 4.00 | 4 | – | no: reverted to r1 |
| r3 | a comment goes right after the quote it is about; a block goes in a person's or a type's bucket only when it names or describes that person or type | 4.10 | 3 (rework) | 4 / 5 / 1 | no: the archetype buckets went thin, the comparing critiques left them |
| r4 | the talking turn: at most four sentences, three or four ways that group differently, a recommendation that names the line of the document that shows why, then ask | 4.00 | 3 (rework, untouched by the rule) | the targeted case won (2); the other nine, which the rule does not reach, 2 / 6 / 1 | yes: nz-how now recommends sorting by theme from the exam line [194] in three sentences |

From r5 on, a round re-runs only the cases its change targets, against the current best answer of each case (`.eval/structure/best/`): in r4 the nine cases a talking-turn rule cannot reach still went 2 / 6 / 1, which is the sampling noise of a re-run, not the rule. The last round re-runs every case against r1 to catch a regression.

| round | change | targeted cases (2 samples each) | side by side | kept |
|---|---|---|---|---|
| r5 | a change touches only what it names; "inside every bucket" reaches nested buckets; the reader's own lines (My critique, My take, my thoughts) are one kind; buckets of one kind under different parents name their parent | nz-rework 4, 5; nz-quotes-vs-critiques 4, 4; nz-split-label 4, 4 | 4 / 2 / 0 (rework 2 wins, sides 2 wins, split 2 losses) | yes; the split regression is r6's target |
| r6 | sizes only when the whole document is sorted; a split bucket stays as the parent and keeps the blocks that span the group | nz-split-label 5, 4; nz-rework 3, 4; nz-themes-archetypes 4, 4 | 2 / 3 / 1 (split 1 tie, 1 loss on label wording; rework 1 win, 1 loss: one sample skipped the critiques sub-bucket in Archetypes) | no: reverted; the r6b themes answer is the new best |

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

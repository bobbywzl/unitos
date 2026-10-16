# Breakwork loop rounds

Model agents: Sonnet, standing in for `STRUCTURE_MODEL` (Claude Sonnet 5.5). Judges: one agent per two cases. Overall is 1 to 5; the mean is over 8 cases.

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
| r7 | a connection label names the relation, never the topic of either end; a request to connect one kind to another connects every bucket of the first kind | sp-claims-evidence 4, 3; zh-themes 4, 4 | 1 / 3 / 0 (both claims-evidence samples lost on placement: [34], the slow-wave result, left its claim; one sample put evidence in top buckets apart from the claims) | no: reverted |
| r8 | follow the document's own list that files passages under topics (an exam review list, an index); a connection records any second tie | zh-themes 4, 4; nz-quotes-vs-critiques 4, 4; nz-themes-archetypes 4, 4 | against the best answers 1 / 5 / 0; against fresh control samples of the kept prompt 3 / 3 / 0, margins 5 to 3 (both margin-2 wins are the review lists: 仁 [54] gets [28] and [40], the two sides share the exam list's seven topics) | yes, on margins |

From r8 on, a candidate is paired with a fresh control sample of the kept prompt on the same case (rNc, rNcb), never with the best answers: each best answer won out of several samples, so an equal prompt loses to it. r6 and r7 were judged against the best answers and may have been reverted unfairly. A tie on wins is broken by the sum of margins.

| round | change | targeted cases (2 samples each) | against control | kept |
|---|---|---|---|---|
| r9 | a label says what the block says, never the bucket's title or the block's type; a description says what the blocks say, never which kinds of lines | nz-split-label 4, 4; zh-themes 4, 4 | 1 / 1 / 2, margins 1 to 1 (the labels lost the document's own parallel form, Core drive / Character / Role, which the judge preferred) | no: reverted |
| r10 | a how-to-sort reply never offers the document's own order; before writing the rest bucket, check each of its blocks against the named topics | nz-keyword 4, 3; nz-how 4, 4 | 1 / 3 / 0 (the judge wanted the week option back; one keyword sample left the rest as one flat bucket of 136 blocks) | no: reverted |
| r11 | a block whose main point is one value of the second dimension (an archetype it names and judges) goes in that value's bucket; the reply never cites block numbers | nz-themes-archetypes 4, 4; nz-retry-complaint 4, 3 | 2 / 2 / 0, margins 3 to 2 (both wins on the reader's own request: the archetype buckets take in the later critiques [34], [153], [104], [133]; both losses on how closely the themes follow the exam list) | yes, on margins |

r12, the regression round: every case, the kept prompt (r1 + r4 + r5 + r8 + r11) against r1, blind.

| sample | mean overall | lowest case | against r1 (wins / losses / ties) |
|---|---|---|---|
| r12 | 3.90 | 3 (nz-rework: My take lines left out of the critique buckets; sp-claims-evidence: evidence in top buckets apart from the claims) | 3 / 5 / 2 (nz-themes-archetypes and nz-retry-complaint are one structure, counted twice) |
| r12b | 4.10 | 3 (nz-rework: My take lines left out of the critique buckets again) | 6 / 3 / 1 against a fresh r1 sample (r1b) |

Both samples together: 9 wins, 8 losses, 3 ties against r1. The kept prompt wins every time on the talking turn (nz-how), named sides (nz-quotes-vs-critiques), and the keyword request (nz-keyword), and never loses on the split (nz-split-label). It loses every time on the reader's own request (nz-themes-archetypes), the complaint (nz-retry-complaint), and the Chinese notes (zh-themes), each by margin 1 or 2, and the judges name one cause in all three: a quote run is split, its comment or the objection and reply left in another bucket ([53]-[56], [105]-[107], [130]-[134], [40]-[44]). The rules that move one block by an outside test, the document's own list (r8) and the second dimension (r11), pull single blocks out of runs; rule 4 (keep a block with what it belongs to) does not say it comes first.

Production keeps the r1 rules until a round shows the fix: a block that the list or the second dimension moves takes the lines that comment on it, and rule 4 comes before both. nz-rework misses the My take lines in both samples although r5 names them; that is open too.

| round | change | targeted cases (2 samples each) | against control | kept |
|---|---|---|---|---|
| r13 | rule 4 comes before the document's own list and the second dimension: a quote, the lecture point on it, the reader's comment, an objection and its reply stay in one bucket and move together; "my critiques" takes My take lines too | nz-themes-archetypes 4, 4; nz-retry-complaint 4, 4; zh-themes 4, 4; nz-rework 3, 3 | 5 / 3 / 0, margins 6 to 3 (the reader's request and the Chinese notes won both; the rework took every My take line; the complaint lost both on week headings filed two ways in one answer) | yes |
| r14 | every part heading unsorted alike when the sort runs across parts; "every bucket" of a kind takes the second dimension's buckets too | nz-themes-archetypes 4, 4; nz-retry-complaint 4, 4; nz-rework 4, 4 | 1 / 4 / 1, margins 2 to 5 (the rework scored 4 twice, up from 3, but the losses were on theme choices the rules do not touch) | no: reverted |

r15, the regression round after r13: every case, two samples, against the two r1 samples: 10 / 10 / 0, margins 15 to 13. Every sample wins on nz-how and nz-rework (margin 2 each, every My take line now sorted); every sample over r12 and r15 loses on nz-retry-complaint and zh-themes. The judges name two causes: Chinese connection labels that name no relation («连到仁», «结合») where r1 writes «礼以仁为本»; and the lines that compare the archetypes, which r1 gives a bucket of their own inside Archetypes.

| round | change | targeted cases (2 samples each) | against control | kept |
|---|---|---|---|---|

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
| r16 | a connection label names the relation in the document's terms, never a bare "connects to" or «连到»; lines that compare the second dimension's values get a bucket of their own | zh-themes 4, 4; nz-themes-archetypes 4, 4; nz-retry-complaint 4, 4 | 2 / 3 / 1, margins 3 to 3: zh-themes won both on the labels («孝为仁之本», «礼以仁为本» in place of «解释», «合起来看»); the Nietzsche cases lost on where the Übermensch and the last man go, which neither rule touches | the label rule yes, the comparing bucket no |
| r17 | two ideas the document sets against each other (an ideal and its opposite, two rival theories, a claim and its objection) go in one bucket | nz-themes-archetypes 4, 4; nz-retry-complaint 3, 4; nz-keyword 4, 3 | 4 / 2 / 0, margins 6 to 3 | yes |

r18, the regression round after r17: every case, two samples, against the two r1 samples: 11 / 8 / 1, margins 17 to 10 (r15 was 10 / 10, 15 to 13). nz-rework wins both at margin 3, nz-split-label and nz-retry-complaint win both. nz-themes-archetypes loses both at margin 2: the answer follows the document's own exam list, which files the Übermensch under self-overcoming and the last man under the death of God, and the case's bar asks for an Übermensch bucket of its own. zh-themes loses both at margin 1, on a reply that claims what the structure does not do and on titles with a 论 prefix.

| round | change | targeted cases (2 samples each) | against control | kept |
|---|---|---|---|---|
| r19 | the reply says only what the structure does (counts its buckets, claims no rule it breaks); titles carry no prefix such as "On" or «论» | zh-themes 4, 4; nz-themes-archetypes 4, 4; nz-retry-complaint 4, 3 | 1 / 4 / 1, margins 1 to 7 (the losses are placements the rules do not touch) | no: reverted |

Where the loop stands: the kept prompt is r1 + r4 + r5 + r8 + r11 + r13 + the r16 label rule + r17, and it beats r1 11 / 8 / 1 over two samples of every case (r18). Rounds r14, r16's second rule, and r19 lost on placements their rules do not reach: a single targeted round now sits near the judges' noise, so a further rule needs more samples than two to show.

## Request following and the model (October 16)

The reader reported that the assistant often does not do what was asked. The loop gained hard request-following checks (`follow.ts`: blocks in the bucket named for them, buckets left untouched, nothing placed outside a partial sort, labels only where asked, connections between the named blocks, bucket counts and order, order inside a bucket) and 44 new request shapes: partial sorts, moves, merges, renames, fewer buckets, start over, delete, labels, connections, follow-ups, several changes in one message, everything except a part, references by content, corrections, and a new fixture of team meeting notes. 54 cases in all.

Four stand-in models answered the 39 first cases with the kept prompt, and each was judged blind against Sonnet:

| model | checks passed | blind pairs against Sonnet (wins / losses / ties, margins) | price in / out per million tokens |
|---|---|---|---|
| Haiku 5.5 | 136 / 137 | 8 / 23 / 8, 10 to 34 | $0.10 / $0.50 |
| Sonnet 5.5 | 136 / 137 | – | $2 / $10 |
| Opus 5.5 | 136 / 137 | 11 / 23 / 5, 16 to 31 | $4 / $20 |
| Fable 5.1 | 136 / 137 | 11 / 21 / 7, 14 to 28 | $10 / $50 |

On the 15 harder shapes: Sonnet 55 / 58, Opus 57 / 58, Fable 57 / 58; Sonnet's and Opus's one real miss was the same (除了第五讲, everything but lecture 5, still got a bucket for lecture 5). Sonnet 5.5 stays the model: every model follows the plain requests, Haiku's structures and talking replies lose clearly, and Opus and Fable more often add what nobody asked for (connections, nesting, the action items filed under decisions) at two to five times the price. The stand-ins are agents, not single calls at a set effort; the prompt was tuned on Sonnet stand-ins, which favors Sonnet a little.

| round | change | targeted cases (2 samples each) | against control | kept |
|---|---|---|---|---|
| r20 | a part the reader leaves out (except X, only Y, leave the rest alone) stays unsorted, course lines included | zh-except, rm-except, sp-methods-only, sp-numbers, nz-only-genealogy, tm-actions, zh-my-thoughts | 7 / 7 and 7 / 7 against 7 / 7 and 7 / 7 on the checks | yes: no measured change, and it removes the conflict between "place every block" and the reader's exclusion |
| r21 | a change the reader asks for (a move, a rename, a merge, a split, a delete, labels) draws no new connection unless asked | the 14 narrow-edit cases | 28 / 28 cases fully followed against 19 / 28 for the controls; shorter answers (225 against 260 tokens) | yes |

The live prompt and the branch prompt, blind on all 54 cases (one sample each, before r21): 18 / 18 / 18, margins 27 to 21 for the branch. Both follow 99% of the hard checks in the sandbox. Two production causes the sandbox cannot show were found and fixed: until October 15 Breakwork called claude-sonnet-5, which the deploy's provider answered with Not Found, so every turn failed; and after Apply the canvas did not move to the new buckets, so the reader could see none of what was done.

The model: on the user's word, every assistant that makes a change the reader asked for runs on Claude Sonnet 5.5 (the assistant's edit commands, Merge with AI, and Stitch's answer pass moved from Gemini 3.8 Flash and GLM 5.3).


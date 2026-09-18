import { z } from "zod";

// What a merge took apart, kept so it can be put back (SPEC.md §6): the
// target's text before the merge, and every note the merge consumed with the
// anchors and replies it owned. The merge route writes it as the meta of a
// NOTE_MERGE history event; the undo route reads it back. Validated on the
// way back in, as every stored JSON the app acts on is.

export const NOTE_MERGE_KIND = "NOTE_MERGE";

const mergedNoteSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  order: z.number().int(),
  content: z.string(),
  gist: z.string().nullable(),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED"]),
  derivationType: z.string().nullable(),
  color: z.string().nullable(),
  pinned: z.boolean(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
  conversation: z.unknown().optional(),
  log: z.unknown().optional(),
  /** The Source rows the note owned; the merge moved them to the target. */
  sourceIds: z.array(z.string()),
  /** The Reply rows under the note; the merge moved them to the target. */
  replyIds: z.array(z.string()),
});

export const mergeSnapshotSchema = z.object({
  targetId: z.string(),
  /** The target's text and gist before the merge. */
  targetContent: z.string(),
  targetGist: z.string().nullable(),
  /** The text the merge wrote: the undo runs only while the target still holds it. */
  mergedContent: z.string(),
  notes: z.array(mergedNoteSchema),
  /** Source rows the merge copied onto the target from annotations; the undo deletes them. */
  copiedSourceIds: z.array(z.string()),
  /** Set once the merge was undone: a merge is undone once. */
  undoneAt: z.string().optional(),
});

export type MergeSnapshot = z.infer<typeof mergeSnapshotSchema>;
export type MergedNote = z.infer<typeof mergedNoteSchema>;

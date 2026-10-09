import { z } from "zod";

// A repeat add (SPEC.md §15): the account already has a document with the
// same file or the same source, and the add waits for the reader's word.
// The add routes answer 409 with `duplicate` before anything parses; a Drive
// add, whose file is known only once it is downloaded, ends its stream with
// the same `duplicate` on its last line. Both shapes read here, on the
// server and in the browser.

/** One document the account already has: where it is (null: in no
    project, the Library). */
export const duplicateMatchSchema = z.object({
  id: z.string(),
  title: z.string(),
  notebookId: z.string().nullable(),
  notebookTitle: z.string().nullable(),
});
export type DuplicateMatch = z.infer<typeof duplicateMatchSchema>;

const duplicateBodySchema = z.object({
  error: z.string().optional(),
  duplicate: z.object({ documents: z.array(duplicateMatchSchema).min(1) }),
});

/** The documents a repeat add names, from an answer's body or a stream's
    last line; null when the body is no repeat add. */
export function duplicateOf(body: unknown): DuplicateMatch[] | null {
  const parsed = duplicateBodySchema.safeParse(body);
  return parsed.success ? parsed.data.duplicate.documents : null;
}

/** A repeat add the reader has not confirmed: thrown where the add learns
    of it inside its stream (lib/ingest-response.ts sends it on the last
    line), and in the browser where an answer names one. */
export class DuplicateDocumentError extends Error {
  constructor(
    message: string,
    readonly documents: DuplicateMatch[],
  ) {
    super(message);
    this.name = "DuplicateDocumentError";
  }
}

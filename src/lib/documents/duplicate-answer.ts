// A repeat add (SPEC.md §15): the account already has a document with the
// same file or the same source, and the add waits for the reader's word.
// The add routes answer 409 with `duplicate` before anything parses; a Drive
// add, whose file is known only once it is downloaded, ends its stream with
// the same `duplicate` on its last line. Both shapes read here, on the
// server and in the browser. Read by hand, not with zod: the offline queue
// imports this on every page, and zod is a 65KB download the dashboard
// would otherwise carry for this one check.

/** One document the account already has: where it is (null: in no
    project, the Library). */
export type DuplicateMatch = {
  id: string;
  title: string;
  notebookId: string | null;
  notebookTitle: string | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

function duplicateMatch(v: unknown): DuplicateMatch | null {
  if (!isRecord(v)) return null;
  const { id, title, notebookId, notebookTitle } = v;
  if (typeof id !== "string" || typeof title !== "string") return null;
  if (!isNullableString(notebookId) || !isNullableString(notebookTitle)) return null;
  return { id, title, notebookId, notebookTitle };
}

/** The documents a repeat add names, from an answer's body or a stream's
    last line; null when the body is no repeat add. */
export function duplicateOf(body: unknown): DuplicateMatch[] | null {
  if (!isRecord(body) || !isRecord(body.duplicate) || !Array.isArray(body.duplicate.documents)) return null;
  const documents = body.duplicate.documents.map(duplicateMatch);
  if (documents.length === 0 || documents.some((d) => d === null)) return null;
  return documents as DuplicateMatch[];
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

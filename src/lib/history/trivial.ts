import { db } from "@/lib/db";
import { JEV_MODEL, jevEnabled, systemOne } from "@/lib/jev";

// Small edits in history (SPEC.md §12): a typo fixed, a comma moved, a
// word recased. The History panel folds a run of them into one row, so
// the record reads as what changed, not as every keystroke. What counts
// as small: code decides the clear cases from the edit's before and after
// — nothing but whitespace, punctuation, or case changed; two characters
// or fewer changed — and Jev decides the rest that are short, one choice
// per edit, typo or substantive. A long change is substantive without
// asking. The verdict is written to the edit's meta (`trivial`), so an
// edit is judged once.

const TRIVIAL_MAX_CHANGED = 2; // characters changed: trivial without asking
const ASK_MAX_CHANGED = 120; // characters changed: past this, substantive without asking
const CONTEXT = 60; // characters each side of the change Jev reads
const TRIVIAL_MIN_CONFIDENCE = 0.6;
const MAX_ASKED = 80;

export type HistoryEditRow = {
  id: string;
  kind: string;
  before: string | null;
  after: string | null;
  meta: unknown;
};

function storedVerdict(meta: unknown): boolean | null {
  if (meta && typeof meta === "object" && "trivial" in meta) {
    const v = (meta as { trivial?: unknown }).trivial;
    if (typeof v === "boolean") return v;
  }
  return null;
}

/** The changed stretch of an edit: the text between the common prefix and
    the common suffix, with CONTEXT characters each side. */
function changed(before: string, after: string): { before: string; after: string; size: number } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  const from = Math.max(0, start - CONTEXT);
  return {
    before: before.slice(from, Math.min(before.length, endB + CONTEXT)),
    after: after.slice(from, Math.min(after.length, endA + CONTEXT)),
    size: Math.max(endB - start, endA - start),
  };
}

const fold = (text: string) => text.replace(/[\s\p{P}]+/gu, "").toLowerCase();

/** Trivial or not, by code alone; null when only a reading can tell. */
function decideByCode(row: HistoryEditRow): boolean | null {
  if (row.kind === "STYLE") return true;
  if (row.kind !== "TEXT_EDIT") return false;
  if (row.before === null || row.after === null) return false;
  if (fold(row.before) === fold(row.after)) return true;
  const size = changed(row.before, row.after).size;
  if (size <= TRIVIAL_MAX_CHANGED) return true;
  if (size > ASK_MAX_CHANGED) return false;
  return null;
}

/** Which edits are trivial: the stored verdicts, then code, then Jev for
    the rest, the new verdicts written back. Every id answers. */
export async function trivialEdits(rows: HistoryEditRow[]): Promise<Map<string, boolean>> {
  const verdicts = new Map<string, boolean>();
  const ask: { row: HistoryEditRow; change: { before: string; after: string } }[] = [];
  for (const row of rows) {
    const stored = storedVerdict(row.meta);
    if (stored !== null) {
      verdicts.set(row.id, stored);
      continue;
    }
    const byCode = decideByCode(row);
    if (byCode !== null) {
      verdicts.set(row.id, byCode);
      continue;
    }
    ask.push({ row, change: changed(row.before ?? "", row.after ?? "") });
  }
  const asked = ask.slice(0, MAX_ASKED);
  for (const { row } of ask.slice(MAX_ASKED)) verdicts.set(row.id, false);
  if (asked.length === 0 || !jevEnabled()) {
    for (const { row } of asked) verdicts.set(row.id, false);
    return verdicts;
  }
  const result = await systemOne({
    state: { edits: asked.map((a, n) => ({ n, before: a.change.before, after: a.change.after })) },
    questions: Object.fromEntries(
      asked.map((_, n) => [
        `edit_${n}`,
        {
          type: "choice" as const,
          instructions: `What edit ${n} changed, reading its before and its after.`,
          criteria: {
            typo: "Spelling, punctuation, spacing, casing, or a word's form; the meaning is the same.",
            substantive: "A word, a number, a name, a claim, or a sentence changed, added, or removed; the meaning is different.",
          },
        },
      ]),
    ),
    usage: { userId: null, feature: "history", model: JEV_MODEL },
    label: "HISTORY",
  });
  const writes: Promise<unknown>[] = [];
  asked.forEach(({ row }, n) => {
    const a = result.ok ? result.answers[`edit_${n}`] : undefined;
    const trivial = a?.type === "choice" && a.choice === "typo" && a.confidence >= TRIVIAL_MIN_CONFIDENCE;
    verdicts.set(row.id, trivial);
    if (!result.ok) return;
    const meta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? (row.meta as Record<string, unknown>) : {};
    writes.push(db.blockEdit.update({ where: { id: row.id }, data: { meta: { ...meta, trivial } as object } }).catch(() => {}));
  });
  if (!result.ok) console.warn("[history] jev failed:", result.error);
  await Promise.all(writes);
  return verdicts;
}

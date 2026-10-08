import type { TFunc } from "@/lib/i18n/dictionaries";
import { modelErrorMessage } from "@/lib/derive/json-call";

// One failure line for the reader (SPEC.md §7): a model call that failed
// reads as the assistant's own plain line, never the provider's or the
// server's raw text, which goes to the log. A reason worded for the reader
// (the answer ran out of room, the answer could not be read) keeps its words.

/** True when the reason is one of the lines worded for the reader. */
export function wordedReason(t: TFunc, reason: string): boolean {
  return reason === t("api.outputBudgetSpent") || reason === t("api.answerUnreadable");
}

/** The line the reader sees for a failed model call; the raw text goes to the log. */
export function failureLine(t: TFunc, failure: unknown, label: string): string {
  const reason = typeof failure === "string" ? failure : modelErrorMessage(failure);
  if (wordedReason(t, reason)) return reason;
  console.error(`[${label}] failed:`, reason);
  return t("assistant.failedServer");
}

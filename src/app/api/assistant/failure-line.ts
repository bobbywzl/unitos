import type { TFunc } from "@/lib/i18n/dictionaries";
import { modelErrorMessage } from "@/lib/derive/json-call";

// One failure line for the reader (SPEC.md §7): a model call that failed
// reads as the assistant's own plain line, never the provider's or the
// server's raw text, which goes to the log. A reason worded for the reader
// (the answer ran out of room, the model declined) keeps its words; an
// answer that came back in a form Unitos could not read is a failure like
// any other: the plain line, the reason to the log.

/** True when the reason is one of the lines worded for the reader. */
export function wordedReason(t: TFunc, reason: string): boolean {
  return reason === t("api.outputBudgetSpent") || reason === t("api.modelRefused") || reason === t("api.providerBalance");
}

// A provider that refused the call for want of balance: Moonshot answers
// exceeded_current_quota_error at a balance of zero or less, and an
// OpenAI-compatible provider says insufficient balance or quota, or HTTP
// 402. The reader is told so in plain words (the answer is not coming
// back on a retry), and the log carries the raw text.
const BALANCE_RX = /exceeded_current_quota|insufficient[\s_-]*(?:balance|funds|credits?|quota)|balance (?:is )?(?:insufficient|not enough)|in arrears|out of (?:balance|credit)|HTTP 402\b/i;

/** True when the provider refused the call for want of balance. */
export function balanceFailure(reason: string): boolean {
  return BALANCE_RX.test(reason);
}

/** The line the reader sees for a failed model call; the raw text goes to the log. */
export function failureLine(t: TFunc, failure: unknown, label: string): string {
  const reason = typeof failure === "string" ? failure : modelErrorMessage(failure);
  if (wordedReason(t, reason)) return reason;
  console.error(`[${label}] failed:`, reason);
  return balanceFailure(reason) ? t("api.providerBalance") : t("assistant.failedServer");
}

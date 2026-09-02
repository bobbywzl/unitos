import type { TFunc } from "@/lib/i18n/dictionaries";
import { FetchPageError } from "@/lib/parse/fetch-page";

// Why an add failed, in plain words: what went wrong and what to do next. The
// ingest, upload review, and re-parse routes send this instead of the raw
// error, so the reader never sees a bare "Could not ingest this URL". An
// error nothing here recognizes keeps its own text after a plain lead.
export function describeIngestError(
  err: unknown,
  t: TFunc,
  kind: "url" | "pdf" | "reparse",
): string {
  if (err instanceof FetchPageError) return describeFetchError(err, t);
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  const text = `${name} ${message}`.toLowerCase();
  if (message === "Could not extract readable content") return t("api.unreadableContent");
  if (/passwordexception|password/.test(text)) return t("api.pdfEncrypted");
  if (/invalidpdfexception|invalid pdf|formaterror|missingpdfexception|xref|not a pdf/.test(text)) {
    return t("api.pdfDamaged");
  }
  if (/overloaded|rate.?limit|too many requests|\b529\b/.test(text)) return t("api.modelBusy");
  if (/invalid x-api-key|authentication_error|api key/.test(text)) return t("api.modelKeyInvalid");
  if (/timed out|timeouterror|aborterror/.test(text)) return t("api.ingestTimedOut");
  const lead =
    kind === "url"
      ? "api.urlIngestFailedReason"
      : kind === "pdf"
        ? "api.pdfParseFailedReason"
        : "api.reparseFailedReason";
  return t(lead, { reason: message });
}

function describeFetchError(err: FetchPageError, t: TFunc): string {
  const host = err.host;
  const status = err.status ?? 0;
  switch (err.failure) {
    case "blocked":
      return err.status === null
        ? t("api.fetchChallenge", { host })
        : t("api.fetchBlocked", { host, status });
    case "notFound":
      return t("api.fetchNotFound", { host, status });
    case "rateLimited":
      return t("api.fetchRateLimited", { host });
    case "serverError":
      return t("api.fetchServerError", { host, status });
    case "timeout":
      return t("api.fetchTimeout", { host });
    case "unreachable":
      return t("api.fetchUnreachable", { host });
  }
}

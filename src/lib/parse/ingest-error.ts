import type { TFunc } from "@/lib/i18n/dictionaries";
import { FetchPageError } from "@/lib/parse/fetch-page";
import { PdfPagesError } from "@/lib/pdf-pages";

// Why an add failed, in plain words: what went wrong and what to do next. The
// ingest, upload review, and re-parse routes send this instead of the raw
// error, so the reader never sees a bare "Could not ingest this URL". An
// error nothing here recognizes keeps its own text after a plain lead.
/** An add that failed, with its words and, when the site turned the add
    away (a bot wall, a human check, a consent, sign-in, or subscription
    page), the code "blocked": the dialog then offers the ways in
    (SPEC.md §15). The stream's last line carries the code. */
export class IngestFailure extends Error {
  constructor(
    message: string,
    readonly code: "blocked" | null = null,
  ) {
    super(message);
    this.name = "IngestFailure";
  }
}

export function ingestFailure(err: unknown, t: TFunc, kind: "url" | "pdf" | "file" | "reparse"): IngestFailure {
  const blocked = err instanceof FetchPageError && (err.failure === "blocked" || err.failure === "wall");
  return new IngestFailure(describeIngestError(err, t, kind), blocked ? "blocked" : null);
}

export function describeIngestError(
  err: unknown,
  t: TFunc,
  kind: "url" | "pdf" | "file" | "reparse",
): string {
  if (err instanceof FetchPageError) return describeFetchError(err, t);
  if (err instanceof PdfPagesError) return t("api.pdfPagesPast", { n: err.pageCount });
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
  // A Word file, slides, sheets, or a Markdown file is "this file", never
  // "this PDF".
  const lead =
    kind === "url"
      ? "api.urlIngestFailedReason"
      : kind === "pdf"
        ? "api.pdfParseFailedReason"
        : kind === "file"
          ? "api.fileParseFailedReason"
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
    case "wall":
      return t("api.fetchWall", { host });
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

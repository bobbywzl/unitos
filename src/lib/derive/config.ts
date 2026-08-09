import type { DerivationType } from "@prisma/client";

// Model per derivation type (SPEC.md §2). One place to change.
export const DERIVATION_MODEL: Record<DerivationType, string> = {
  EXPLAIN: "claude-sonnet-4-6",
  SIMPLIFY: "claude-sonnet-4-6",
  SALIENCE: "claude-sonnet-4-6",
  EXTRACT: "claude-sonnet-4-6",
  SYNTHESIS: "claude-sonnet-4-6",
};

export const MAX_OUTPUT_TOKENS: Record<DerivationType, number> = {
  EXPLAIN: 1024,
  SIMPLIFY: 1024,
  SALIENCE: 4096,
  EXTRACT: 2048,
  SYNTHESIS: 8192,
};

export const ANNOTATIONS_SECTION_TITLE = "Annotations";

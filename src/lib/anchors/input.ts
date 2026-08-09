import { z } from "zod";

// Anchor payload captured in the reader (SPEC.md §5): position + quote selectors.
export const sourceInputSchema = z.object({
  documentId: z.string().min(1),
  blockId: z.string().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  quotedText: z.string().min(1).max(10_000),
  prefix: z.string().max(64),
  suffix: z.string().max(64),
});

export type SourceInput = z.infer<typeof sourceInputSchema>;

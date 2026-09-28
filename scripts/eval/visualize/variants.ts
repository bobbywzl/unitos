// The variants of the Visualize loop: one variant is one way to run the tool
// — the draw prompt, the check prompt, and what the check sees. `base` is
// production as it stands (lib/prompts/visualize.ts, visualize-check.ts);
// a candidate lives here until it wins a round, then moves into src/.
import type { Lang } from "@/lib/i18n/config";
import { visualizePrompt } from "@/lib/prompts/visualize";
import { visualizeCheckPrompt } from "@/lib/prompts/visualize-check";
import type { PromptCtx } from "@/lib/prompts/types";

export type CheckCtx = {
  lang: Lang;
  passage: string;
  kind: "diagram" | "simulation" | "picture" | "animation";
  caption: string;
  spec: string | null;
  svg: string | null;
  // The mechanical findings on the rendered picture (lint), for a variant
  // whose check reads them.
  findings: string[];
};

export type Variant = {
  id: string;
  // What the variant changes against base, in one line.
  note: string;
  draw: (ctx: PromptCtx) => string;
  // null: no check pass.
  check: ((ctx: CheckCtx) => string) | null;
  // What the check sees besides the prompt: the SVG source (production), the
  // picture as rendered at the card's width, or both.
  checkSees: "svg" | "png" | "both";
};

const base: Variant = {
  id: "base",
  note: "Production as it stands.",
  draw: visualizePrompt,
  check: (c) =>
    visualizeCheckPrompt({ lang: c.lang, passage: c.passage, kind: c.kind, caption: c.caption, spec: c.spec, svg: c.svg }),
  checkSees: "svg",
};

export const VARIANTS: Record<string, Variant> = { base };

export function variantOf(id: string): Variant {
  const v = VARIANTS[id];
  if (!v) throw new Error(`unknown variant ${id}; known: ${Object.keys(VARIANTS).join(", ")}`);
  return v;
}

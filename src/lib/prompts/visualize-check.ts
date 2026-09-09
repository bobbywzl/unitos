import type { Lang } from "@/lib/i18n/config";
import { languageName } from "@/lib/prompts/types";

// The VISUALIZE check (SPEC.md §20, Unitos Ultra): the model reads back the
// picture as the reader will see it — the SVG the server laid out from its
// nodes and edges, or its own SVG with every element the rules do not allow
// removed — and keeps it, replaces it, or withdraws it. It is the one pass
// that sees the finished picture: the pass that drew it never does. Runs on
// VISUALIZE_MODEL at VISUALIZE_EFFORT, after the draw (lib/derive/config.ts).
export function visualizeCheckPrompt(ctx: {
  lang: Lang;
  passage: string;
  kind: "diagram" | "simulation" | "picture" | "animation";
  caption: string;
  // What the server drew from: a diagram's nodes and edges, a simulation's
  // law and conditions. The picture alone does not give them back. A picture
  // or an animation has none — its SVG is what it gave.
  spec: string | null;
  // The finished SVG. Null for a simulation: its frames are the server's,
  // computed from the spec, so the spec is what there is to check.
  svg: string | null;
}): string {
  const lang = languageName(ctx.lang);
  return [
    "This is the picture you drew, as the reader will see it.",
    ctx.kind === "diagram"
      ? "You gave nodes and edges; this is the layout the server drew from them. The boxes, the lines, the ranks, and the label positions are what the reader gets."
      : ctx.kind === "simulation"
        ? "You gave a law and its conditions; the server integrated the equation and drew the frames, so the motion is the equation's own. What to check is the spec: the law, the domain, the state at t = 0, the boundary, the coefficient, the duration, the labels — whether they are the passage's, and whether the motion they produce is the passage's point."
        : "This is your own SVG after the reduction. Every element the rules do not allow was removed, so anything you drew that is missing here is gone from the picture, and what is left is the whole of it.",
    "",
    "The passage it is for:",
    ctx.passage,
    "",
    `Caption: ${ctx.caption}`,
    ...(ctx.spec
      ? ["", ctx.kind === "simulation" ? "The law and conditions you gave:" : "The nodes and edges you gave:", ctx.spec]
      : []),
    ...(ctx.svg ? ["", "The picture:", ctx.svg] : []),
    "",
    "The whole document is above. Read the picture as a reader who has not seen the passage. Answer all five for yourself, in order:",
    "1. Does it deliver the passage's core idea as it sits in the article — what the passage adds to what the article set up — and not a different point? When the passage answers, extends, or replaces something stated elsewhere in the article, does the picture show both, with the passage's own part standing out?",
    "2. Does every part of it map to something the passage, its context, or the article elsewhere states? When it is an analogy: does every part map, and does it add nothing the passage contradicts?",
    "3. Is anything missing — a shape that is referenced but not there, an animation with nothing left to animate, a labelled thing that was drawn and is now gone?",
    "4. Is it legible in a card 320 px wide: nothing overlapping, nothing outside the viewBox, no text under 14 px, no line of text over 36 characters?",
    "5. Is the caption the picture's point in one sentence, and does it name the analogy when the picture is one?",
    "",
    "Then answer:",
    "- All five hold: keep it. keep true, visual null.",
    "- One fails and you can fix it: keep false and give the corrected visual whole — every node and edge, or the whole SVG. It replaces the picture, so a patch is not enough. The same rules as before hold for it.",
    "- One fails and you cannot fix it: keep false, visual null. The run declines and the reader is told why. A picture that misleads is worse than no picture.",
    "Do not replace a picture that holds. A different picture that is no better is a worse answer than the one that stands.",
    "",
    `Write reason, caption, node labels, node details, edge labels, and SVG text in ${lang}.`,
    "",
    "Return ONLY this JSON, no other text:",
    "{",
    '  "keep": true | false,',
    '  "reason": "<one sentence: what holds, or what failed and what you did about it>",',
    '  "visual": null | {',
    '    "kind": "diagram" | "simulation" | "picture" | "animation",',
    '    "caption": "<one sentence>",',
    '    "diagram": { "direction": "right" | "down", "nodes": [{ "id": "n1", "label": "…", "detail": "…", "role": "passage" | "article" }], "edges": [{ "from": "n1", "to": "n2", "label": "…" }] },',
    '    "simulation": { "law": "heat" | "wave" | "advection" | "schrodinger" | "ode", "equation": "…", "x0": 0, "x1": 1, "initial": "…", "velocity": "…", "potential": "…", "momentum": 0, "boundary": "fixed" | "insulated" | "periodic", "coefficient": 1, "variables": [{ "name": "…", "rate": "…", "start": 0 }], "duration": 1, "xLabel": "…", "uLabel": "…" },',
    '    "svg": "<svg …>…</svg>"',
    "  }",
    "}",
    "diagram is present only for kind diagram; simulation only for kind simulation; svg only for kind picture or animation.",
  ].join("\n");
}

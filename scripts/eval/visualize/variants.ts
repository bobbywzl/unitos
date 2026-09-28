// The variants of the Visualize loop: one variant is one way to run the tool
// — the draw prompt, the check prompt, and what the check sees. `base` is
// production as it stands (lib/prompts/visualize.ts, visualize-check.ts);
// a candidate lives here until it wins a round, then moves into src/.
import type { Lang } from "@/lib/i18n/config";
import { visualizePrompt } from "@/lib/prompts/visualize";
import { visualizeCheckPrompt } from "@/lib/prompts/visualize-check";
import { languageName, type PromptCtx } from "@/lib/prompts/types";

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
  // The picture moves: the check gets four moments of its loop as well.
  moving: boolean;
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

// The check that looks (candidate): it sees the picture as the reader does —
// drawn in a browser at the card's width, and four moments of a picture that
// moves — with the faults the browser measured, instead of reading the
// server's SVG. It keeps the model's own SVG source for a picture or an
// animation, so a fix can start from it; a diagram or a simulation is the
// server's drawing, and its spec is what the model can change.
function visionCheckPrompt(c: CheckCtx): string {
  const lang = languageName(c.lang);
  const serverDrawn = c.kind === "diagram" || c.kind === "simulation";
  return [
    "This is the picture you drew, as the reader will see it: the image attached below is the picture drawn in a browser at the card's width, 320 px, at twice the pixels.",
    c.moving ? "It moves: the second image shows four moments of its 8-second loop, at 0, 2, 4, and 6 seconds." : "",
    c.kind === "diagram"
      ? "You gave nodes and edges; the server laid them out and drew the boxes, the lines, and the labels at its own sizes. What you can change is the spec: the nodes, their words, the edges, the direction. A diagram with more than three boxes side by side in one rank draws its text too small for the card; merge or drop nodes to fix it."
      : c.kind === "simulation"
        ? "You gave a law and its conditions; the server integrated the equation and drew the frames, so the motion is the equation's own. What you can change is the spec: the law, the domain, the state at t = 0, the boundary, the coefficient, the duration, the labels."
        : "This is your own SVG after the reduction: every element the rules do not allow was removed, so anything missing from the image is gone from the picture. Its source follows the image, to start a fix from.",
    "",
    "The passage it is for:",
    c.passage,
    "",
    `Caption: ${c.caption}`,
    ...(c.spec ? ["", c.kind === "simulation" ? "The law and conditions you gave:" : "The nodes and edges you gave:", c.spec] : []),
    ...(c.svg && !serverDrawn ? ["", "The SVG source:", c.svg] : []),
    "",
    "What the browser measured on the picture:",
    ...(c.findings.length ? c.findings.map((f) => `- ${f}`) : ["- Nothing: no text overlaps text, nothing is outside the frame, no text is under 9 px at the card's width, no line runs past 36 characters, every color is the palette's."]),
    "",
    "The whole document is above. Look at the image as a reader who has not seen the passage, for five seconds. Then answer all five for yourself, in order:",
    "1. What does the picture say at a glance? Is that the passage's core idea as it sits in the article — what the passage adds to what the article set up — and not a different point? When the passage answers, extends, or replaces something stated elsewhere, does the picture show both, with the passage's own part standing out?",
    "2. Does every part of it map to something the passage, its context, or the article elsewhere states — every label, every number, every arrow? When it is an analogy: does every part map, and does it add nothing the passage contradicts?",
    "3. Is anything missing or broken in the image — a shape that is referenced but not there, an arrow that points nowhere, a label cut off, a motion that shows nothing happening?",
    "4. Is it legible in the card: can every word be read in the image as it is, with nothing overlapping and nothing crowded? The measured faults above are facts; fix every one you can.",
    "5. Is the caption the picture's point in one sentence, and does it name the analogy when the picture is one?",
    "",
    "Then answer:",
    "- All five hold: keep it. keep true, visual null.",
    "- One fails and you can fix it: keep false and give the corrected visual whole — every node and edge, the whole spec, or the whole SVG. It replaces the picture, so a patch is not enough. The same rules as before hold for it.",
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
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

const vcheck: Variant = {
  id: "vcheck",
  note: "The check sees the picture drawn at the card's width (and four moments of one that moves) with the browser's measured faults, instead of the server's SVG; a picture's own SVG source stays.",
  draw: visualizePrompt,
  check: visionCheckPrompt,
  checkSees: "both",
};

// The draw prompt's candidate rules (round 2): each names a fault class the
// round 0 judges found in two cases or more. Applied as edits to the
// production prompt, so everything else stays word for word; an edit that
// no longer finds its line throws, so the candidate never drifts silently.
const V2_EDITS: [string, string][] = [
  // Declines ran 65–90 words in a 320 px card and named block ids.
  [
    "and write in reason why a picture would not carry the passage's core idea — name what you tried, the literal picture and the analogies, so the reader knows the passage was worked on and not skipped.",
    "and write in reason why a picture would not carry the passage's core idea, in two short sentences and 40 words at most: what the passage is, and the pictures you tried — the literal one and the analogies, named in a few words each — and why they fail. The reader reads it in a small card: plain words about the passage, never \"I\", no block ids.",
  ],
  // Simulations: a clipped title, conditions crammed into it, no mark of
  // the numbers the passage names, no unit on the clock, raw variable names.
  [
    "  equation: the law as the passage writes it, at most 80 characters, shown above the plot.",
    "  equation: the law alone, as the passage writes it, at most 60 characters, shown above the plot. The conditions and the numbers go in the caption and the levels, not here.",
  ],
  [
    "  variables: for ode, each with name, rate (a formula in t and every variable's name), and start.",
    "  variables: for ode, each with name, rate (a formula in t and every variable's name), start, and label: what the legend calls it, in the passage's words, 3 words at most (susceptible, infected).",
  ],
  [
    "  xLabel, uLabel: what x and u are in the passage's words — position along the rod, temperature.",
    "  xLabel, uLabel: what x and u are in the passage's words — position along the rod, temperature.\n  tUnit: the unit of the law's time in the passage's words — s, min, days — shown on the clock.\n  levels: up to 3 values the passage names that the state is measured against — a threshold, the temperature the rod settles at, a target — each { value, label } with a label of 5 words at most, drawn as a dashed line across the plot with its label. A reference line is a level, never a variable with rate 0.",
  ],
  // Diagrams: a rank of four boxes shrinks every word in a 320 px card; a
  // detail that restates the label is crowding; a self-loop was avoided.
  [
    "3 to 12 nodes. A node label is at most 6 words; its detail, when it helps, at most 12 words.",
    "3 to 12 nodes, and at most three side by side in one rank: the card is 320 px wide, and a wider rank shrinks every word — merge or drop nodes rather than widen. A node label is at most 6 words; its detail at most 12 words, and only when it carries a number or a fact the label lacks. An edge may run from a node to itself — a state that repeats — and draws as a loop.",
  ],
  // Pictures: labels ran past their space; prose competed with the marks;
  // labels floated away from what they name; bars and curves not to scale.
  // Text at 14 in a 480-wide picture draws at 9 px in the card: small.
  [
    "text font-size 14 to 20,",
    "text font-size 16 to 22 (16 draws at 10.7 px in the card),",
  ],
  [
    "- First element: a white rect over the whole viewBox.",
    "- First element: a rect filled #ffffff over the whole viewBox.",
  ],
  [
    "at most 36 characters per text line, 16 px margin from the edges, nothing overlapping.",
    "at most 36 characters per text line, 16 px margin from the edges, nothing overlapping. A line of text is about 0.6 × its font-size wide per Latin character (0.65 bold) and 1 × per Chinese character: work out each label's width and keep it inside its box and 16 px inside the viewBox.",
  ],
  [
    "- Label every element the passage names. Labels use the passage's own words; what comes from elsewhere in the article uses the article's words.",
    "- Label every element the passage names, on the element or beside it — joined by a short leader line when the label cannot touch it. Labels use the passage's own words; what comes from elsewhere in the article uses the article's words.\n- Words are labels and numbers, never sentences: at most 6 words per label and about 30 words in the whole picture. A claim the picture makes is a mark — an arrow, a bracket, a highlighted region — with a few words on it; the caption carries the sentence. No legend where a label on the thing fits.\n- One focal point: the passage's own part is the largest and strongest thing in the picture.\n- When a length, a height, an area, or a position stands for a number, compute it from the number on one scale for the whole picture, and draw only the values the text gives: a curve between two stated points is a guess unless the text states its shape.",
  ],
  // Animations: a moving token hid under shapes drawn after it.
  [
    "Every step of the loop is a step the passage states.",
    "Every step of the loop is a step the passage states. Draw each moving element after the shapes it passes over, so nothing hides it at any moment.",
  ],
  // The output contract shows the new simulation fields.
  [
    '"variables": [{ "name": "…", "rate": "…", "start": 0 }], "duration": 1, "xLabel": "…", "uLabel": "…" },',
    '"variables": [{ "name": "…", "rate": "…", "start": 0, "label": "…" }], "duration": 1, "xLabel": "…", "uLabel": "…", "tUnit": "…", "levels": [{ "value": 0, "label": "…" }] },',
  ],
  [
    '    "reason": "<one or two sentences: why this picture is, or why no picture is, the best way to show this passage>"',
    '    "reason": "<one or two short sentences, 40 words at most: why this picture is, or why no picture is, the best way to show this passage>"',
  ],
];

function edited(prompt: string, edits: [string, string][]): string {
  let out = prompt;
  for (const [from, to] of edits) {
    if (!out.includes(from)) throw new Error(`candidate edit no longer applies: ${from.slice(0, 60)}`);
    out = out.replace(from, to);
  }
  return out;
}

const v2: Variant = {
  id: "v2",
  note: "Draw prompt: short declines, the law alone as the title with levels, units, and labels for a simulation, at most three boxes side by side and self-loops in a diagram, and for a picture: text width worked out, labels on their things, marks not prose, one focal point, one scale.",
  draw: (ctx) => edited(visualizePrompt(ctx), V2_EDITS),
  check: base.check,
  checkSees: "svg",
};

export const VARIANTS: Record<string, Variant> = { base, vcheck, v2 };

export function variantOf(id: string): Variant {
  const v = VARIANTS[id];
  if (!v) throw new Error(`unknown variant ${id}; known: ${Object.keys(VARIANTS).join(", ")}`);
  return v;
}

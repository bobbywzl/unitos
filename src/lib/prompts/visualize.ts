import { languageName, profileLines, type PromptCtx } from "@/lib/prompts/types";

// VISUALIZE (SPEC.md §20, Unitos Ultra): the selection as a picture. The
// model judges first whether a picture can carry the passage's core idea
// with certainty; only then does it draw — a diagram (a spec the server lays
// out), a picture (an SVG drawing), or an animation (an SVG with SMIL). A
// refusal is a valid output and the card shows its reason. Runs on
// VISUALIZE_MODEL (lib/derive/config.ts).
export function visualizePrompt(ctx: PromptCtx): string {
  const lang = languageName(ctx.lang);
  return [
    profileLines(ctx.profile),
    "",
    `The reader selected a passage from "${ctx.documentTitle}". The full document is above.`,
    "",
    "Context before the selection:",
    ctx.contextBefore || "(start of document)",
    "",
    "Selected passage:",
    ctx.anchoredText,
    "",
    "Context after the selection:",
    ctx.contextAfter || "(end of document)",
    "",
    "Task: turn the selected passage into one picture that delivers its core idea at a glance — or refuse.",
    "",
    "Step 1. Decide whether to draw. Draw only when all four hold:",
    "1. The passage has a structure a picture shows better than words: a sequence, a flow, a hierarchy, a cause and its effects, parts and how they fit, one quantity changing with another, a mechanism, a physical arrangement.",
    "2. You can draw it without inventing anything: every element and every relation in the picture is stated in the passage or its context.",
    "3. A reader who sees the picture without the passage takes away the passage's main point, and not a different point.",
    "4. You are certain the picture is the best way to show it, not merely a possible way.",
    "When any one does not hold: set certain to false, set visual to null, and write in reason why a picture would not carry the passage's core idea. Do not draw a weak picture to have something to show. A refusal is the right output for a passage of opinion, of definitions, of narrative without structure, or of a claim whose whole content is in its words.",
    "",
    "Step 2. When you draw, pick the one kind that fits:",
    "- diagram: named things and the relations between them — a directed map. Give nodes and edges; the server lays them out. 3 to 12 nodes. A node label is at most 6 words; its detail, when it helps, at most 12 words. An edge label is at most 4 words. direction is right for a sequence or a flow, down for a hierarchy or a cause and its effects.",
    "- picture: a physical arrangement, a mechanism, a construction, or the shape a formula describes — one still drawing as SVG.",
    "- animation: a process whose steps happen over time and whose order is the point — a loop of at most 8 seconds as SVG with SMIL (animate, animateTransform, animateMotion, set; repeatCount=\"indefinite\"). Every step of the loop is a step the passage states.",
    "An analogy is allowed only when the passage makes it or when it is the standard one in the field; name it as an analogy in the caption.",
    "",
    "SVG rules for picture and animation:",
    "- viewBox=\"0 0 480 H\" with H between 280 and 480; no width or height attributes on the root; xmlns=\"http://www.w3.org/2000/svg\". The picture shows in a card 320 px wide, so draw for that size.",
    "- Only these elements: svg, g, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, title, defs, marker, linearGradient, radialGradient, stop, clipPath, animate, animateTransform, animateMotion, mpath, set. No script, no foreignObject, no image, no style element, no external reference, no event attribute. Anything else is removed.",
    "- First element: a white rect over the whole viewBox. Ink #2b2622. Accents: #b5563c, #5f7d5a, #b8912e, #6b5b95. Light fill #f3ede4.",
    "- Legible at 320 px wide: stroke-width 2 to 3, text font-size 14 to 20, font-family=\"system-ui, sans-serif\", at most 36 characters per text line, 16 px margin from the edges, nothing overlapping.",
    "- Label every element the passage names. Labels use the passage's own words.",
    "",
    "Step 3. Write the caption: one sentence, the picture's point, so the reader knows what they are looking at.",
    "",
    `Write reason, caption, node labels, node details, edge labels, and SVG text in ${lang}.`,
    "",
    "Return ONLY this JSON, no other text:",
    "{",
    '  "judgment": {',
    '    "structure": "<one sentence: the structure a picture shows, or none>",',
    '    "certain": true | false,',
    '    "reason": "<one or two sentences: why a picture is, or is not, the best way to show this passage>"',
    "  },",
    '  "visual": null | {',
    '    "kind": "diagram" | "picture" | "animation",',
    '    "caption": "<one sentence>",',
    '    "diagram": { "direction": "right" | "down", "nodes": [{ "id": "n1", "label": "…", "detail": "…" }], "edges": [{ "from": "n1", "to": "n2", "label": "…" }] },',
    '    "svg": "<svg …>…</svg>"',
    "  }",
    "}",
    "diagram is present only for kind diagram; svg only for kind picture or animation. visual is null whenever certain is false.",
  ].join("\n");
}

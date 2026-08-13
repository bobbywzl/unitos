import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// VISUALIZE: SVG visualization of the selection, rendered at the selection and
// listed in the Annotations tab. The focus is what the reader asked it to show.
export function visualizePrompt(ctx: PromptCtx & { focus?: string }): string {
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
    "Focus — what the reader wants the visualization to show:",
    ctx.focus?.trim() || "(none given — pick the view that best explains the selected passage)",
    "",
    "Design one SVG visualization of the selected passage for this reader.",
    "1. Show the structure the passage states or implies: flow, sequence, hierarchy, comparison, quantity, cycle, or relation. Pick the form that fits. Do not force a chart onto prose.",
    "2. Answer the focus when one is given.",
    "3. Use only facts from the document. Use the full document to resolve names, numbers, and references the passage depends on. Never invent data.",
    "4. Label every element with words from the document. Keep labels short.",
    "",
    "SVG rules:",
    '1. One <svg> root with viewBox="0 0 800 H", H between 320 and 800. No width or height attributes.',
    "2. Use only: svg, g, defs, marker, title, desc, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, linearGradient, radialGradient, stop.",
    "3. Style with presentation attributes only. No style attribute, no <style>, no class, no href, no image, no script.",
    '4. The page has a light and a dark theme. Text and lines use fill="currentColor" or stroke="currentColor". Never hard-code black or white.',
    '5. Accents: #c67139 (clay), #7a8a5e (sage), #d9a54a (gold), #a78bfa (plum). Fill shapes with an accent at fill-opacity="0.25" so currentColor text stays legible on top.',
    '6. Text: font-family="inherit", font-size 15 or larger. Keep every label inside the viewBox. Split long labels across <tspan> lines.',
    "7. Transparent background. No rect behind the whole viewBox.",
    "",
    'Return ONLY JSON: {"title": "<2 to 6 words>", "caption": "<1 to 2 sentences on what the visualization shows>", "svg": "<svg viewBox=\\"0 0 800 480\\">...</svg>"}',
  ].join("\n");
}

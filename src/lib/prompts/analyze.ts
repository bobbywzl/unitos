import { languageName, profileLines, type PromptCtx } from "@/lib/prompts/types";

// ANALYZE: a figure or table read as data (SPEC.md §4). The model that reads
// visuals best with the least invention reads it; the contract separates what
// is printed on the visual from what is estimated off it, so a number the
// reader cannot trust is marked, never presented as read. The route lands one
// PENDING note on the block.
export function analyzePrompt(ctx: PromptCtx): string {
  const table = ctx.table;
  const figure = ctx.figure;
  const what = table ? "table" : "figure";
  const source = table
    ? [
        "The table's markup:",
        table.html,
        ...(table.hasImage
          ? ["", "The table as it appears on its PDF page is attached as well. Where the markup and the image disagree, trust the image and say so in cautions."]
          : []),
      ]
    : figure
      ? [
          "Figure caption:",
          figure.caption || "(no caption)",
          ...(figure.kind === "image"
            ? [
                "",
                figure.page
                  ? "The PDF page the figure sits on is attached. Find the figure on it by its caption; read only that figure."
                  : "The figure's image is attached.",
              ]
            : []),
          ...(figure.svgSource ? ["", "The figure is this SVG chart:", figure.svgSource] : []),
          ...(figure.kind === "figure"
            ? ["", "No image of the figure could be produced. Work from the caption and the document, and say so in cautions."]
            : []),
        ]
      : [];
  return [
    profileLines(ctx.profile),
    "",
    `The reader asked for an analysis of a ${what} in "${ctx.documentTitle}". The full document is above.`,
    "",
    ...source,
    "",
    `Read the ${what} as data.`,
    "1. kind: table, chart, diagram, photo, map, or other.",
    "2. summary: one or two sentences saying what it shows.",
    "3. structure: for a chart, the axes with their units and the series; for a table, the columns and what a row is; for a diagram, the parts and how they connect. One short paragraph.",
    '4. readings: the values worth reading out, each as {label, value, certainty}. certainty "read" only for a value printed as text on the visual — a data label, a table cell, an axis tick. certainty "estimated" for a value read off an axis or a bar height by eye. Up to 30 readings; put the ones the document\'s argument rests on first.',
    "5. data: for a table, and for a chart whose values are printed, the full grid as columns and rows, cell text verbatim. Up to 40 rows and 12 columns; past that, the first 40 rows and a caution. A cell you cannot read is \"?\". Otherwise null.",
    "6. takeaway: what the data supports, one to three sentences. What the document claims about it, when the document says.",
    "7. cautions: everything a careful reader should know — text too small to read, cut-off axes, a legend you could not match, a scale that is not linear, a value that looked printed but might be estimated. Empty list when there is none.",
    "Rules: never state a value you cannot see. Never fill in a number from the document's text as if it were on the visual; if you use one, say so in cautions. Never round a printed value. Where the image is too small or unclear to be sure, say so in cautions instead of guessing.",
    `Write summary, structure, labels, takeaway, and cautions in ${languageName(ctx.lang)}. Keep values as printed.`,
    'Return ONLY JSON: {"kind": "…", "summary": "…", "structure": "…", "readings": [{"label": "…", "value": "…", "certainty": "read"}], "data": {"columns": ["…"], "rows": [["…"]]} or null, "takeaway": "…", "cautions": ["…"]}',
  ].join("\n");
}

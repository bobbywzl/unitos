import type { Lang } from "@/lib/i18n/config";
import { answerLanguage, profileLines, STYLE_RULE, type PromptCtx } from "@/lib/prompts/types";

// ANALYZE: a figure or table read for what it shows (SPEC.md §4). The model
// that reads visuals best with the least invention reads it. The answer
// streams as markdown into a card beside the article and persists as an
// annotation, like EXPLAIN. Always the same three sections in the same
// order: Insights, Quantitative, Linking to context.
export const ANALYSIS_SECTIONS: Record<Lang, readonly [string, string, string]> = {
  en: ["Insights", "Quantitative", "Linking to context"],
  zh: ["洞见", "数据", "上下文关联"],
};

export function analyzePrompt(ctx: PromptCtx): string {
  const table = ctx.table;
  const figure = ctx.figure;
  const what = table ? "table" : "figure";
  const [insights, quantitative, linking] = ANALYSIS_SECTIONS[ctx.lang];
  const source = table
    ? [
        "The table's markup:",
        table.html,
        ...(table.hasImage
          ? ["", "The table as printed on its PDF page is attached as well. Where the markup and the image disagree, trust the image and say so."]
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
          ...(figure.kind === "figure" || figure.kind === "video"
            ? ["", "No image of the figure is available. Work from the caption and the document, and say so in the first line."]
            : []),
        ]
      : [];
  return [
    profileLines(ctx.profile),
    "",
    `The reader asked for an analysis of a ${what} in "${ctx.documentTitle}". The full document is above.`,
    ctx.corpus
      ? "Project context follows the document: passages from the reader's other documents, their notes, and their annotations."
      : "No other material of the project is available.",
    "",
    ...source,
    "",
    `Analyze the ${what}. Write exactly three sections, in this order, each opened by its bold label on its own line: **${insights}**, **${quantitative}**, **${linking}**. Nothing before the first label.`,
    `1. ${insights}: one or two sentences on what the ${what} is there to show. Then the patterns in it, 2 to 5 list items: a trend, a break, an outlier, a gap between groups, a comparison the document's argument rests on, what the ${what} shows that the text does not say. Each item is one pattern, read from the data and interpreted against the document. State the pattern, not the layout of the axes.`,
    `2. ${quantitative}: the numbers behind each pattern, as list items. Values as printed on the ${what}, never rounded. Put ≈ before a value you estimated off an axis, a bar, or a curve. A number taken from the document's text instead of the ${what} ends with "(text)". Never state a value you cannot see.`,
    `3. ${linking}: where the ${what} contradicts, weakens, or complicates a claim in the document, citing the claim as [block <id>].${ctx.corpus ? " Then where it connects to the project context: name the document, cite a note as [note <id>]." : ""} No contradiction and no connection: say so in one line.`,
    `Rules: read only what is on the ${what}; where it is too small or unclear to be sure, say so instead of guessing. Keep the whole answer under 220 words.`,
    STYLE_RULE,
    answerLanguage(ctx.lang),
  ].join("\n");
}

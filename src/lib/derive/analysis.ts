import type { z } from "zod";
import type { analyzeOutputSchema } from "@/lib/derive/json";
import type { TFunc } from "@/lib/i18n/dictionaries";

// The note text of an ANALYZE and a COMPARE derivation (SPEC.md §4). Notes
// are markdown; the note editor has no tables, so a grid renders as one line
// per row. Headings come from the api dictionary, in the reader's language.

type Analysis = z.infer<typeof analyzeOutputSchema>;

function cell(text: string): string {
  return text.replace(/\s+/g, " ").trim() || "?";
}

/** One ANALYZE result as note markdown: summary, structure, the grid, the
    readings (≈ marks an estimate), the takeaway, the cautions. */
export function analysisMarkdown(
  result: Analysis,
  target: { kind: "figure" | "table"; caption: string },
  t: TFunc,
): string {
  const caption = target.caption.replace(/\s+/g, " ").trim().slice(0, 160);
  const lines: string[] = [
    `**${t(target.kind === "table" ? "api.analysisTitleTable" : "api.analysisTitleFigure")}${caption ? `: ${caption}` : ""}**`,
    "",
    result.summary.trim(),
  ];
  if (result.structure.trim()) lines.push("", result.structure.trim());
  if (result.data && result.data.rows.length > 0) {
    const columns = result.data.columns.map(cell);
    lines.push("", `**${t("api.analysisData")}**`, "");
    if (columns.length > 0) lines.push(`- ${columns.join(" · ")}`);
    for (const row of result.data.rows) {
      lines.push(`- ${row.map(cell).join(" · ")}`);
    }
  }
  if (result.readings.length > 0) {
    lines.push("", `**${t("api.analysisReadings")}**`, "");
    for (const r of result.readings) {
      lines.push(`- ${cell(r.label)}: ${r.certainty === "estimated" ? "≈ " : ""}${cell(r.value)}`);
    }
    if (result.readings.some((r) => r.certainty === "estimated")) {
      lines.push("", t("api.analysisEstimateNote"));
    }
  }
  if (result.takeaway.trim()) lines.push("", `**${t("api.analysisTakeaway")}**`, "", result.takeaway.trim());
  if (result.cautions.length > 0) {
    lines.push("", `**${t("api.analysisCautions")}**`, "");
    for (const c of result.cautions) lines.push(`- ${cell(c)}`);
  }
  return lines.join("\n");
}

type ComparePoint = { point: string; spans: unknown[] };
export type Comparison = {
  agreements: ComparePoint[];
  disagreements: ComparePoint[];
  onlyFirst: ComparePoint[];
  onlySecond: ComparePoint[];
};

/** One COMPARE result as note markdown: four lists under one title. Empty
    lists are left out. */
export function comparisonMarkdown(
  comparison: Comparison,
  titles: { first: string; second: string },
  t: TFunc,
): string {
  const lines: string[] = [`**${t("api.comparisonTitle", { first: titles.first, second: titles.second })}**`];
  const group = (heading: string, points: ComparePoint[]) => {
    if (points.length === 0) return;
    lines.push("", `**${heading}**`, "");
    for (const p of points) lines.push(`- ${p.point.replace(/\s+/g, " ").trim()}`);
  };
  group(t("api.compareAgree"), comparison.agreements);
  group(t("api.compareDisagree"), comparison.disagreements);
  group(t("api.compareOnly", { title: titles.first }), comparison.onlyFirst);
  group(t("api.compareOnly", { title: titles.second }), comparison.onlySecond);
  return lines.join("\n");
}

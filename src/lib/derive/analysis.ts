import type { TFunc } from "@/lib/i18n/dictionaries";

// The note text of a COMPARE derivation (SPEC.md §4). Notes are markdown;
// headings come from the api dictionary, in the reader's language.

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

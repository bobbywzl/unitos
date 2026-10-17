import type { useT } from "@/components/lang-provider";
import type { SourceChip } from "@/lib/types";

/** The source count's tooltip: how many sources, then each document once
    ("4 sources · How Reading Shapes Memory"). */
export function sourcesTip(sources: SourceChip[], t: ReturnType<typeof useT>): string {
  const titles = [...new Set(sources.map((s) => s.documentTitle))].join(", ");
  return sources.length === 1
    ? t("outline.sourceTitle", { titles })
    : t("outline.sourcesTitle", { n: sources.length, titles });
}

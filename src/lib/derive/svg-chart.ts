import type { LanguageModel } from "ai";
import { claude, claudeConfigured, claudeOptions } from "@/lib/claude";
import { SVG_CHART_EFFORT, SVG_CHART_MODEL } from "@/lib/derive/config";
import { resolveModelId } from "@/lib/models";

// The call for a figure that is an SVG chart (SPEC.md §2): Claude Opus 5.5
// reads the source whole. Analyze on the chart and the assistant acting on
// it both come here, so the two cannot disagree. Null when Claude is not
// configured: the caller keeps its own model and the source it has.
export async function svgChartCall(): Promise<{
  model: LanguageModel;
  providerOptions: ReturnType<typeof claudeOptions>;
  modelId: string;
} | null> {
  if (!claudeConfigured()) return null;
  return {
    model: await claude(SVG_CHART_MODEL),
    providerOptions: claudeOptions(SVG_CHART_EFFORT),
    modelId: await resolveModelId(SVG_CHART_MODEL),
  };
}

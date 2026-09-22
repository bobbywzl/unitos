import { SVG_CHART_EFFORT } from "@/lib/derive/config";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import type { ModelCall } from "@/lib/model-call";

// The call for a figure that is an SVG chart (SPEC.md §2): the svg-chart
// feature's model — Claude Opus 5.5 by default (SVG_CHART_MODEL) — reads
// the source whole. Analyze on the chart and the assistant acting on it
// both come here, so the two cannot disagree. Null when the model's key is
// not set: the caller keeps its own model and the source it has.
export async function svgChartCall(): Promise<ModelCall | null> {
  if (!(await featureConfigured("svg-chart"))) return null;
  return featureCall("svg-chart", SVG_CHART_EFFORT);
}

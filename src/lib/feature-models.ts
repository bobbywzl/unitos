import type { DerivationType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  CLASSIFY_MODEL,
  COLLAPSE_MODEL,
  CONNECT_MODEL,
  CONTENTS_MODEL,
  CONVERT_MODEL,
  DERIVATION_MODEL,
  GIST_MODEL,
  GLM_5_3_FLASH,
  MERGE_MODEL,
  PARSE_MODEL,
  SKELETON_MODEL,
  STITCH_MODEL,
  STITCH_SELECT_MODEL,
  SUGGEST_MODEL,
  SVG_CHART_MODEL,
  VISION_MODEL,
  VISUALIZE_MODEL,
  VOICE_MODEL,
  WEB_SEARCH_MODEL,
} from "@/lib/derive/config";
import { isGlmModel } from "@/lib/models";
import { isClaudeId, modelCall, modelConfigured, type Effort, type ModelCall } from "@/lib/model-call";
import { probeChatModel } from "@/lib/model-update";

// The model per feature (SPEC.md §2). Each feature has a default, the
// constant in lib/derive/config.ts, and may have a FeatureModel row: the id
// the admin set in the gateway page's Model per function section. A call site asks
// featureCall for its feature's model and never names a constant, so the
// admin's choice reaches every call. A role's default id in a row still
// follows the role (lib/models.ts): choosing claude-opus-5-5 means the opus
// role, wherever the bimonthly model update moves it. Any other id is
// called as written.

export type Feature =
  | "explain"
  | "simplify"
  | "salience"
  | "extract"
  | "summarize"
  | "find"
  | "distill"
  | "formalize"
  | "ask"
  | "compare"
  | "analyze"
  | "voice"
  | "suggest"
  | "visualize"
  | "assistant"
  | "act"
  | "web"
  | "vision"
  | "svg-chart"
  | "glossary"
  | "contents"
  | "collapse"
  | "skeleton"
  | "stitch"
  | "stitch-select"
  | "merge"
  | "gist"
  | "log"
  | "connect"
  | "parse"
  | "classify"
  | "convert";

/** Each feature's default model: the constant in lib/derive/config.ts. */
export const FEATURE_DEFAULTS: Record<Feature, string> = {
  explain: DERIVATION_MODEL.EXPLAIN,
  simplify: DERIVATION_MODEL.SIMPLIFY,
  salience: DERIVATION_MODEL.SALIENCE,
  extract: DERIVATION_MODEL.EXTRACT,
  summarize: DERIVATION_MODEL.SUMMARIZE,
  find: DERIVATION_MODEL.FIND,
  distill: DERIVATION_MODEL.DISTILL,
  formalize: DERIVATION_MODEL.FORMALIZE,
  ask: DERIVATION_MODEL.ASK,
  compare: DERIVATION_MODEL.COMPARE,
  analyze: DERIVATION_MODEL.ANALYZE,
  voice: VOICE_MODEL,
  suggest: SUGGEST_MODEL,
  visualize: VISUALIZE_MODEL,
  assistant: DERIVATION_MODEL.SYNTHESIS,
  act: DERIVATION_MODEL.SYNTHESIS,
  web: WEB_SEARCH_MODEL,
  vision: VISION_MODEL,
  "svg-chart": SVG_CHART_MODEL,
  glossary: GLM_5_3_FLASH,
  contents: CONTENTS_MODEL,
  collapse: COLLAPSE_MODEL,
  skeleton: SKELETON_MODEL,
  stitch: STITCH_MODEL,
  "stitch-select": STITCH_SELECT_MODEL,
  merge: MERGE_MODEL,
  gist: GIST_MODEL,
  log: GIST_MODEL,
  connect: CONNECT_MODEL,
  parse: PARSE_MODEL,
  classify: CLASSIFY_MODEL,
  convert: CONVERT_MODEL,
};

/** The order the admin page lists the features in: the reader's tools, the
    assistant, the readings, the import. */
export const FEATURE_ORDER: Feature[] = [
  "explain",
  "simplify",
  "salience",
  "extract",
  "distill",
  "summarize",
  "compare",
  "analyze",
  "visualize",
  "voice",
  "suggest",
  "find",
  "ask",
  "formalize",
  "assistant",
  "act",
  "web",
  "vision",
  "svg-chart",
  "stitch",
  "stitch-select",
  "merge",
  "gist",
  "log",
  "glossary",
  "contents",
  "collapse",
  "skeleton",
  "connect",
  "parse",
  "classify",
  "convert",
];

export function isFeature(value: string): value is Feature {
  return value in FEATURE_DEFAULTS;
}

// A derivation type's feature: the type's name in lowercase, the same name
// the usage record carries. SYNTHESIS is the assistant.
const DERIVATION_FEATURE: Record<DerivationType, Feature> = {
  EXPLAIN: "explain",
  SIMPLIFY: "simplify",
  SALIENCE: "salience",
  EXTRACT: "extract",
  SUMMARIZE: "summarize",
  SYNTHESIS: "assistant",
  FIND: "find",
  DISTILL: "distill",
  FORMALIZE: "formalize",
  ASK: "ask",
  COMPARE: "compare",
  ANALYZE: "analyze",
  VOICE: "voice",
  VISUALIZE: "visualize",
};

export function derivationFeature(type: DerivationType): Feature {
  return DERIVATION_FEATURE[type];
}

// The rows, read once per process and again after CACHE_MS, like the roles'
// rows (lib/models.ts). A database failure leaves the defaults standing.
const CACHE_MS = 5 * 60 * 1000;
let cache: { ids: Partial<Record<Feature, string>>; loadedAt: number } | null = null;
let loading: Promise<void> | null = null;

async function loadRows(): Promise<void> {
  try {
    const rows = await db.featureModel.findMany({ select: { feature: true, modelId: true } });
    const ids: Partial<Record<Feature, string>> = {};
    for (const row of rows) {
      if (isFeature(row.feature) && row.modelId.trim()) ids[row.feature] = row.modelId.trim();
    }
    cache = { ids, loadedAt: Date.now() };
  } catch (err) {
    console.warn("[models] feature models not read; defaults stand:", err);
    cache = { ids: cache?.ids ?? {}, loadedAt: Date.now() };
  }
}

async function rows(): Promise<Partial<Record<Feature, string>>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.ids;
  loading ??= loadRows().finally(() => {
    loading = null;
  });
  await loading;
  return cache?.ids ?? {};
}

/** Drop the cached rows: the next call reads the table again. */
export function forgetFeatureModels(): void {
  cache = null;
}

/** The id the feature calls: its row, or its default. A role's default id
    still resolves to the role's current id in the client. */
export async function featureModelId(feature: Feature): Promise<string> {
  return (await rows())[feature] ?? FEATURE_DEFAULTS[feature];
}

/** The feature's model at this effort, and the id called. */
export async function featureCall(feature: Feature, effort: Effort): Promise<ModelCall> {
  return modelCall(await featureModelId(feature), effort);
}

/** The feature's model has its key, so the feature is on. */
export async function featureConfigured(feature: Feature): Promise<boolean> {
  return modelConfigured(await featureModelId(feature));
}

// ── The admin's choice ─────────────────────────────────────────────────────

export type SetFeatureModelResult = { ok: true; modelId: string } | { ok: false; error: string };

const MODEL_ID_RX = /^[a-z0-9][a-z0-9._:-]{1,79}$/;

/** Set the feature's model. The default, or an empty id, drops the row. Any
    other id is refused when its client has no key, when the web feature
    would leave GLM and Kimi (the search is the model's provider's), or
    when one probe call on it does not answer; the feature then keeps its
    model. */
export async function setFeatureModel(feature: Feature, modelId: string): Promise<SetFeatureModelResult> {
  const id = modelId.trim();
  if (!id || id === FEATURE_DEFAULTS[feature]) {
    await db.featureModel.deleteMany({ where: { feature } });
    forgetFeatureModels();
    return { ok: true, modelId: FEATURE_DEFAULTS[feature] };
  }
  if (!MODEL_ID_RX.test(id)) return { ok: false, error: `${id} is not a model id.` };
  if (!modelConfigured(id)) {
    return { ok: false, error: `${isClaudeId(id) ? "ANTHROPIC_API_KEY" : "MOONSHOT_API_KEY"} is not set.` };
  }
  if (feature === "web" && !(isGlmModel(id) || id.startsWith("kimi-"))) {
    return { ok: false, error: "The assistant with Web on searches with its model's provider: a GLM or Kimi id." };
  }
  try {
    await probeChatModel(id);
  } catch (err) {
    return { ok: false, error: `${id} did not answer the probe: ${err instanceof Error ? err.message : String(err)}` };
  }
  await db.featureModel.upsert({
    where: { feature },
    create: { feature, modelId: id },
    update: { modelId: id },
  });
  forgetFeatureModels();
  return { ok: true, modelId: id };
}

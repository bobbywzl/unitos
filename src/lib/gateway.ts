// The AI gateway (SPEC.md §2): LiteLLM, one host in front of every AI
// provider. With LITELLM_BASE_URL and LITELLM_API_KEY set, every AI call goes
// to the gateway — GLM, Kimi, Claude, Gemini, Groq and OpenAI Whisper, OpenAI
// TTS, DeepL, Moonshot's web search, and the model lists the bimonthly model
// update reads. GLM 5.3 and GLM 5.3 Flash have no direct client: they are
// reached through the gateway alone, and without it Kimi K3 takes their
// calls (lib/models.ts). The gateway holds the provider keys, applies the app key's
// rate limits and budget, records spend per call, and runs the fallbacks in
// litellm/config.yaml. The app then needs no provider key but Deepgram's
// (lib/video/deepgram.ts: its body is the media bytes, which the gateway
// cannot carry). Without the two variables, each client calls its provider
// directly with its own key, as before.
//
// LITELLM_ADMIN_KEY is the gateway's master key. Only the admin console reads
// it (lib/gateway-admin.ts): the gateway page lists models, limits, spend,
// and health, and issues the app key. No model call uses it.
//
// Routes on the gateway, one per provider (litellm/config.yaml):
//   GLM           /v1/chat/completions, model zai/<id>
//   Kimi          /v1/chat/completions, model moonshot/<id>
//   Claude        /anthropic/v1/messages — the raw pass-through, so the
//                 request reaches Anthropic as written but for `fallbacks`,
//                 which the gateway keeps as its own router field (the app
//                 reruns a refusal itself: lib/derive/json-call.ts)
//   Gemini        /gemini/v1beta/… — the raw pass-through, files included
//   Whisper       /v1/audio/transcriptions, model groq/<id> or openai/<id>
//   TTS           /v1/audio/speech, model openai/<id>
//   Moonshot      /moonshot/… — a pass-through to Moonshot's API root, for
//                 the web-search formula and the model list
//   DeepL         /deepl/v2/translate — a pass-through
//   Deepgram      never: a direct call with DEEPGRAM_API_KEY

export type GatewayProvider =
  | "zai"
  | "moonshot"
  | "anthropic"
  | "gemini"
  | "groq"
  | "openai"
  | "deepgram"
  | "deepl";

const KEY_ENV: Record<GatewayProvider, string> = {
  zai: "ZAI_API_KEY", // read on the gateway host alone
  moonshot: "MOONSHOT_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  deepl: "DEEPL_API_KEY",
};

// Whitespace stripped: a key pasted into the host's settings with a line
// break inside it is refused as a header value, and the request never leaves.
function cleanKey(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, "") || undefined;
}

export function gatewayBaseUrl(): string | undefined {
  const url = process.env.LITELLM_BASE_URL?.trim();
  return url ? url.replace(/\/+$/, "") : undefined;
}

/** The app key: what every model call authenticates with. */
export function gatewayKey(): string | undefined {
  return cleanKey(process.env.LITELLM_API_KEY);
}

/** The master key, for the admin console alone. */
export function gatewayAdminKey(): string | undefined {
  return cleanKey(process.env.LITELLM_ADMIN_KEY);
}

/** Both set: every AI call goes to the gateway. */
export function gatewayConfigured(): boolean {
  return Boolean(gatewayBaseUrl() && gatewayKey());
}

/** A route on the gateway: the base URL and the path. */
export function gatewayUrl(path: string): string {
  const base = gatewayBaseUrl();
  if (!base) throw new Error("LITELLM_BASE_URL is not set");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The provider's own key, when the app calls it directly. */
export function providerKey(provider: GatewayProvider): string | undefined {
  return cleanKey(process.env[KEY_ENV[provider]]);
}

/** The key a call to this provider sends: the app key under the gateway,
    the provider's own key otherwise. */
export function keyFor(provider: GatewayProvider): string | undefined {
  return gatewayConfigured() ? gatewayKey() : providerKey(provider);
}

/** The provider's features are on: the gateway is set, or the provider's
    own key is. Under the gateway the provider's key lives there; a call the
    gateway cannot serve fails like any provider error. Deepgram never takes
    the gateway, so its own key decides. */
export function providerConfigured(provider: GatewayProvider): boolean {
  if (provider === "deepgram") return Boolean(providerKey(provider));
  if (provider === "zai") return gatewayConfigured();
  return gatewayConfigured() || Boolean(providerKey(provider));
}

/** The model id a chat, transcription, or speech call names under the
    gateway: the provider's prefix and the id, as litellm/config.yaml routes
    them. Direct calls take the id as it is. */
export function gatewayModelId(provider: "zai" | "moonshot" | "groq" | "openai", modelId: string): string {
  return gatewayConfigured() ? `${provider}/${modelId}` : modelId;
}

/** The headers that tell the gateway whose call this is and for which
    function, so its spend logs match the admin usage page: a tag per
    feature and per account, and the account as the gateway's end user.
    Nothing without the gateway. */
export function gatewayHeaders(meta: { userId: string | null; feature: string }): Record<string, string> {
  if (!gatewayConfigured()) return {};
  const tags = [`feature:${meta.feature}`];
  const headers: Record<string, string> = {};
  if (meta.userId) {
    tags.push(`user:${meta.userId}`);
    headers["x-litellm-end-user-id"] = meta.userId;
  }
  headers["x-litellm-tags"] = tags.join(",");
  return headers;
}

import { outboundFetch } from "@/lib/outbound-fetch";
import { recordUsage } from "@/lib/usage";
import { sanitizeForEdge } from "@/lib/voice/edge";

// Azure AI Speech (SPEC.md §6, Voice): Microsoft's own speech service, with
// the voices the Edge voice reads in — Ava multilingual, Xiaoxiao for
// Chinese — through its public REST API and the account's key. The first
// rung of /api/speech when AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are set.
// The free tier (F0) reads 500,000 characters a month; above it, neural
// voices cost $15 per million characters.

export const AZURE_TTS_MODEL = "azure-tts";
const USD_PER_CHAR = 15 / 1_000_000;
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

function azureKey(): string | undefined {
  return process.env.AZURE_SPEECH_KEY?.replace(/\s+/g, "") || undefined;
}

function azureRegion(): string | undefined {
  return process.env.AZURE_SPEECH_REGION?.trim().toLowerCase() || undefined;
}

export function azureSpeechConfigured(): boolean {
  return Boolean(azureKey() && azureRegion());
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" };

/** The SSML Azure reads: the text in its language's voice. */
export function azureSsml(text: string): string {
  const chinese = /[一-鿿]/.test(text);
  const lang = chinese ? "zh-CN" : "en-US";
  const voice = chinese ? "zh-CN-XiaoxiaoNeural" : "en-US-AvaMultilingualNeural";
  const escaped = sanitizeForEdge(text).replace(/[&<>'"]/g, (c) => XML_ESCAPES[c]);
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'>${escaped}</voice></speak>`;
}

/** `text` read aloud as MP3 bytes. Throws with Azure's status when it does
    not read it (401: a wrong key or region; 429: over the tier's rate). */
export async function azureSpeech(text: string, usage: { userId: string | null }): Promise<Buffer> {
  const key = azureKey();
  const region = azureRegion();
  if (!key || !region) throw new Error("AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is not set");
  // AZURE_SPEECH_URL points a local run at a stand-in server.
  const base = (process.env.AZURE_SPEECH_URL || `https://${region}.tts.speech.microsoft.com`).replace(/\/+$/, "");
  const res = await outboundFetch(`${base}/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
      "User-Agent": "Unitos",
    },
    body: azureSsml(text),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Azure TTS ${res.status} ${detail.slice(0, 200)}`.trim());
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length === 0) throw new Error("Azure TTS answered with no audio");
  recordUsage({ userId: usage.userId, feature: "voice", model: AZURE_TTS_MODEL }, { inputTokens: text.length }, text.length * USD_PER_CHAR);
  return audio;
}

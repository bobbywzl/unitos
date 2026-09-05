import type { Lang } from "@/lib/i18n/config";
import { outboundFetch } from "@/lib/outbound-fetch";
import { recordUsage } from "@/lib/usage";

// DeepL translation (SPEC.md §19): the one translation provider, Chinese and
// English both ways. A Free API key ends in ":fx" and uses the free host; any
// other key uses the Pro host. Texts go in batches of at most 50 and about
// 100 KB, DeepL's request limits; the source language is DeepL's own
// detection, so a document in a third language still translates.
const BATCH_TEXTS = 50;
const BATCH_CHARS = 100_000;

export const DEEPL_MODEL = "deepl";

const TARGET: Record<Lang, string> = { en: "EN-US", zh: "ZH" };

export function deeplConfigured(): boolean {
  return Boolean(process.env.DEEPL_API_KEY);
}

function endpoint(key: string): string {
  const base =
    process.env.DEEPL_API_URL ??
    (key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com");
  return `${base.replace(/\/$/, "")}/v2/translate`;
}

type DeepLResponse = {
  translations?: { detected_source_language?: string; text?: string }[];
  message?: string;
};

async function translateBatch(
  texts: string[],
  target: Lang,
  key: string,
  signal?: AbortSignal,
): Promise<{ texts: string[]; detected: string[] }> {
  const res = await outboundFetch(endpoint(key), {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: texts,
      target_lang: TARGET[target],
      preserve_formatting: true,
      split_sentences: "1",
    }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as DeepLResponse | null;
  if (!res.ok) {
    const reason =
      res.status === 403
        ? "DeepL refused the key"
        : res.status === 456
          ? "the DeepL character quota is used up"
          : (body?.message ?? `DeepL request failed (${res.status})`);
    throw new Error(reason);
  }
  const translations = body?.translations ?? [];
  if (translations.length !== texts.length) {
    throw new Error(`DeepL returned ${translations.length} texts for ${texts.length}`);
  }
  return {
    texts: translations.map((t) => t.text ?? ""),
    detected: translations.map((t) => (t.detected_source_language ?? "").toLowerCase()),
  };
}

/** Translate texts into the target language, in order. Empty texts pass
    through untouched. Records the character count as usage. */
export async function deeplTranslate(
  texts: string[],
  target: Lang,
  opts: { userId: string | null; signal?: AbortSignal },
): Promise<{ texts: string[]; detected: string[] }> {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error("DEEPL_API_KEY is not set");
  const out: string[] = new Array(texts.length).fill("");
  const detected: string[] = new Array(texts.length).fill("");
  let batch: number[] = [];
  let chars = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const indices = batch;
    batch = [];
    chars = 0;
    const result = await translateBatch(
      indices.map((i) => texts[i]),
      target,
      key,
      opts.signal,
    );
    indices.forEach((i, at) => {
      out[i] = result.texts[at];
      detected[i] = result.detected[at];
    });
    const sent = indices.reduce((n, i) => n + texts[i].length, 0);
    recordUsage({ userId: opts.userId, feature: "translate", model: DEEPL_MODEL }, { inputTokens: sent });
  };
  for (let i = 0; i < texts.length; i++) {
    if (texts[i].trim() === "") continue;
    if (batch.length >= BATCH_TEXTS || chars + texts[i].length > BATCH_CHARS) await flush();
    batch.push(i);
    chars += texts[i].length;
  }
  await flush();
  return { texts: out, detected };
}

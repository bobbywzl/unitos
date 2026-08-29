import { z } from "zod";
import { extractJson } from "@/lib/derive/json";
import { geminiCall } from "@/lib/video/gemini";
import type { TranscriptSegment } from "@/lib/video/transcribe";

// Transcript cleanup (SPEC.md §11): every new video and audio transcript is
// cleaned line by line before it stores — filler words, stutters, and false
// starts removed, punctuation and casing fixed — so the transcript reads like
// an article. Gemini cleans when a key is set; the rules pass is the keyless
// fallback. Cleaning runs before blocks are written, so anchors, Find, and the
// digest all read the clean text; a line's time range never changes.

const BATCH_LINES = 150;

const TIDY_PROMPT = [
  "Clean these transcript lines. Return the same number of lines, same order, one cleaned line per input line.",
  'Return ONLY JSON: {"lines": ["…", "…"]}',
  "1. Remove filler words (um, uh, er, erm, hmm and their variants), stutters, immediate word repeats, and abandoned false starts.",
  "2. Fix punctuation and capitalization so each line reads as clean written prose.",
  "3. Change nothing else: never paraphrase, summarize, reorder, merge, translate, or add words. Every kept word stays the speaker's.",
  '4. A line that is only filler or noise: return "" for it.',
  "Lines (index. text):",
].join("\n");

const tidyResponseSchema = z.object({ lines: z.array(z.string()) });

async function tidyBatch(texts: string[]): Promise<string[]> {
  const prompt = [
    TIDY_PROMPT,
    ...texts.map((text, i) => `${i}. ${text.replace(/\n/g, " ")}`),
  ].join("\n");
  return geminiCall(
    [{ text: prompt }],
    { json: true, maxOutputTokens: 65536, usage: { userId: null, feature: "transcribe" } },
    (text) => {
      const parsed = tidyResponseSchema.safeParse(extractJson(text));
      if (!parsed.success) throw new Error("output was not lines");
      if (parsed.data.lines.length !== texts.length) {
        throw new Error(
          `line count moved (${texts.length} in, ${parsed.data.lines.length} out)`,
        );
      }
      return parsed.data.lines.map((line) => line.trim());
    },
  );
}

// Words English doubles legitimately; the rules pass never collapses these.
const KEEP_DOUBLED = new Set(["had", "that"]);

/** The keyless cleanup: strip filler words and collapse immediate repeats.
    Deterministic; never touches anything else. */
export function stripFillers(text: string): string {
  let out = text
    // Filler interjections, with a trailing comma or period when one follows.
    .replace(/(?:^|\s)(?:u+m+|u+h+m*|e+r+m+|e+rr+|h+mm+)[,.]?(?=\s|$)/gi, " ")
    // Immediate word repeats: "but but" / "the, the" → one. Case-insensitive;
    // the first occurrence survives.
    .replace(/\b([A-Za-z']+)(?:[,;]?\s+\1\b)+/gi, (match, word: string) =>
      KEEP_DOUBLED.has(word.toLowerCase()) ? match : word,
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/^[\s,.;:]+/, "")
    .trim();
  if (out && /^[a-z]/.test(out)) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}

/** Clean transcript lines. Gemini when a key is set (fillers, stutters, false
    starts, punctuation); the rules pass otherwise or when Gemini fails. Lines
    cleaned down to nothing drop out; every kept line keeps its time range. */
export async function tidyTranscript(
  lines: TranscriptSegment[],
): Promise<{ lines: TranscriptSegment[]; provider: "Gemini" | "rules" }> {
  if (lines.length === 0) return { lines, provider: "rules" };

  if (process.env.GEMINI_API_KEY) {
    try {
      const cleaned: string[] = [];
      for (let i = 0; i < lines.length; i += BATCH_LINES) {
        const batch = lines.slice(i, i + BATCH_LINES);
        cleaned.push(...(await tidyBatch(batch.map((l) => l.text))));
      }
      return {
        lines: lines
          .map((line, i) => ({ ...line, text: cleaned[i] }))
          .filter((line) => line.text !== ""),
        provider: "Gemini",
      };
    } catch (err) {
      console.warn("[tidy] Gemini cleanup failed, using rules:", err instanceof Error ? err.message : err);
    }
  }

  return {
    lines: lines
      .map((line) => ({ ...line, text: stripFillers(line.text) }))
      .filter((line) => line.text !== ""),
    provider: "rules",
  };
}

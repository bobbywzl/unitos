import { z } from "zod";
import { chooseDepth, type DepthInput } from "@/lib/assistant/depth";
import { DERIVATION_EFFORT } from "@/lib/derive/config";
import type { Effort } from "@/lib/model-call";

// Three thinking modes on every assistant surface (SPEC.md §7): Auto
// Thinking decides from the message (lib/assistant/depth.ts): a lookup, a
// one-place change, or a confirmation at the lowest effort, a question of
// meaning or a change to a part at the deep effort, a change across the
// document or a reading across the material at the highest. Fast Thinking
// answers at the lowest effort, Deep Thinking at the effort every answer
// used before the choice existed. Auto is the default. The choice is one
// setting for the whole app, remembered in this browser like the Web
// toggle, and rides on every assistant request.
export type Thinking = "fast" | "deep" | "auto";
export const thinkingSchema = z.enum(["fast", "deep", "auto"]);
export const DEFAULT_THINKING: Thinking = "auto";

/** The effort a message runs at: the reader's choice, or Auto's reading of
    the message. Absent reads as Auto; Auto with no message reads as Deep. */
export function thinkingEffort(thinking: Thinking | undefined, input?: DepthInput): Effort {
  if (thinking === "fast") return "low";
  if (thinking === "deep" || !input) return DERIVATION_EFFORT.SYNTHESIS;
  return chooseDepth(input).depth;
}

/** The two-way choice the edit passes take (fast or deep): Auto resolves
    through the message, low as fast and the rest as deep. */
export function resolvedThinking(thinking: Thinking | undefined, input?: DepthInput): "fast" | "deep" {
  return thinkingEffort(thinking, input) === "low" ? "fast" : "deep";
}

/** What the usage log says of Auto's choice: the depth and its signals. */
export function depthNote(thinking: Thinking | undefined, input: DepthInput): string {
  if (thinking === "fast" || thinking === "deep") return thinking;
  const choice = chooseDepth(input);
  return `auto:${choice.depth}${choice.signals.length > 0 ? ` (${choice.signals.join(", ")})` : ""}`;
}

// The choice as a store the panel and the reader's cards read (SPEC.md §7).
// Written as "fast" or "deep" and absent for Auto, so the default needs no write.
const THINKING_KEY = "unitos-assistant-thinking";
const THINKING_EVENT = "unitos:assistant-thinking";

export function readThinking(): Thinking {
  try {
    const stored = localStorage.getItem(THINKING_KEY);
    return stored === "fast" || stored === "deep" ? stored : "auto";
  } catch {
    return DEFAULT_THINKING;
  }
}

export function writeThinking(thinking: Thinking) {
  try {
    if (thinking === "auto") localStorage.removeItem(THINKING_KEY);
    else localStorage.setItem(THINKING_KEY, thinking);
  } catch {
    // A blocked store only loses the memory of the choice.
  }
  window.dispatchEvent(new Event(THINKING_EVENT));
}

export function subscribeThinking(onChange: () => void) {
  window.addEventListener(THINKING_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THINKING_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

import { z } from "zod";
import { DERIVATION_EFFORT, type KimiEffort } from "@/lib/derive/config";

// Two thinking modes on every assistant surface (SPEC.md §7): Fast Thinking
// answers at Kimi's lowest reasoning effort, Deep Thinking at the effort every
// assistant answer used before the choice existed. Deep is the default, so an
// answer is as considered as it always was until the reader asks for speed.
// The choice is one setting for the whole app, remembered in this browser like
// the Web toggle, and rides on every assistant request.
export type Thinking = "fast" | "deep";
export const thinkingSchema = z.enum(["fast", "deep"]);
export const DEFAULT_THINKING: Thinking = "deep";

export function thinkingEffort(thinking: Thinking | undefined): KimiEffort {
  return thinking === "fast" ? "low" : DERIVATION_EFFORT.SYNTHESIS;
}

// The choice as a store the panel and the reader's cards read (SPEC.md §7).
// Written as "fast" and absent for Deep, so the default needs no write.
const THINKING_KEY = "unitos-assistant-thinking";
const THINKING_EVENT = "unitos:assistant-thinking";

export function readThinking(): Thinking {
  try {
    return localStorage.getItem(THINKING_KEY) === "fast" ? "fast" : "deep";
  } catch {
    return DEFAULT_THINKING;
  }
}

export function writeThinking(thinking: Thinking) {
  try {
    if (thinking === "fast") localStorage.setItem(THINKING_KEY, "fast");
    else localStorage.removeItem(THINKING_KEY);
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

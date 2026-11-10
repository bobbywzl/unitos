import type { ModelMessage } from "ai";
import { documentPrefix, type PageName, type PrefixBlock } from "@/lib/derive/context";

// The context layers (SPEC.md §2). Every assistant call sends what it reads
// in layers, the layer that changes least first, and marks the end of each
// for the provider's cache. A later call that opens with the same layers
// reads them from the cache at a twentieth of the input price (Claude
// Sonnet 5.5: $0.10 per 1M tokens read, $2 unread) and pays in full only
// for what is new.
//
// 1. The document: its blocks, as documentPrefix renders them. It changes
//    when the document is edited or parsed again, and at no other time.
//    Every surface that reads the open document sends this layer first and
//    byte for byte the same — the selection chat, the sidebar assistant at
//    This page, the assistant's suggestions and their passes, the note's
//    assistant, Save as note, the voice command — so one entry serves them
//    all, for every reader of the document.
// 2. The rules: what is the same for every message of a surface on the
//    document while the document changes the same way. The selection chat's
//    rules whole; the sidebar's action types and rules for actions (its
//    rules of the answer stay in the message, next to the question: a
//    conversation's turns stand between the layers and the message). They
//    stand after the document, so the document's entry stays one for every
//    surface, and before the material, so a new note never costs them again.
// 3. The material: what the reader made — notes, annotations, layers, the
//    project's sections. It changes when the reader works, so a new note
//    costs this layer again and never the document or the rules.
// 4. The conversation: the turns so far, which only grow.
// 5. The message: the selection, the question, what the reader attached,
//    and in the sidebar the rules of the answer. Never cached.
//
// A layer's marker is ignored by every provider but Anthropic: GLM, Kimi,
// and Gemini cache a repeated prefix on their own, and the same order
// serves them.

/** How long each layer's entry lives after its last read. A read renews it
    at no cost. The document outlives the gaps of a reading session (a
    question, ten minutes of reading, the next question), which five minutes
    would not: a write costs 2× the input price for the hour and 1.25× for
    five minutes, a read 0.05×, so the hour pays for itself at the third
    message of a session and five minutes never does when the reader reads
    between questions. The material changes with every note, and the
    conversation with every turn: five minutes, the cheap write. The hour
    comes first in a request, as the API asks. */
export const DOCUMENT_TTL = "1h" as const;
const WORKING_TTL = "5m" as const;

type Ttl = typeof DOCUMENT_TTL | typeof WORKING_TTL;

const marker = (ttl: Ttl) => ({ anthropic: { cacheControl: { type: "ephemeral" as const, ttl } } });

/** Layer 1: the open document. Every caller passes the document's blocks in
    order with the same fields, its references, and pageNames(document). */
export function documentLayer(
  title: string,
  blocks: PrefixBlock[],
  references: unknown,
  pageName: PageName | null,
): ModelMessage {
  return { role: "system", content: documentPrefix(title, blocks, references, pageName), providerOptions: marker(DOCUMENT_TTL) };
}

/** Layer 1 for a scope with no single document (the project's documents,
    each whole): text that changes only when a document does. */
export function stableLayer(text: string): ModelMessage {
  return { role: "system", content: text, providerOptions: marker(DOCUMENT_TTL) };
}

/** Layer 2: the rules of the surface, kept as long as the document: a
    reader who comes back to the document within the hour reads both. */
export function rulesLayer(text: string): ModelMessage {
  return { role: "system", content: text, providerOptions: marker(DOCUMENT_TTL) };
}

/** Layer 3: what the reader made. */
export function materialLayer(text: string): ModelMessage {
  return { role: "system", content: text, providerOptions: marker(WORKING_TTL) };
}

/** Layer 4: the turns so far end here. A request takes four markers at
    most: the caller leaves this one out when a tool of the provider adds
    its own (the web search). The marker goes on the last turn
    before the message, whose words are the same in the next request; the
    message itself carries the rules and is never the same twice. */
export function markConversation(turns: ModelMessage[]): void {
  const last = turns[turns.length - 1];
  if (!last || last.role === "system") return;
  last.providerOptions = { ...last.providerOptions, ...marker(WORKING_TTL) };
}

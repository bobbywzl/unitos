import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelMessage } from "ai";

// The eval's external model (SPEC.md §25, scripts/eval/assistant): with
// EVAL_EXTERNAL_DIR set, no provider is called. A JSON call writes its
// messages to <dir>/calls/<label>-<hash>.prompt.md and reads the answer an
// agent wrote to <dir>/calls/<label>-<hash>.answer.md; an answer not there
// yet is a pending call, which the runner lists for the agents. The hash is
// the messages' own, so a call made twice (a parallel window, a run after
// the answers land) finds the same file. Never set in production.

export const EXTERNAL_PENDING = "pending: the external model has not answered";

const SYSTEM = "=====[SYSTEM]=====";
const USER = "=====[USER]=====";
const ASSISTANT = "=====[ASSISTANT]=====";

/** The messages as the agents read them: one marked section per message. */
export function renderExternalMessages(messages: ModelMessage[]): string {
  return messages
    .map((m) => {
      const mark = m.role === "system" ? SYSTEM : m.role === "assistant" ? ASSISTANT : USER;
      const text =
        typeof m.content === "string"
          ? m.content
          : m.content
              .map((part) => (part.type === "text" ? part.text : part.type === "file" ? `[file: ${part.mediaType}]` : `[${part.type}]`))
              .join("\n");
      return `${mark}\n${text}`;
    })
    .join("\n\n");
}

export function externalDir(): string | null {
  const dir = process.env.EVAL_EXTERNAL_DIR?.trim();
  return dir ? dir : null;
}

/** The call's answer, or null while the agent has not written it. Writes
    the prompt file either way. */
export function externalCall(dir: string, label: string, messages: ModelMessage[]): { name: string; text: string | null } {
  const rendered = renderExternalMessages(messages);
  const hash = createHash("sha1").update(rendered).digest("hex").slice(0, 8);
  const name = `${label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "call"}-${hash}`;
  const calls = join(dir, "calls");
  mkdirSync(calls, { recursive: true });
  const promptPath = join(calls, `${name}.prompt.md`);
  if (!existsSync(promptPath)) writeFileSync(promptPath, `${rendered}\n`);
  const answerPath = join(calls, `${name}.answer.md`);
  return { name, text: existsSync(answerPath) ? readFileSync(answerPath, "utf8") : null };
}

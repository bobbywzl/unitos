// The sidebar assistant's actions block (SPEC.md §7): where it opens in an
// answer, and the answer split from it. No server imports: the server holds
// the block back from the stream, and the client strips one an older answer
// still carries, so the reader never sees the JSON.

export const ACTIONS_FENCE = "```actions";

// A fence of any other info string (json, none, javascript, a typo of
// actions) counts when its JSON holds the actions (FENCE_ACTIONS_PROBE): a
// model writes it so when it forgets the info string, and the reader must
// never see the JSON.
// JSON that is actions: an object keyed "actions", or a list whose first
// item names an action type or carries an instruction.
const FENCE_ACTIONS_PROBE = /^\{\s*"actions"\s*:|^\[\s*\{\s*"(?:type|instruction)"\s*:/;
// How much of a fence's body the probe waits for before it decides.
const PROBE_CHARS = 40;

export type ActionsFenceScan =
  // An actions block opens at `at`; its JSON starts at `body`; fenced =
  // opened with ``` (closes at the next ```), else bare JSON to the end.
  | { at: number; body: number; fenced: boolean }
  // Text from `at` could still turn out to be the block: a stream holds it.
  | { at: number; pending: true }
  | null;

/** Where the actions block of an answer opens. The block is a fence whose
    info string is actions; or a fence of another info string or none, or JSON
    on a line of its own, whose JSON is actions: a model writes it so when it forgets
    the info string. done = the answer is whole; before that, text that could
    still become the block reads as pending. */
export function scanActionsFence(text: string, done: boolean): ActionsFenceScan {
  const exact = text.indexOf(ACTIONS_FENCE);
  const limit = exact === -1 ? text.length : exact;
  // Every line start before the exact fence: a loose fence or bare JSON.
  for (let lineStart = 0; lineStart < limit; ) {
    const lineEnd = text.indexOf("\n", lineStart);
    const indent = text.slice(lineStart).match(/^[ \t]*/)![0].length;
    const at = lineStart + indent;
    if (at < limit) {
      const verdict = probeAt(text, at, done);
      if (verdict) return verdict;
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }
  if (exact !== -1) return { at: exact, body: exact + ACTIONS_FENCE.length, fenced: true };
  return null;
}

function probeAt(text: string, at: number, done: boolean): ActionsFenceScan {
  const rest = text.slice(at);
  if (!done && rest.length < 3 && "```".startsWith(rest)) return { at, pending: true };
  if (rest.startsWith("```")) {
    const nl = rest.indexOf("\n");
    if (nl === -1) {
      if (done) return null;
      // An info string is one word: a space after it is prose, not a fence.
      return /^[\w-]*$/.test(rest.slice(3)) ? { at, pending: true } : null;
    }
    if (!/^[\w+.-]*$/.test(rest.slice(3, nl).trim())) return null;
    const body = rest.slice(nl + 1);
    return probeJson(body, done, at, at + nl + 1, true);
  }
  if (rest[0] === "{" || rest[0] === "[") return probeJson(rest, done, at, at, false);
  return null;
}

function probeJson(body: string, done: boolean, at: number, bodyAt: number, fenced: boolean): ActionsFenceScan {
  const json = body.trimStart().slice(0, 400).replace(/\s+/g, " ");
  if (!json) return done ? null : { at, pending: true };
  if (json[0] !== "{" && json[0] !== "[") return null;
  if (FENCE_ACTIONS_PROBE.test(json.replace(/\s+(?=["{[:])/g, ""))) return { at, body: bodyAt, fenced };
  // Not enough of the JSON yet to tell.
  return !done && json.length < PROBE_CHARS ? { at, pending: true } : null;
}

/** Split an answer into the text before the actions block and the block's
    content; content is null when the answer carries no block. A fence closes
    at the first ``` outside a JSON string, so a code fence inside an
    instruction stays in it; bare JSON runs to the answer's end. */
export function splitActionsFence(text: string): { text: string; content: string | null } {
  const scan = scanActionsFence(text, true);
  if (!scan || "pending" in scan) return { text, content: null };
  const rest = text.slice(scan.body);
  if (!scan.fenced) return { text: text.slice(0, scan.at).trimEnd(), content: rest.trim() };
  let close = -1;
  let inString = false;
  for (let i = 0; i < rest.length && close === -1; i++) {
    const c = rest[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (rest.startsWith("```", i)) close = i;
  }
  // Quotes that never pair up: the last ``` closes.
  if (close === -1) close = rest.lastIndexOf("```");
  return {
    text: text.slice(0, scan.at).trimEnd(),
    content: (close === -1 ? rest : rest.slice(0, close)).trim(),
  };
}


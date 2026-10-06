import { z } from "zod";
import {
  grammarIssueSchema,
  GRAMMAR_MAX_CHARS,
  GRAMMAR_MAX_PARAGRAPHS,
  GRAMMAR_MAX_REQUEST_CHARS,
  keptIssues,
  textKey,
  type GrammarIssue,
} from "@/lib/grammar";

// The grammar check's client (SPEC.md §29, typing): the paragraphs the page
// editor and the note editor send to /api/grammar, one request at a time, a
// few paragraphs each, the paragraphs the reader just wrote first. The
// answer is kept by the paragraph's text, in this browser, so a paragraph
// whose text is unchanged is never sent again; Ignore takes the issue out
// of its paragraph's answer. Offline nothing is sent; a 401, 403, or 503
// stops the check until the page reloads.

const STORAGE_KEY = "unitos-grammar-v1";
/** The most paragraphs whose answer is kept: the newest. */
const MAX_KEPT = 3000;
/** The least time between two requests. */
const GAP_MS = 800;
/** After a failed request, the wait before the next. */
const RETRY_MS = 30_000;

const issuesSchema = z.array(grammarIssueSchema);
const responseSchema = z.object({ paragraphs: z.array(z.object({ id: z.string(), issues: issuesSchema })) });

let cache: Map<string, GrammarIssue[]> | null = null;
const queue: string[] = [];
const queued = new Set<string>();
const listeners = new Set<(texts: ReadonlySet<string>) => void>();
let running = false;
let stopped = false;
let lastSent = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function store(): Map<string, GrammarIssue[]> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [key, issues] of Object.entries(parsed as Record<string, unknown>)) {
        const read = issuesSchema.safeParse(issues);
        if (read.success) cache.set(key, read.data);
      }
    }
  } catch {
    // Storage is off: answers are kept until the page closes.
  }
  return cache;
}

function save(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const kept = store();
    while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value as string);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      // Storage is full or off: the answers hold until the page closes.
    }
  }, 1000);
}

/** The issues of a paragraph's text, or undefined when it has not been checked. */
export function cachedIssues(text: string): GrammarIssue[] | undefined {
  const issues = store().get(textKey(text));
  return issues && keptIssues(text, issues);
}

/** Ignore: the issue is gone from this paragraph text's answer. */
export function ignoreIssue(text: string, issue: GrammarIssue): void {
  const key = textKey(text);
  const issues = store().get(key);
  if (!issues) return;
  store().set(
    key,
    issues.filter((i) => !(i.wrong === issue.wrong && i.replacement === issue.replacement)),
  );
  save();
  emit(new Set([text]));
}

/** Called with the texts whose answer arrived or changed. */
export function subscribeGrammar(listener: (texts: ReadonlySet<string>) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(texts: ReadonlySet<string>): void {
  for (const listener of listeners) listener(texts);
}

/** Whether a paragraph is one the check sends: short enough. */
export const sendable = (text: string) => text.trim().length > 0 && text.length <= GRAMMAR_MAX_CHARS;

/** Ask for these paragraphs' issues. `first`: the reader just wrote them,
    so they go before the paragraphs waiting. A text already answered or
    waiting is not asked again. */
export function checkGrammar(texts: readonly string[], first: boolean): void {
  if (stopped) return;
  const fresh = texts.filter((text) => sendable(text) && !store().has(textKey(text)));
  if (first) {
    for (const text of fresh) {
      if (queued.has(text)) queue.splice(queue.indexOf(text), 1);
      else queued.add(text);
    }
    queue.unshift(...fresh);
  } else {
    for (const text of fresh) {
      if (queued.has(text)) continue;
      queued.add(text);
      queue.push(text);
    }
  }
  void pump();
}

/** Drop what waits (the editor closed or the check went off). */
export function clearGrammarQueue(): void {
  queue.length = 0;
  queued.clear();
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0 && !stopped) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await new Promise<void>((resolve) => window.addEventListener("online", () => resolve(), { once: true }));
        continue;
      }
      const since = Date.now() - lastSent;
      if (since < GAP_MS) await wait(GAP_MS - since);
      const batch: string[] = [];
      let chars = 0;
      while (queue.length > 0 && batch.length < GRAMMAR_MAX_PARAGRAPHS && chars + queue[0].length <= GRAMMAR_MAX_REQUEST_CHARS) {
        const text = queue.shift() as string;
        queued.delete(text);
        if (store().has(textKey(text))) continue;
        batch.push(text);
        chars += text.length;
      }
      if (batch.length === 0) continue;
      lastSent = Date.now();
      const answered = await send(batch);
      if (answered === "stop") {
        stopped = true;
        clearGrammarQueue();
      } else if (answered === "retry") {
        for (const text of batch.reverse()) {
          if (!queued.has(text)) {
            queued.add(text);
            queue.unshift(text);
          }
        }
        await wait(RETRY_MS);
      }
    }
  } finally {
    running = false;
  }
}

async function send(batch: string[]): Promise<"ok" | "stop" | "retry"> {
  let res: Response;
  try {
    res = await fetch("/api/grammar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paragraphs: batch.map((text, i) => ({ id: `p${i + 1}`, text })) }),
    });
  } catch {
    return "retry";
  }
  if (res.status === 401 || res.status === 403 || res.status === 503) return "stop";
  if (!res.ok) return res.status >= 500 ? "retry" : "ok";
  let body: z.infer<typeof responseSchema>;
  try {
    const read = responseSchema.safeParse(await res.json());
    if (!read.success) return "ok";
    body = read.data;
  } catch {
    return "retry";
  }
  const byId = new Map(body.paragraphs.map((p) => [p.id, p.issues]));
  const done = new Set<string>();
  batch.forEach((text, i) => {
    const issues = byId.get(`p${i + 1}`);
    if (!issues) return;
    store().set(textKey(text), keptIssues(text, issues));
    done.add(text);
  });
  save();
  if (done.size > 0) emit(done);
  return "ok";
}

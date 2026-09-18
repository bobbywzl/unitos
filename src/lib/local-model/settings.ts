import type { DerivationType } from "@prisma/client";

// The local model (SPEC.md §27): a model on the reader's own machine, served
// by Ollama, chosen in Settings under "Assistant on this device". The
// setting lives in localStorage only — the browser calls the model, and the
// server never calls the reader's machine. Client components import this
// file; nothing here touches the server.

export const LOCAL_MODEL_KEY = "unitos-local-model";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export type LocalModel = { url: string; model: string };

// The tools that run on the local model when one is set. Only tools whose
// output is short and whose contract is plain text: a 4B-class model does
// not hold a long structured output reliably, so Distill, Extract,
// Visualize, Stitch, and the digest stay on the cloud models.
export const LOCAL_MODEL_TOOLS: readonly DerivationType[] = ["SIMPLIFY"];

export function localModelRuns(type: DerivationType): boolean {
  return LOCAL_MODEL_TOOLS.includes(type);
}

// Only localhost: an HTTPS page may call http://localhost (Chrome, Edge, and
// Firefox treat it as a secure context) and nothing else over plain http.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The URL as the browser calls it — no trailing slash — or null when it is
    not a localhost URL. */
export function localModelUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!LOCAL_HOSTS.has(parsed.hostname)) return null;
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

// The stored fields, as typed. Empty strings when nothing is stored.
export type LocalModelFields = { url: string; model: string };

const EMPTY: LocalModelFields = { url: DEFAULT_OLLAMA_URL, model: "" };
let cached: LocalModelFields | null = null;
const listeners = new Set<() => void>();

export function readLocalModelFields(): LocalModelFields {
  if (cached) return cached;
  if (typeof localStorage === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(LOCAL_MODEL_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<LocalModelFields>) : null;
    cached = {
      url: typeof parsed?.url === "string" && parsed.url.trim() ? parsed.url : DEFAULT_OLLAMA_URL,
      model: typeof parsed?.model === "string" ? parsed.model : "",
    };
  } catch {
    cached = EMPTY;
  }
  return cached;
}

export function writeLocalModelFields(fields: LocalModelFields) {
  cached = fields;
  try {
    localStorage.setItem(LOCAL_MODEL_KEY, JSON.stringify(fields));
  } catch {
    // storage unavailable: the fields hold for this page only
  }
  for (const cb of listeners) cb();
}

export function subscribeLocalModel(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function serverLocalModelFields(): LocalModelFields {
  return EMPTY;
}

/** The local model to call, or null when none is set: no model name, or a URL
    that is not localhost. With null, every tool runs on the cloud models. */
export function readLocalModel(): LocalModel | null {
  const fields = readLocalModelFields();
  const model = fields.model.trim();
  const url = localModelUrl(fields.url);
  if (!model || !url) return null;
  return { url, model };
}

/** The local model for one tool, or null: the tool runs on the cloud models. */
export function localModelFor(type: DerivationType): LocalModel | null {
  if (!localModelRuns(type)) return null;
  return readLocalModel();
}

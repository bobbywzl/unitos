import { generateText } from "ai";
import { claude, claudeApiKey, claudeBaseUrl, claudeConfigured, claudeOptions } from "@/lib/claude";
import { db } from "@/lib/db";
import { kimi, kimiApiKey, kimiBaseUrl, kimiConfigured, kimiOptions } from "@/lib/kimi";
import {
  currentModelId,
  forgetModelChoices,
  MODEL_ROLES,
  ROLE_ORDER,
  type ModelRole,
} from "@/lib/models";
import { outboundFetch } from "@/lib/outbound-fetch";
import { recordUsage, sdkTokens } from "@/lib/usage";

// The bimonthly model update (SPEC.md §2): for each role, read the provider's
// published model list, find the newest version of the role's family, and
// move the role to it — after one probe call proves the id answers. Runs from
// /api/cron/models (vercel.json, the 1st of every second month) and from the
// admin page's Check now. Every outcome lands on the role's ModelChoice row,
// so the admin page shows what the last run found.
//
// A family is the model's product line at the same shape as the role's
// current id: claude-<name>-<version> for Anthropic, kimi-k<version> for
// Moonshot, gemini-<version>-flash for Google. A differently shaped id — a
// -thinking, -lite, -preview, or dated variant — is another product, and the
// job never moves a role to one on its own.

export type RoleUpdate = {
  role: ModelRole;
  provider: string;
  before: string;
  after: string;
  changed: boolean;
  note: string;
};

// A parsed id: the family it belongs to and its version, newest last.
type Parsed = { family: string; version: number[]; date: string };

function parseClaude(id: string): Parsed | null {
  if (!id.startsWith("claude-")) return null;
  const alpha: string[] = [];
  const version: number[] = [];
  let date = "";
  for (const token of id.slice("claude-".length).split("-")) {
    if (/^\d{8}$/.test(token)) date = token;
    else if (/^\d+$/.test(token)) version.push(Number(token));
    else if (/^[a-z]+$/.test(token)) alpha.push(token);
    else return null;
  }
  if (alpha.length === 0 || version.length === 0) return null;
  return { family: alpha.join("-"), version, date };
}

function parseKimi(id: string): Parsed | null {
  const m = /^kimi-k(\d+)(?:\.(\d+))?$/.exec(id);
  if (!m) return null;
  return { family: "kimi-k", version: [Number(m[1]), Number(m[2] ?? 0)], date: "" };
}

function parseGemini(id: string): Parsed | null {
  const m = /^gemini-(\d+)(?:\.(\d+))?-flash$/.exec(id);
  if (!m) return null;
  return { family: "gemini-flash", version: [Number(m[1]), Number(m[2] ?? 0)], date: "" };
}

const PARSERS: Record<ModelRole, (id: string) => Parsed | null> = {
  claude: parseClaude,
  kimi: parseKimi,
  gemini: parseGemini,
};

/** Positive when a is newer than b: version numbers first, then the date. */
function compare(a: Parsed, b: Parsed): number {
  const n = Math.max(a.version.length, b.version.length);
  for (let i = 0; i < n; i++) {
    const d = (a.version[i] ?? 0) - (b.version[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.date.localeCompare(b.date);
}

/** The newest id of the current id's family among `ids`, when it is newer
    than the current id; null otherwise. Exported for the QA script. */
export function newestInFamily(role: ModelRole, current: string, ids: string[]): string | null {
  const parse = PARSERS[role];
  const base = parse(current);
  if (!base) return null;
  let best: { id: string; parsed: Parsed } | null = null;
  for (const id of ids) {
    const parsed = parse(id);
    if (!parsed || parsed.family !== base.family) continue;
    if (compare(parsed, base) <= 0) continue;
    if (!best || compare(parsed, best.parsed) > 0) best = { id, parsed };
  }
  return best?.id ?? null;
}

// ── The providers' published lists ─────────────────────────────────────────

async function listKimi(): Promise<string[]> {
  const res = await outboundFetch(`${kimiBaseUrl()}/models`, {
    headers: { Authorization: `Bearer ${kimiApiKey() ?? ""}` },
  });
  if (!res.ok) throw new Error(`model list failed (${res.status})`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  return (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
}

async function listClaude(): Promise<string[]> {
  const ids: string[] = [];
  let after = "";
  for (let page = 0; page < 20; page++) {
    const url = `${claudeBaseUrl()}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
    const res = await outboundFetch(url, {
      headers: { "x-api-key": claudeApiKey() ?? "", "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) throw new Error(`model list failed (${res.status})`);
    const body = (await res.json()) as {
      data?: { id?: string }[];
      has_more?: boolean;
      last_id?: string;
    };
    ids.push(...(body.data ?? []).map((m) => m.id ?? "").filter(Boolean));
    if (!body.has_more || !body.last_id) break;
    after = body.last_id;
  }
  return ids;
}

async function listGemini(): Promise<string[]> {
  const key = process.env.GEMINI_API_KEY ?? "";
  const ids: string[] = [];
  let token = "";
  for (let page = 0; page < 20; page++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
    const res = await outboundFetch(url, { headers: { "x-goog-api-key": key } });
    if (!res.ok) throw new Error(`model list failed (${res.status})`);
    const body = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const m of body.models ?? []) {
      if (!m.name || !(m.supportedGenerationMethods ?? []).includes("generateContent")) continue;
      ids.push(m.name.replace(/^models\//, ""));
    }
    if (!body.nextPageToken) break;
    token = body.nextPageToken;
  }
  return ids;
}

const LISTS: Record<ModelRole, () => Promise<string[]>> = {
  kimi: listKimi,
  claude: listClaude,
  gemini: listGemini,
};

const CONFIGURED: Record<ModelRole, () => boolean> = {
  kimi: kimiConfigured,
  claude: claudeConfigured,
  gemini: () => Boolean(process.env.GEMINI_API_KEY),
};

// ── The probe: one short call on the candidate before the role moves ───────

const PROBE_PROMPT = "Reply with the word OK.";

async function probe(role: ModelRole, id: string): Promise<void> {
  const usage = { userId: null, feature: "model-update", model: id };
  if (role === "gemini") {
    const res = await outboundFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: PROBE_PROMPT }] }],
          generationConfig: { maxOutputTokens: 64 },
        }),
      },
    );
    if (!res.ok) throw new Error(`probe failed (${res.status})`);
    return;
  }
  // The candidate is not a role's default, so the client calls it as written.
  const result = await generateText({
    model: role === "kimi" ? await kimi(id) : await claude(id),
    maxOutputTokens: 16384, // a reasoning model counts its reasoning here
    providerOptions: role === "kimi" ? kimiOptions("low") : claudeOptions("low"),
    prompt: PROBE_PROMPT,
  });
  recordUsage(usage, sdkTokens(result.usage));
}

// ── The run ────────────────────────────────────────────────────────────────

async function updateRole(role: ModelRole): Promise<RoleUpdate> {
  const provider = MODEL_ROLES[role].provider;
  const before = await currentModelId(role);
  const now = new Date();
  const finish = async (after: string, note: string): Promise<RoleUpdate> => {
    const changed = after !== before;
    await db.modelChoice.upsert({
      where: { role },
      create: {
        role,
        modelId: after,
        previousModelId: changed ? before : "",
        checkedAt: now,
        changedAt: changed ? now : null,
        note,
      },
      update: {
        modelId: after,
        checkedAt: now,
        note,
        ...(changed ? { previousModelId: before, changedAt: now } : {}),
      },
    });
    console.log(`[models] ${role}: ${note}`);
    return { role, provider, before, after, changed, note };
  };

  if (!CONFIGURED[role]()) return finish(before, "Key not set; nothing checked.");
  let ids: string[];
  try {
    ids = await LISTS[role]();
  } catch (err) {
    return finish(before, `Model list not read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const candidate = newestInFamily(role, before, ids);
  if (!candidate) return finish(before, `Newest of its family among ${ids.length} published models.`);
  try {
    await probe(role, candidate);
  } catch (err) {
    return finish(
      before,
      `${candidate} is published but did not answer the probe: ${err instanceof Error ? err.message : String(err)}. Kept ${before}.`,
    );
  }
  return finish(candidate, `Updated from ${before}: the newest of its family among ${ids.length} published models.`);
}

/** Check every role and move the ones with a newer version. Never throws:
    a role's failure is its note. */
export async function updateModels(): Promise<RoleUpdate[]> {
  const results: RoleUpdate[] = [];
  for (const role of ROLE_ORDER) {
    try {
      results.push(await updateRole(role));
    } catch (err) {
      const before = await currentModelId(role);
      results.push({
        role,
        provider: MODEL_ROLES[role].provider,
        before,
        after: before,
        changed: false,
        note: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  forgetModelChoices();
  return results;
}

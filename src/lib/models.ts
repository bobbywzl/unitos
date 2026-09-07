import { CLAUDE_FABLE_5_1, GEMINI_FLASH, KIMI_K3 } from "@/lib/derive/config";
import { db } from "@/lib/db";

// The model per role (SPEC.md §2). Each role has a default id, the constant
// in lib/derive/config.ts, and may have a ModelChoice row: the newest version
// of that family as the provider's model list publishes it, written by the
// bimonthly model update (lib/models/update.ts, /api/cron/models). The
// clients call resolveModelId on every call, so a default id follows the
// row; an id that is not a role's default is called as written.

export type ModelRole = "kimi" | "claude" | "gemini";

export const MODEL_ROLES: Record<ModelRole, { provider: string; defaultId: string }> = {
  kimi: { provider: "Moonshot AI", defaultId: KIMI_K3 },
  claude: { provider: "Anthropic", defaultId: CLAUDE_FABLE_5_1 },
  gemini: { provider: "Google", defaultId: GEMINI_FLASH },
};

export const ROLE_ORDER: ModelRole[] = ["kimi", "claude", "gemini"];

/** The role whose default this id is, or null. */
export function roleOfDefault(modelId: string): ModelRole | null {
  for (const role of ROLE_ORDER) if (MODEL_ROLES[role].defaultId === modelId) return role;
  return null;
}

// The rows, read once per process and again after CACHE_MS. A database
// failure leaves the defaults standing: a model call must never fail on the
// registry.
const CACHE_MS = 5 * 60 * 1000;
let cache: { ids: Partial<Record<ModelRole, string>>; loadedAt: number } | null = null;
let loading: Promise<void> | null = null;

async function loadChoices(): Promise<void> {
  try {
    const rows = await db.modelChoice.findMany({ select: { role: true, modelId: true } });
    const ids: Partial<Record<ModelRole, string>> = {};
    for (const row of rows) {
      if (row.role in MODEL_ROLES && row.modelId.trim()) ids[row.role as ModelRole] = row.modelId.trim();
    }
    cache = { ids, loadedAt: Date.now() };
  } catch (err) {
    console.warn("[models] model choices not read; defaults stand:", err);
    cache = { ids: cache?.ids ?? {}, loadedAt: Date.now() };
  }
}

async function choices(): Promise<Partial<Record<ModelRole, string>>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.ids;
  loading ??= loadChoices().finally(() => {
    loading = null;
  });
  await loading;
  return cache?.ids ?? {};
}

/** The id the role calls now: its row, or its default. */
export async function currentModelId(role: ModelRole): Promise<string> {
  return (await choices())[role] ?? MODEL_ROLES[role].defaultId;
}

/** A default id becomes the role's current id; any other id stays. */
export async function resolveModelId(modelId: string): Promise<string> {
  const role = roleOfDefault(modelId);
  return role ? currentModelId(role) : modelId;
}

/** Drop the cached rows: the next call reads the table again. The update
    job calls this after a write, so the same process calls the new id. */
export function forgetModelChoices(): void {
  cache = null;
}

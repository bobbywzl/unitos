import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { gatewayAdminKey, gatewayBaseUrl, gatewayKey } from "@/lib/gateway";
import {
  gatewayErrorMessage,
  gatewayKeyInfo,
  gatewayModels,
  gatewayReadiness,
  gatewayRouter,
  gatewaySpend,
  gatewayTagSpend,
  type GatewayKeyInfo,
  type GatewayModel,
  type GatewayReadiness,
  type GatewayRouter,
  type GatewaySpend,
  type GatewayTagSpend,
} from "@/lib/gateway-admin";
import { serverT } from "@/lib/i18n/server";
import { currentModelId, MODEL_ROLES, ROLE_ORDER } from "@/lib/models";
import { AdminNav } from "@/components/admin/admin-nav";
import { BarList, DailyChart, fmtTok, fmtUsd, Tile } from "@/components/admin/charts";
import { GatewayHealth } from "@/components/admin/gateway-health";
import { GatewayKey } from "@/components/admin/gateway-key";

export const dynamic = "force-dynamic";

// Admin: the AI gateway (SPEC.md §2) — whether it answers, the models it
// routes with their limits and prices, the fallbacks, the app key's limits
// and spend, and the gateway's own spend by day, model, provider, function,
// and account. Every figure is read from the gateway's management API
// (lib/gateway-admin.ts) with the master key.

type Fetched<T> = { ok: true; data: T } | { ok: false; error: string };

async function fetched<T>(run: () => Promise<T>): Promise<Fetched<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    return { ok: false, error: gatewayErrorMessage(err) };
  }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card px-4 py-3 shadow-soft">
      <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{title}</p>
      {children}
    </section>
  );
}

function Failed({ error }: { error: string }) {
  return <p className="py-1 text-xs text-red-600">{error}</p>;
}

const fmtPerM = (v: number | null) => (v === null ? "—" : `$${v >= 1 ? v.toFixed(2) : v.toFixed(3)}`);
const fmtLimit = (v: number | null) => (v === null ? "—" : v.toLocaleString());

export default async function AdminGatewayPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  const base = gatewayBaseUrl();
  const appKey = Boolean(gatewayKey());
  const adminKey = Boolean(gatewayAdminKey());

  const setupSteps = [
    t("admin.gatewaySetup1"),
    t("admin.gatewaySetup2"),
    t("admin.gatewaySetup3"),
    t("admin.gatewaySetup4"),
    t("admin.gatewaySetup5"),
  ];

  if (!base) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <AdminNav active="gateway" />
        <header className="mb-6">
          <h1 className="text-[28px]">{t("admin.gateway")}</h1>
          <p className="text-sm text-sand-600">{t("admin.gatewayDesc")}</p>
        </header>
        <Card title={t("admin.gatewaySetup")}>
          <p className="py-1 text-sm text-sand-700">{t("admin.gatewayNotSet")}</p>
          <ol className="list-decimal space-y-1 py-2 pl-5 text-sm text-sand-700">
            {setupSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="border-t border-line py-2 text-xs text-sand-600">{t("admin.envHint")}</p>
        </Card>
      </main>
    );
  }

  const [readiness, models, router, keyInfo, spend, tags, users] = await Promise.all([
    fetched<GatewayReadiness>(gatewayReadiness),
    adminKey ? fetched<GatewayModel[]>(gatewayModels) : null,
    adminKey ? fetched<GatewayRouter>(gatewayRouter) : null,
    adminKey && appKey ? fetched<GatewayKeyInfo>(gatewayKeyInfo) : null,
    adminKey ? fetched<GatewaySpend>(() => gatewaySpend(30)) : null,
    adminKey ? fetched<GatewayTagSpend>(() => gatewayTagSpend(30)) : null,
    db.user.findMany({ select: { id: true, email: true } }),
  ]);
  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  // The gateway's model list expands each wildcard into every model of that
  // provider it knows a price for, some under bare ids. The table shows the
  // ones the app calls: each role's current id under its provider's prefix,
  // plus the audio models; the rest is one count.
  const prefixOf: Record<string, string> = { "Z.ai": "zai", "Moonshot AI": "moonshot", Anthropic: "anthropic", Google: "gemini" };
  const appModels = new Set<string>();
  for (const role of ROLE_ORDER) {
    appModels.add(`${prefixOf[MODEL_ROLES[role].provider]}/${await currentModelId(role)}`);
  }
  appModels.add("gemini/gemini-flash-latest");
  const shownModels = models?.ok
    ? models.data.filter((m) => appModels.has(m.name) || /^(groq|openai)\//.test(m.name))
    : [];
  const otherModels = models?.ok ? models.data.length - shownModels.length : 0;
  const accountLabel = (id: string) =>
    emailOf.get(id) ?? (id === "user-1" ? t("admin.localReader") : id);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <AdminNav active="gateway" />
      <header className="mb-6">
        <h1 className="text-[28px]">{t("admin.gateway")}</h1>
        <p className="text-sm text-sand-600">{t("admin.gatewayDesc")}</p>
      </header>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label={t("admin.gatewayStatus")}
            value={readiness.ok ? readiness.data.status : t("admin.gatewayUnreachable")}
          />
          <Tile label={t("admin.gatewayVersion")} value={readiness.ok && readiness.data.version ? readiness.data.version : "—"} />
          <Tile label={t("admin.gatewayDb")} value={readiness.ok ? readiness.data.db : "—"} />
          <Tile
            label={t("admin.gatewayKeys")}
            value={`${appKey ? t("admin.svcSet") : t("admin.svcNotSet")} · ${adminKey ? t("admin.svcSet") : t("admin.svcNotSet")}`}
          />
        </div>
        {!readiness.ok && <Failed error={readiness.error} />}

        {!adminKey && (
          <Card title={t("admin.gatewaySetup")}>
            <p className="py-1 text-sm text-sand-700">{t("admin.gatewayNoAdminKey")}</p>
            <ol className="list-decimal space-y-1 py-2 pl-5 text-sm text-sand-700">
              {setupSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Card>
        )}

        {adminKey && (
          <Card title={t("admin.gatewayAppKey")}>
            {!appKey && <p className="py-1 text-sm text-sand-700">{t("admin.gatewayNoAppKey")}</p>}
            {keyInfo && !keyInfo.ok && <Failed error={keyInfo.error} />}
            {keyInfo?.ok && (
              <div className="grid grid-cols-2 gap-3 py-1 sm:grid-cols-4">
                <Tile label={t("admin.gatewayKeySpend")} value={fmtUsd(keyInfo.data.spend)} />
                <Tile
                  label={t("admin.gatewayKeyBudget")}
                  value={
                    keyInfo.data.maxBudget === null
                      ? t("admin.gatewayNoLimit")
                      : `${fmtUsd(keyInfo.data.maxBudget)}${keyInfo.data.budgetDuration ? ` / ${keyInfo.data.budgetDuration}` : ""}`
                  }
                />
                <Tile label={t("admin.gatewayKeyRpm")} value={fmtLimit(keyInfo.data.rpm)} />
                <Tile label={t("admin.gatewayKeyTpm")} value={fmtLimit(keyInfo.data.tpm)} />
              </div>
            )}
            {keyInfo?.ok && keyInfo.data.blocked && (
              <p className="py-1 text-xs text-red-600">{t("admin.gatewayKeyBlocked")}</p>
            )}
            <GatewayKey
              exists={appKey}
              initial={
                keyInfo?.ok
                  ? {
                      rpm: keyInfo.data.rpm,
                      tpm: keyInfo.data.tpm,
                      maxBudget: keyInfo.data.maxBudget,
                      budgetDuration: keyInfo.data.budgetDuration,
                    }
                  : { rpm: null, tpm: null, maxBudget: null, budgetDuration: null }
              }
            />
          </Card>
        )}

        {adminKey && (
          <Card title={t("admin.gatewayModels")}>
            {models && !models.ok && <Failed error={models.error} />}
            {models?.ok && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                      <th className="py-2 font-semibold">{t("admin.gatewayColModel")}</th>
                      <th className="px-3 py-2 font-semibold">{t("admin.gatewayColUpstream")}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t("admin.gatewayColRpm")}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t("admin.gatewayColTpm")}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t("admin.gatewayColIn")}</th>
                      <th className="py-2 text-right font-semibold">{t("admin.gatewayColOut")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shownModels.map((m) => (
                      <tr key={`${m.name}-${m.upstream}`}>
                        <td className="py-2 font-mono text-sand-800">{m.name}</td>
                        <td className="px-3 py-2 font-mono text-sand-600">{m.upstream}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtLimit(m.rpm)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtLimit(m.tpm)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtPerM(m.inputPerM)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtPerM(m.outputPerM)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[10px] text-sand-500">
                  {t("admin.gatewayPriceNote")}
                  {otherModels > 0 && ` ${t("admin.gatewayOtherModels", { n: otherModels })}`}
                </p>
              </div>
            )}
            <div className="mt-2 border-t border-line pt-2">
              <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                {t("admin.gatewayFallbacks")}
              </p>
              {router && !router.ok && <Failed error={router.error} />}
              {router?.ok && router.data.fallbacks.length === 0 && (
                <p className="py-1 text-xs text-sand-500">{t("admin.gatewayFallbackNone")}</p>
              )}
              {router?.ok &&
                router.data.fallbacks.map((f) => (
                  <p key={f.from} className="py-0.5 font-mono text-xs text-sand-800">
                    {f.from} → {f.to.join(", ")}
                  </p>
                ))}
              {router?.ok && (
                <p className="py-1 text-xs text-sand-500">
                  {t("admin.gatewayRetries", {
                    n: router.data.retries ?? 0,
                    s: router.data.timeoutSeconds ?? "—",
                  })}
                </p>
              )}
            </div>
            <GatewayHealth />
          </Card>
        )}

        {adminKey && spend && !spend.ok && <Failed error={spend.error} />}
        {adminKey && spend?.ok && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label={t("admin.gatewaySpend30")} value={fmtUsd(spend.data.totalUsd)} />
              <Tile label={t("admin.gatewayRequests")} value={spend.data.requests.toLocaleString()} />
              <Tile label={t("admin.gatewayFailed")} value={spend.data.failed.toLocaleString()} />
              <Tile label={t("admin.usageTokensIn")} value={fmtTok(spend.data.inputTokens)} />
              <Tile label={t("admin.usageTokensOut")} value={fmtTok(spend.data.outputTokens)} />
              <Tile label={t("admin.usageCacheRead")} value={fmtTok(spend.data.cacheReadTokens)} />
            </div>
            <DailyChart title={t("admin.gatewayDaily")} days={spend.data.days} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <BarList t={t} title={t("admin.usageByProvider")} rows={spend.data.byProvider} />
              <BarList t={t} title={t("admin.usageByModel")} rows={spend.data.byModel} />
              {tags?.ok && <BarList t={t} title={t("admin.usageByFunction")} rows={tags.data.byFeature} />}
            </div>
            {tags && !tags.ok && <Failed error={tags.error} />}
            {tags?.ok && (
              <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
                <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                  {t("admin.usageByUser")}
                </p>
                {tags.data.byUser.length === 0 ? (
                  <p className="text-xs text-sand-500">{t("admin.gatewayNoTagged")}</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                        <th className="py-2 font-semibold">{t("admin.usageColAccount")}</th>
                        <th className="px-3 py-2 text-right font-semibold">{t("admin.usageColCalls")}</th>
                        <th className="px-3 py-2 text-right font-semibold">{t("admin.gatewayColTokens")}</th>
                        <th className="py-2 text-right font-semibold">{t("admin.usageColCost")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {tags.data.byUser.map((r) => (
                        <tr key={r.label}>
                          <td className="max-w-[240px] truncate py-2 text-sand-800">{accountLabel(r.label)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.calls.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtTok(r.tokens)}</td>
                          <td className="py-2 text-right font-semibold tabular-nums">{fmtUsd(r.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { authEnabled } from "@/lib/auth";
import { gatewayAdminKey, gatewayConfigured, providerKey } from "@/lib/gateway";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { recipientAccounts } from "@/lib/notifications";
import { AdminNav } from "@/components/admin/admin-nav";
import { FeatureModels } from "@/components/admin/feature-models";
import { FeedbackInbox } from "@/components/admin/feedback-inbox";
import { ModelCheck } from "@/components/admin/model-check";
import { FEATURE_DEFAULTS, FEATURE_ORDER, type Feature } from "@/lib/feature-models";
import { MODEL_ROLES, ROLE_ORDER } from "@/lib/models";

export const dynamic = "force-dynamic";

// Admin: feedback inbox with new → seen → resolved triage (release-edu pattern)
// and Reply, which reaches the account that sent the feedback as a
// notification (SPEC.md §18).
export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  const [feedback, accounts, modelRows, featureRows] = await Promise.all([
    db.feedback.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        replies: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            body: true,
            createdAt: true,
            recipients: { select: { dismissedAt: true } },
          },
        },
      },
    }),
    recipientAccounts(),
    db.modelChoice.findMany(),
    db.featureModel.findMany(),
  ]);
  // The model per role (lib/models.ts): the constant, the id called now,
  // and what the last model update found.
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const models = ROLE_ORDER.map((role) => {
    const row = modelRows.find((r) => r.role === role);
    return {
      role,
      provider: MODEL_ROLES[role].provider,
      defaultId: MODEL_ROLES[role].defaultId,
      modelId: row?.modelId ?? MODEL_ROLES[role].defaultId,
      previousModelId: row?.previousModelId ?? "",
      checkedAt: row ? fmtDate(row.checkedAt) : null,
      changedAt: row?.changedAt ? fmtDate(row.changedAt) : null,
      note: row?.note ?? "",
    };
  });
  // The model per feature (lib/feature-models.ts): the row the admin set, or
  // the default. The label is the function's name on the usage page.
  const featureLabels: Record<Feature, string> = {
    explain: t("admin.featExplain"),
    simplify: t("admin.featSimplify"),
    salience: t("admin.featSalience"),
    extract: t("admin.featExtract"),
    distill: t("admin.featDistill"),
    summarize: t("admin.featSummarize"),
    compare: t("admin.featCompare"),
    analyze: t("admin.featAnalyze"),
    visualize: t("admin.featVisualize"),
    voice: t("admin.featVoice"),
    find: t("admin.featFind"),
    ask: t("admin.featAsk"),
    formalize: t("admin.featFormalize"),
    assistant: t("admin.featAssistant"),
    act: t("admin.featAct"),
    web: t("admin.featWeb"),
    vision: t("admin.featVision"),
    "svg-chart": t("admin.featSvgChart"),
    stitch: t("admin.featStitch"),
    "stitch-select": t("admin.featStitchSelect"),
    merge: t("admin.featMerge"),
    gist: t("admin.featGist"),
    log: t("admin.featLog"),
    glossary: t("admin.featGlossary"),
    contents: t("admin.featContents"),
    skeleton: t("admin.featSkeleton"),
    connect: t("admin.featConnect"),
    parse: t("admin.featParse"),
    classify: t("admin.featClassify"),
    convert: t("admin.featConvert"),
  };
  const features = FEATURE_ORDER.map((feature) => {
    const row = featureRows.find((r) => r.feature === feature);
    return {
      feature,
      label: featureLabels[feature],
      modelId: row?.modelId ?? FEATURE_DEFAULTS[feature],
      defaultId: FEATURE_DEFAULTS[feature],
    };
  });
  // The models a feature can pick: every role's default id but Gemini's,
  // which no chat call takes. A role's default id follows the role.
  const featureOptions = ROLE_ORDER.filter((role) => role !== "gemini").map((role) => ({
    id: MODEL_ROLES[role].defaultId,
    name: MODEL_ROLES[role].name,
    provider: MODEL_ROLES[role].provider,
  }));
  // The account that sent each feedback, by name. The admin's view of accounts
  // is names and emails (lib/notifications.ts) — enough to reply.
  const nameOf = new Map(accounts.map((a) => [a.id, a.name || t("admin.localReader")]));

  // Status only — values never leave the server. Operator concern, so it lives
  // here, not in reader Settings. Under the gateway (SPEC.md §2) the provider
  // keys live on the gateway, so their rows say so instead of Not set.
  const gateway = gatewayConfigured();
  const viaGateway = (set: boolean): "set" | "gateway" | "unset" =>
    set ? "set" : gateway ? "gateway" : "unset";
  const services: { label: string; description: string; state: "set" | "gateway" | "unset" }[] = [
    {
      label: "LITELLM_BASE_URL + LITELLM_API_KEY",
      description: t("admin.svcGateway"),
      state: gateway ? "set" : "unset",
    },
    { label: "LITELLM_ADMIN_KEY", description: t("admin.svcGatewayAdmin"), state: gatewayAdminKey() ? "set" : "unset" },
    { label: "ZAI_API_KEY", description: t("admin.svcGlm"), state: gateway ? "gateway" : "unset" },
    { label: "MOONSHOT_API_KEY", description: t("admin.svcKimi"), state: viaGateway(Boolean(providerKey("moonshot"))) },
    { label: "ANTHROPIC_API_KEY", description: t("admin.svcClaude"), state: viaGateway(Boolean(providerKey("anthropic"))) },
    { label: "GEMINI_API_KEY", description: t("admin.svcGemini"), state: viaGateway(Boolean(providerKey("gemini"))) },
    {
      label: "DEEPGRAM_API_KEY · GROQ_API_KEY · OPENAI_API_KEY",
      description: t("admin.svcTranscribe"),
      state: viaGateway(["deepgram", "groq", "openai"].some((p) => providerKey(p as "deepgram" | "groq" | "openai"))),
    },
    { label: "DEEPL_API_KEY", description: t("admin.svcDeepl"), state: viaGateway(Boolean(providerKey("deepl"))) },
    { label: "SESSION_SECRET + provider", description: t("admin.svcSignIn"), state: authEnabled() ? "set" : "unset" },
    { label: "ADMIN_PASSWORD", description: t("admin.svcAdmin"), state: process.env.ADMIN_PASSWORD ? "set" : "unset" },
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <AdminNav active="feedback" />
      <section className="mb-8">
        <h2 className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("admin.services")}
        </h2>
        <div className="rounded-2xl bg-card px-4 py-2 shadow-soft">
          {services.map((svc) => (
            <div key={svc.label} className="flex items-center justify-between gap-4 py-2">
              <div>
                <div className="font-mono text-sm">{svc.label}</div>
                <div className="text-xs text-sand-600">{svc.description}</div>
              </div>
              <span
                className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
                  svc.state === "unset" ? "bg-sand-200 text-sand-600" : "bg-sage-200 text-sage-800"
                }`}
              >
                {svc.state === "set"
                  ? t("admin.svcSet")
                  : svc.state === "gateway"
                    ? t("admin.svcViaGateway")
                    : t("admin.svcNotSet")}
              </span>
            </div>
          ))}
          <p className="border-t border-line py-2 text-xs text-sand-600">{t("admin.envHint")}</p>
        </div>
      </section>
      <section className="mb-8">
        <h2 className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("admin.models")}
        </h2>
        <div className="rounded-2xl bg-card px-4 py-2 shadow-soft">
          <p className="py-2 text-xs text-sand-600">{t("admin.modelsDesc")}</p>
          {models.map((m) => (
            <div key={m.role} className="flex flex-col gap-0.5 border-t border-line py-2">
              <div className="flex items-center justify-between gap-4">
                <div className="font-mono text-sm">{m.modelId}</div>
                <span className="text-xs text-sand-600">{m.provider}</span>
              </div>
              <div className="text-xs text-sand-600">
                {m.modelId !== m.defaultId && `${t("admin.modelDefault", { id: m.defaultId })} · `}
                {m.checkedAt
                  ? t("admin.modelChecked", { date: m.checkedAt })
                  : t("admin.modelNotChecked")}
                {m.changedAt &&
                  ` · ${t("admin.modelChanged", { date: m.changedAt, from: m.previousModelId })}`}
              </div>
              {m.note && <div className="text-xs text-sand-500">{m.note}</div>}
            </div>
          ))}
          <ModelCheck />
        </div>
      </section>
      <section className="mb-8">
        <h2 className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("admin.featureModels")}
        </h2>
        <div className="rounded-2xl bg-card px-4 py-2 shadow-soft">
          <p className="py-2 text-xs text-sand-600">{t("admin.featureModelsDesc")}</p>
          <FeatureModels features={features} options={featureOptions} />
        </div>
      </section>
      <FeedbackInbox
        items={feedback.map((f) => ({
          id: f.id,
          category: f.category,
          message: f.message,
          images: f.images,
          links: f.links,
          page: f.page,
          userAgent: f.userAgent,
          status: f.status,
          createdAt: f.createdAt.toISOString(),
          account: f.userId ? (nameOf.get(f.userId) ?? null) : null,
          replies: f.replies.map((r) => ({
            id: r.id,
            body: r.body,
            createdAt: r.createdAt.toISOString(),
            dismissed: r.recipients.some((x) => x.dismissedAt !== null),
          })),
        }))}
      />
    </main>
  );
}

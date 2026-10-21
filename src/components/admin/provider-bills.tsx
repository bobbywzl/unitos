import type { TFunc } from "@/lib/i18n/dictionaries";
import { BALANCE_LOW_USD, BALANCE_OUT_USD, type MoonshotBalance, type ProviderBill, type SpendRow } from "@/lib/provider-bills";
import { fmtTok, fmtUsd } from "@/components/admin/charts";

// Provider bills (SPEC.md §7): one card per provider with the provider's
// own bill for the last 30 days beside this app's count, and the gap. The
// bill is every use of the key, in this app and outside it, at what the
// provider charged; the count is this app's calls at list prices. Under
// the cards, each provider whose bill is read by model gets a table of
// the bill against the count, model by model: a model this app never
// calls is another use of the key, and a gap on a model it calls is a
// price difference.

export type ProviderCard = {
  provider: string;
  name: string;
  console: string | null;
  app: { costUsd: number; tokens: number; calls: number; byModel: SpendRow[] };
  // The bill: read, failed to read, or none (noApi says why).
  bill: { ok: true; data: ProviderBill } | { ok: false; error: string } | null;
  noApi: "bundle" | "none" | "setKey" | "noRows" | null;
  balance: MoonshotBalance | null;
  // The bill is the balance's falls between readings, not a spend log.
  fromBalance: boolean;
};

export function ProviderBills({ t, cards }: { t: TFunc; cards: ProviderCard[] }) {
  const tables = cards.filter((c) => c.bill?.ok && c.bill.data.byModel.length > 0);
  return (
    <div id="bills" className="mb-4 space-y-4">
      <div>
        <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{t("admin.usageBills")}</p>
        <p className="text-xs text-sand-500">{t("admin.usageBillsHint")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <BillCard key={c.provider} t={t} card={c} />
        ))}
      </div>
      {tables.map((c) => (
        <ByModelTable key={c.provider} t={t} card={c} />
      ))}
    </div>
  );
}

function BillCard({ t, card }: { t: TFunc; card: ProviderCard }) {
  const bill = card.bill?.ok ? card.bill.data.totalUsd : null;
  const balance = card.balance;
  const out = balance !== null && balance.availableUsd <= BALANCE_OUT_USD;
  const low = balance !== null && !out && balance.availableUsd < BALANCE_LOW_USD;
  const line = "flex items-baseline justify-between gap-2 text-xs";
  return (
    <div className="rounded-2xl bg-card px-4 py-3 shadow-soft">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{card.name}</p>
        {card.console && (
          <a href={card.console} target="_blank" rel="noreferrer" className="text-[11px] text-sand-500 underline hover:text-clay-800">
            {t("admin.usageConsole")}
          </a>
        )}
      </div>
      <div className="space-y-1">
        <p className={line}>
          <span className="text-sand-500">{t("admin.usageBillCol")}</span>
          <span className="font-semibold tabular-nums text-sand-800">{bill === null ? "—" : fmtUsd(bill)}</span>
        </p>
        <p className={line}>
          <span className="text-sand-500">{t("admin.usageBillApp")}</span>
          <span className="tabular-nums text-sand-800">{fmtUsd(card.app.costUsd)}</span>
        </p>
        {bill !== null && (
          <p className={line}>
            <span className="text-sand-500">{t("admin.usageBillGap")}</span>
            <span className={`tabular-nums ${bill - card.app.costUsd > 0.5 ? "text-red-600" : "text-sand-800"}`}>{fmtUsd(bill - card.app.costUsd)}</span>
          </p>
        )}
        <p className={line}>
          <span className="text-sand-500">{t("admin.usageBillCalls")}</span>
          <span className="tabular-nums text-sand-800">{t("admin.usageDetail", { tokens: fmtTok(card.app.tokens), calls: card.app.calls.toLocaleString() })}</span>
        </p>
        {balance !== null && (
          <p className={line}>
            <span className="text-sand-500">{t("admin.usageBalance")}</span>
            <span className={`font-semibold tabular-nums ${out ? "text-red-600" : low ? "text-amber-700" : "text-sand-800"}`}>
              {balance.availableUsd < 0 ? `−${fmtUsd(-balance.availableUsd)}` : fmtUsd(balance.availableUsd)}
            </span>
          </p>
        )}
      </div>
      {out && <p className="mt-2 text-xs font-semibold text-red-600">{t("admin.usageBalanceOut")}</p>}
      {low && <p className="mt-2 text-xs text-amber-700">{t("admin.usageBalanceLow")}</p>}
      {card.bill && !card.bill.ok && <p className="mt-2 text-xs text-red-600">{card.bill.error}</p>}
      {card.fromBalance && bill !== null && <p className="mt-2 text-xs text-sand-500">{t("admin.usageBillFromBalance")}</p>}
      {card.noApi === "bundle" && <p className="mt-2 text-xs text-sand-500">{t("admin.usageBundle")}</p>}
      {card.noApi === "none" && <p className="mt-2 text-xs text-sand-500">{t("admin.usageBillNoApi")}</p>}
      {card.noApi === "setKey" && <p className="mt-2 text-xs text-sand-500">{t("admin.usageBillSetKey")}</p>}
      {card.noApi === "noRows" && <p className="mt-2 text-xs text-sand-500">{t("admin.usageBillNoRows")}</p>}
    </div>
  );
}

function ByModelTable({ t, card }: { t: TFunc; card: ProviderCard }) {
  if (!card.bill?.ok) return null;
  const app = new Map(card.app.byModel.map((r) => [r.label, r.costUsd]));
  const billed = new Map(card.bill.data.byModel.map((r) => [r.label, r.costUsd]));
  const labels = [...new Set([...billed.keys(), ...app.keys()])];
  const rows = labels
    .map((label) => ({ label, bill: billed.get(label) ?? 0, app: app.get(label) ?? 0 }))
    .sort((a, b) => b.bill - a.bill - (a.app - b.app));
  return (
    <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
      <p className="mb-1 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
        {card.name} · {t("admin.usageOtherUses")}
      </p>
      <p className="mb-2 text-xs text-sand-500">{t("admin.usageOtherUsesHint")}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
            <th className="py-2 font-semibold">{t("admin.usageColModel")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("admin.usageBillCol")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("admin.usageBillApp")}</th>
            <th className="py-2 text-right font-semibold">{t("admin.usageBillGap")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-2 font-mono text-sand-800">{r.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.bill)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.app)}</td>
              <td className={`py-2 text-right tabular-nums ${r.app === 0 && r.bill > 0 ? "text-red-600" : ""}`}>{fmtUsd(r.bill - r.app)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import type { Lang } from "@/lib/i18n/config";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

// Money and dates as the billing pages show them. Amounts are minor units
// and an ISO currency code, as Stripe reports them. No server imports: the
// client components format the same way.

// Currencies Stripe bills in whole units (no minor units).
const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "clp", "isk", "huf", "twd", "ugx"]);

export function formatMoney(amount: number, currency: string, lang: Lang): string {
  const code = currency.toUpperCase();
  const value = ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : amount / 100;
  try {
    return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `${value} ${code}`;
  }
}

// UTC on both server and client, so the first render matches.
export function formatDate(date: string | Date, lang: Lang): string {
  return new Date(date).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** What a plan sells at, as the pages show it (lib/billing/plans.ts Plan). */
export type PlanPrice = { amount: number | null; currency: string; interval: string; intervalCount: number };

function intervalKey(interval: string): TKey {
  switch (interval) {
    case "day":
      return "billing.intervalDay";
    case "week":
      return "billing.intervalWeek";
    case "year":
      return "billing.intervalYear";
    default:
      return "billing.intervalMonth";
  }
}

/** The price line: "$8.00 / month", "$80.00 / 12 months". */
export function priceLine(t: TFunc, lang: Lang, price: PlanPrice): string {
  if (price.amount === null) return t("billing.priceUnset");
  const money = formatMoney(price.amount, price.currency, lang);
  const interval = t(intervalKey(price.interval));
  return price.intervalCount === 1
    ? t("billing.priceInterval", { price: money, interval })
    : t("billing.priceIntervalN", { price: money, n: price.intervalCount, interval });
}

/** The renewal line on the order page. */
export function renewsLine(t: TFunc, price: PlanPrice): string {
  const interval = t(intervalKey(price.interval));
  return price.intervalCount === 1
    ? t("billing.orderRenews", { interval })
    : t("billing.orderRenewsN", { n: price.intervalCount, interval });
}

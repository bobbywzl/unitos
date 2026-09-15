"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LangSwitcher } from "@/components/lang-switcher";
import { useT } from "@/components/lang-provider";
import { PersonBadge } from "@/components/collab/person-badge";
import type { TKey } from "@/lib/i18n/dictionaries";
import { PERSON_COLORS, personOf, type Person } from "@/lib/person";
import { api } from "@/lib/api";
import { TIER_LABEL, type PaidTier, type Tier } from "@/lib/tiers";

type Theme = "light" | "dark" | "system";

const THEMES: { value: Theme; label: TKey; description: TKey }[] = [
  { value: "light", label: "settings.themeLight", description: "settings.themeLightDesc" },
  { value: "dark", label: "settings.themeDark", description: "settings.themeDarkDesc" },
  { value: "system", label: "settings.themeSystem", description: "settings.themeSystemDesc" },
];

// Theme lives in localStorage; the layout script applies it on load. This store
// keeps the selected card in sync without effects.
const themeListeners = new Set<() => void>();

function readTheme(): Theme {
  const stored = localStorage.getItem("theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  return () => {
    themeListeners.delete(cb);
  };
}

function setTheme(theme: Theme) {
  localStorage.setItem("theme", theme);
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  for (const cb of themeListeners) cb();
}

// Resize the chosen image to a small square JPEG data URL. 192px covers every
// badge size; the result stays a few tens of KB.
async function resizePicture(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });
    const size = 192;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    // Cover crop: the shorter side fills the square.
    const scale = Math.max(size / image.width, size / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sectionTitle = "text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase";
const fieldLabel = "text-xs text-sand-700";

// Billing (SPEC.md §20): GET /api/billing answers the account's tier, its
// active subscription, and the live Stripe prices — this shape mirrors that
// route's response. No Stripe code runs on the client; only numbers do.
type BillingInterval = "month" | "year";
type IntervalPrice = { amountCents: number; currency: string };
type YearPrice = IntervalPrice & { savingsPercent: number };
type TierPrices = { month: IntervalPrice | null; year: YearPrice | null };
type BillingSubscription = {
  tier: PaidTier;
  status: string;
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
};
type BillingInfo = {
  tier: Tier;
  billing: boolean;
  hasCustomer: boolean;
  subscription: BillingSubscription | null;
  prices: Record<PaidTier, TierPrices> | null;
};

const PAID_TIERS: PaidTier[] = ["PREMIUM", "ULTRA"];

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

// Settings: one Profile section (picture, name, symbol, color, background),
// then Language and Theme. Changes save automatically.
export function SettingsForm({
  account,
  background,
  premium,
  billingEnabled,
  drive,
}: {
  // The signed-in account; null = sign-in off (single-reader mode).
  account: (Person & { email: string; storedSymbol: string; storedColor: string }) | null;
  background: string;
  premium: boolean;
  // Sign-in is on: the billing section fetches GET /api/billing. Off (the
  // local reader) means no account to bill; the plain status line stands.
  billingEnabled: boolean;
  // Link Google Drive (SPEC.md §14); null = Drive linking not available.
  drive: { linked: boolean; canLink: boolean } | null;
}) {
  const t = useT();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system");
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(account?.name ?? "");
  const [symbol, setSymbol] = useState(account?.storedSymbol ?? "");
  const [color, setColor] = useState(account?.storedColor ?? "");
  const [picture, setPicture] = useState(account?.picture ?? "");
  const [backgroundText, setBackgroundText] = useState(background);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [driveLinked, setDriveLinked] = useState(drive?.linked ?? false);
  const [driveBusy, setDriveBusy] = useState(false);
  // Back from Link Google Drive: ?drive=linked or ?drive=link-failed says how
  // it went; the param leaves the URL so a reload does not repeat the notice.
  const [driveNotice, setDriveNotice] = useState<string | null>(null);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("drive");
    if (!result) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDriveNotice(result === "linked" ? t("panes.driveLinked") : t("panes.driveAuthFailed"));
    if (result === "linked") setDriveLinked(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    window.history.replaceState(null, "", window.location.pathname);
  }, [t]);

  // Billing (SPEC.md §20): the account's tier, subscription, and live Stripe
  // prices, fetched once. Sign-in off has no account to bill.
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [billingLoading, setBillingLoading] = useState(billingEnabled);
  // Named billingInterval, not interval: that name shadows the global timer
  // function and this file already uses setTimeout/clearTimeout nearby.
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("year");
  const [checkoutBusy, setCheckoutBusy] = useState<PaidTier | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  // Back from Stripe Checkout: ?billing=done, the same one-time-notice
  // pattern as the Drive link return above.
  const [billingNotice, setBillingNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!billingEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing");
        if (res.ok && !cancelled) setBilling((await res.json()) as BillingInfo);
      } catch {
        // The section falls back to the plain status line below.
      } finally {
        if (!cancelled) setBillingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [billingEnabled]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("billing");
    if (!result) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (result === "done") setBillingNotice(t("settings.billingDone"));
    /* eslint-enable react-hooks/set-state-in-effect */
    window.history.replaceState(null, "", window.location.pathname);
  }, [t]);

  async function startCheckout(tier: PaidTier) {
    setBillingError(null);
    setCheckoutBusy(tier);
    try {
      const { url } = await api<{ url: string }>("/api/billing/checkout", "POST", {
        tier,
        interval: billingInterval,
      });
      window.location.assign(url);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : t("common.requestFailed"));
      setCheckoutBusy(null);
    }
  }

  async function openPortal() {
    setBillingError(null);
    setPortalBusy(true);
    try {
      const { url } = await api<{ url: string }>("/api/billing/portal", "POST");
      window.location.assign(url);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : t("common.requestFailed"));
      setPortalBusy(false);
    }
  }

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(
    JSON.stringify({
      name: account?.name ?? "",
      symbol: account?.storedSymbol ?? "",
      color: account?.storedColor ?? "",
      background: background.trim(),
    }),
  );

  // Debounced auto-save: the account fields to /api/account, the background to
  // /api/profile. Purpose and application columns clear on save — the profile
  // is one Background field now.
  useEffect(() => {
    const payload = JSON.stringify({
      name: name.trim(),
      symbol: symbol.trim(),
      color,
      background: backgroundText.trim(),
    });
    if (payload === lastSaved.current) return;
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        if (account && name.trim()) {
          await api("/api/account", "PUT", { name: name.trim(), symbol: symbol.trim(), color });
        }
        await api("/api/profile", "PUT", {
          background: backgroundText.trim(),
          purpose: "",
          application: "",
        });
        lastSaved.current = payload;
        setError(null);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1800);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("common.requestFailed"));
        setStatus("idle");
      }
    }, 700);
  }, [name, symbol, color, backgroundText, account, t]);

  async function uploadPicture(file: File) {
    setError(null);
    setStatus("saving");
    try {
      const dataUrl = await resizePicture(file);
      await api("/api/account", "PUT", { picture: dataUrl });
      setPicture(dataUrl);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setError(t("settings.pictureFailed"));
      setStatus("idle");
    }
  }

  async function removePicture() {
    setError(null);
    try {
      await api("/api/account", "PUT", { picture: "" });
      setPicture("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  // Unlink Google Drive: revoke at Google, clear the stored grant (SPEC.md §14).
  async function unlinkDrive() {
    setError(null);
    setDriveBusy(true);
    try {
      await api("/api/drive/link", "DELETE");
      setDriveLinked(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setDriveBusy(false);
    }
  }

  // The badge preview mirrors what collaborators see, live.
  const preview = account
    ? personOf({ id: account.id, name: name.trim() || account.name, symbol, color, picture })
    : null;

  // Prices for the two paid tiers, and the largest yearly saving among them
  // (the toggle's badge) — both null until GET /api/billing answers.
  const prices = billing?.prices ?? null;
  const maxSavings = prices
    ? Math.max(0, ...PAID_TIERS.map((tier) => prices[tier].year?.savingsPercent ?? 0))
    : 0;

  return (
    <div className="space-y-10">
      <div className="flex h-4 items-center justify-end gap-3 text-xs text-sand-600">
        {error && <span className="text-red-500">{error}</span>}
        {status === "saving"
          ? t("common.saving")
          : status === "saved"
            ? t("common.saved")
            : t("settings.autoSave")}
      </div>

      <section className="space-y-3">
        <h2 className={sectionTitle}>{t("settings.profile")}</h2>
        {account && preview ? (
          <div className="space-y-5 rounded-2xl bg-card p-5 shadow-soft">
            <p className="text-xs text-sand-600">{t("settings.profileDesc")}</p>

            <div className="flex items-center gap-4">
              <PersonBadge person={preview} size={64} title={t("settings.picture")} />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadPicture(file);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("settings.uploadPicture")}
              </button>
              {picture && (
                <button
                  onClick={() => void removePicture()}
                  className="text-xs text-sand-600 hover:text-red-600"
                >
                  {t("settings.removePicture")}
                </button>
              )}
            </div>

            <div className="grid grid-cols-[1fr_120px] gap-4">
              <label className="block">
                <span className={fieldLabel}>{t("settings.name")}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("settings.namePh")}
                  className="mt-1 w-full rounded-full bg-sand-100 px-4 py-2 text-sm outline-none placeholder:text-sand-500"
                />
              </label>
              <label className="block">
                <span className={fieldLabel}>{t("settings.symbol")}</span>
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.slice(0, 4))}
                  placeholder={preview.symbol}
                  maxLength={4}
                  className="mt-1 w-full rounded-full bg-sand-100 px-4 py-2 text-center text-sm outline-none placeholder:text-sand-500"
                />
              </label>
            </div>
            <p className="-mt-3 text-[11px] text-sand-500">{t("settings.symbolDesc")}</p>

            <div>
              <span className={fieldLabel}>{t("settings.color")}</span>
              <div className="mt-1.5 flex gap-2">
                {PERSON_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(color === c ? "" : c)}
                    aria-label={c}
                    aria-pressed={color === c || (!color && preview.color === c)}
                    className={`size-7 rounded-full ${
                      color === c || (!color && preview.color === c)
                        ? "outline-2 outline-offset-2 outline-clay-500"
                        : ""
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>

            <label className="block">
              <span className={fieldLabel}>{t("settings.background")}</span>
              <textarea
                value={backgroundText}
                onChange={(e) => setBackgroundText(e.target.value)}
                placeholder={t("settings.backgroundPh")}
                rows={3}
                className="mt-1 w-full rounded-2xl bg-sand-100 p-3 text-sm outline-none placeholder:text-sand-500"
              />
            </label>
            <p className="-mt-3 text-[11px] text-sand-500">{t("settings.backgroundDesc")}</p>

            <div className="flex items-center gap-2 border-t border-line pt-4">
              <span className="truncate text-xs text-sand-600">{account.email}</span>
              <a
                href="/api/auth/logout"
                className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("common.signOut")}
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-5 rounded-2xl bg-card p-5 shadow-soft">
            <label className="block">
              <span className={fieldLabel}>{t("settings.background")}</span>
              <textarea
                value={backgroundText}
                onChange={(e) => setBackgroundText(e.target.value)}
                placeholder={t("settings.backgroundPh")}
                rows={3}
                className="mt-1 w-full rounded-2xl bg-sand-100 p-3 text-sm outline-none placeholder:text-sand-500"
              />
            </label>
            <p className="-mt-3 text-[11px] text-sand-500">{t("settings.backgroundDesc")}</p>
            <p className="border-t border-line pt-4 text-xs text-sand-600">
              {t("settings.singleReader")}
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className={sectionTitle}>{t("settings.billing")}</h2>
        {!billingEnabled || billingLoading || !billing?.billing ? (
          <p className="text-xs text-sand-600">
            {premium ? t("settings.premiumOn") : t("settings.premiumOff")}
          </p>
        ) : (
          <div className="space-y-4">
            {billingNotice && (
              <p className="rounded-2xl bg-sage-100 px-4 py-2 text-xs font-semibold text-sage-800">
                {billingNotice}
              </p>
            )}
            {billingError && <p className="text-xs text-red-500">{billingError}</p>}

            {billing.tier !== "FREE" && billing.subscription ? (
              <div className="rounded-2xl bg-card p-5 shadow-soft">
                <p className="text-sm font-bold text-sand-800">{TIER_LABEL[billing.tier]}</p>
                <p className="mt-1 text-xs text-sand-600">
                  {fmtMoney(billing.subscription.amountCents, billing.subscription.currency)}
                  {billing.subscription.interval === "year"
                    ? t("settings.billingPerYear")
                    : t("settings.billingPerMonth")}
                  {" · "}
                  {billing.subscription.cancelAtPeriodEnd
                    ? t("settings.billingEnds", { date: fmtDate(billing.subscription.currentPeriodEnd) })
                    : t("settings.billingRenews", { date: fmtDate(billing.subscription.currentPeriodEnd) })}
                </p>
                {billing.hasCustomer && (
                  <button
                    onClick={() => void openPortal()}
                    disabled={portalBusy}
                    className="mt-3 rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                  >
                    {portalBusy ? t("common.working") : t("settings.billingManage")}
                  </button>
                )}
              </div>
            ) : (
              prices && (
                <>
                  <div className="inline-flex items-center gap-0.5 rounded-full bg-sand-100 p-1">
                    <button
                      onClick={() => setBillingInterval("month")}
                      aria-pressed={billingInterval === "month"}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        billingInterval === "month" ? "bg-card text-clay-800 shadow-soft" : "text-sand-600"
                      }`}
                    >
                      {t("settings.billingMonthly")}
                    </button>
                    <button
                      onClick={() => setBillingInterval("year")}
                      aria-pressed={billingInterval === "year"}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                        billingInterval === "year" ? "bg-card text-clay-800 shadow-soft" : "text-sand-600"
                      }`}
                    >
                      {t("settings.billingYearly")}
                      {maxSavings > 0 && (
                        <span className="rounded-full bg-sage-200 px-1.5 py-0.5 text-[10px] font-bold text-sage-800">
                          {t("settings.billingSaveBadge", { n: maxSavings })}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {PAID_TIERS.map((tier) => {
                      const monthPrice = prices[tier].month;
                      const yearPrice = prices[tier].year;
                      const price = billingInterval === "month" ? monthPrice : yearPrice;
                      if (!price) return null;
                      const monthlyEquivalent =
                        billingInterval === "year" ? price.amountCents / 12 : price.amountCents;
                      const savings = billingInterval === "year" ? (yearPrice?.savingsPercent ?? 0) : 0;
                      return (
                        <div key={tier} className="relative rounded-2xl bg-card p-5 shadow-soft">
                          {savings > 0 && (
                            <span className="absolute -top-2.5 right-4 rounded-full bg-sage-200 px-2.5 py-1 text-[10px] font-bold text-sage-800 shadow-soft">
                              {t("settings.billingSaveBadge", { n: savings })}
                            </span>
                          )}
                          <p className="text-sm font-bold text-sand-800">{TIER_LABEL[tier]}</p>
                          <p className="mt-2 text-2xl font-bold text-sand-900 tabular-nums">
                            {fmtMoney(monthlyEquivalent, price.currency)}
                            <span className="ml-1 text-xs font-normal text-sand-500">
                              {t("settings.billingPerMonth")}
                            </span>
                          </p>
                          {billingInterval === "year" && (
                            <p className="text-[11px] text-sand-500">
                              {t("settings.billingBilledYearly", { amount: fmtMoney(price.amountCents, price.currency) })}
                            </p>
                          )}
                          <button
                            onClick={() => void startCheckout(tier)}
                            disabled={checkoutBusy !== null}
                            className="mt-4 w-full rounded-full bg-clay px-4 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                          >
                            {checkoutBusy === tier
                              ? t("common.working")
                              : t("settings.billingUpgrade", { tier: TIER_LABEL[tier] })}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )
            )}
          </div>
        )}
      </section>

      {drive && (
        <section className="space-y-3">
          <h2 className={sectionTitle}>{t("settings.drive")}</h2>
          <div className="flex items-center gap-3 rounded-2xl bg-card p-5 shadow-soft">
            <p className="text-xs text-sand-600">
              {driveLinked ? t("settings.driveLinkedDesc") : t("settings.driveDesc")}
              {driveNotice && (
                <span className="mt-1 block font-semibold text-clay-800">{driveNotice}</span>
              )}
            </p>
            {driveLinked ? (
              <button
                onClick={() => void unlinkDrive()}
                disabled={driveBusy}
                className="ml-auto shrink-0 rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
              >
                {t("settings.driveUnlink")}
              </button>
            ) : drive.canLink ? (
              <a
                href="/api/drive/link?next=/settings"
                className="ml-auto shrink-0 rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600"
              >
                {t("settings.driveLink")}
              </a>
            ) : null}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className={sectionTitle}>{t("settings.language")}</h2>
        <LangSwitcher />
      </section>

      <section className="space-y-3">
        <h2 className={sectionTitle}>{t("settings.theme")}</h2>
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((th) => (
            <button
              key={th.value}
              onClick={() => setTheme(th.value)}
              aria-pressed={theme === th.value}
              className={`rounded-2xl px-4 py-3 text-left ${
                theme === th.value
                  ? "bg-card shadow-soft outline-2 outline-clay-400"
                  : "bg-card shadow-soft hover:bg-clay-100"
              }`}
            >
              <div className="text-sm font-semibold">
                {t(th.label)}
                {theme === th.value && <span className="ml-1.5">✓</span>}
              </div>
              <div className="mt-0.5 text-xs text-sand-600">{t(th.description)}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

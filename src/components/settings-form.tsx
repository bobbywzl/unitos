"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LangSwitcher } from "@/components/lang-switcher";
import { useLang, useT } from "@/components/lang-provider";
import { PersonBadge } from "@/components/collab/person-badge";
import type { AccountData } from "@/lib/account-data";
import type { DriveAccess } from "@/lib/drive/types";
import type { TKey } from "@/lib/i18n/dictionaries";
import { PERSON_COLORS, personOf, type Person } from "@/lib/person";
import { api } from "@/lib/api";
import type { TierState } from "@/lib/tiers";
import { TierMark, tierLook } from "@/components/tier-mark";

type Theme = "light" | "dark" | "system";

const THEMES: { value: Theme; label: TKey; description: TKey }[] = [
  { value: "light", label: "settings.themeLight", description: "settings.themeLightDesc" },
  { value: "dark", label: "settings.themeDark", description: "settings.themeDarkDesc" },
  { value: "system", label: "settings.themeSystem", description: "settings.themeSystemDesc" },
];

// The operator's contact for deletion requests — the address the Privacy
// Policy names (dict/legal.ts).
const CONTACT_EMAIL = "robertwzl311@gmail.com";

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
const primaryButton =
  "shrink-0 rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600";
const secondaryButton =
  "shrink-0 rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";

// Settings: one Profile section (picture, name, symbol, color, background),
// Unitos Premium, Connections (sign-in and Google Drive), Your data (every
// stored field and count about the account), then Language and Theme.
// Changes save automatically.
export function SettingsForm({
  account,
  background,
  plan,
  drive,
  data,
}: {
  // The signed-in account; null = sign-in off (single-reader mode).
  account: (Person & { email: string; storedSymbol: string; storedColor: string }) | null;
  background: string;
  // The account's tier (TIERS.md, lib/tiers.ts) and, on trial or expired,
  // the trial's end as an ISO date.
  plan: { state: TierState; trialEndsAt: string | null };
  // Google Drive under Connections (SPEC.md §14): access is what a link asks
  // for, grant what this account's stored grant reaches. null = Drive linking
  // not available.
  drive: { linked: boolean; canLink: boolean; access: DriveAccess; grant: DriveAccess | null } | null;
  // Your data: what Unitos holds about this account (lib/account-data.ts).
  data: AccountData;
}) {
  const t = useT();
  const lang = useLang();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system");
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(account?.name ?? "");
  const [symbol, setSymbol] = useState(account?.storedSymbol ?? "");
  const [color, setColor] = useState(account?.storedColor ?? "");
  const [picture, setPicture] = useState(account?.picture ?? "");
  const [backgroundText, setBackgroundText] = useState(background);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  // What the stored Drive grant reaches; null = not linked. The page renders
  // after the link callback, so this starts current.
  const [driveGrant, setDriveGrant] = useState<DriveAccess | null>(drive?.grant ?? null);
  const [driveBusy, setDriveBusy] = useState(false);
  // Back from Link Google Drive: ?drive=linked or ?drive=link-failed says how
  // it went; the param leaves the URL so a reload does not repeat the notice.
  const [driveNotice, setDriveNotice] = useState<string | null>(null);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("drive");
    if (!result) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDriveNotice(result === "linked" ? t("panes.driveLinked") : t("panes.driveAuthFailed"));
    /* eslint-enable react-hooks/set-state-in-effect */
    window.history.replaceState(null, "", window.location.pathname);
  }, [t]);
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
      setDriveGrant(null);
      setDriveNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setDriveBusy(false);
    }
  }

  // The badge preview mirrors what collaborators see, live.
  const preview = account
    ? { ...personOf({ id: account.id, name: name.trim() || account.name, symbol, color, picture }), tier: plan.state }
    : null;

  // The Google Drive row's text: the stored grant's access, or what a link
  // would ask for.
  const driveText = !drive
    ? ""
    : driveGrant === "all"
      ? t("settings.driveLinkedAll")
      : driveGrant === "picked"
        ? t("settings.driveLinkedPicked")
        : drive.access === "all"
          ? t("settings.driveDescAll")
          : t("settings.driveDescPicked");

  // Dates in the reader's language, UTC on both server and client so the
  // first render matches.
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  const storedOrNone = (stored: boolean) => t(stored ? "settings.dataStored" : "settings.dataNone");

  // Your data: one row per stored fact — what is held, and a line on what it
  // is for where the label alone does not say.
  const rows: { label: TKey; value: string; desc?: TKey }[] = [
    ...(account
      ? [
          { label: "settings.dataEmail" as const, value: account.email },
          { label: "settings.dataName" as const, value: name.trim() || account.name },
          { label: "settings.dataPicture" as const, value: storedOrNone(Boolean(picture)) },
          {
            label: "settings.dataPassword" as const,
            value: t(data.passwordSet ? "settings.passwordSet" : "settings.passwordNone"),
          },
          ...(data.createdAt
            ? [{ label: "settings.dataCreated" as const, value: fmtDate(data.createdAt) }]
            : []),
          ...(data.lastSeenAt
            ? [
                {
                  label: "settings.dataLastSeen" as const,
                  value: fmtDate(data.lastSeenAt),
                  desc: "settings.dataLastSeenDesc" as const,
                },
              ]
            : []),
          {
            label: "settings.dataSessions" as const,
            value: String(data.sessions),
            desc: "settings.dataSessionsDesc" as const,
          },
        ]
      : []),
    {
      label: "settings.dataBackground",
      value: storedOrNone(backgroundText.trim().length > 0),
      desc: "settings.dataBackgroundDesc",
    },
    { label: "settings.dataProjects", value: String(data.projects) },
    { label: "settings.dataDocuments", value: String(data.documents), desc: "settings.dataDocumentsDesc" },
    { label: "settings.dataNotes", value: String(data.notes) },
    { label: "settings.dataDigests", value: String(data.digests), desc: "settings.dataDigestsDesc" },
    { label: "settings.dataClicks", value: String(data.clicks), desc: "settings.dataClicksDesc" },
    { label: "settings.dataUsage", value: String(data.usage), desc: "settings.dataUsageDesc" },
    { label: "settings.dataFeedback", value: String(data.feedback), desc: "settings.dataFeedbackDesc" },
    { label: "settings.dataNotifications", value: String(data.notifications) },
    ...(drive
      ? [
          {
            label: "settings.drive" as const,
            value: t(
              driveGrant === "all"
                ? "settings.dataDriveAll"
                : driveGrant === "picked"
                  ? "settings.dataDrivePicked"
                  : "settings.dataDriveNone",
            ),
            desc: "settings.dataDriveDesc" as const,
          },
        ]
      : []),
    { label: "settings.dataBrowser", value: t("settings.dataBrowserValue") },
    { label: "settings.dataLogs", value: t("settings.dataLogsValue") },
  ];

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
        <h2 className={sectionTitle}>{t("settings.plan")}</h2>
        {/* The plan card (TIERS.md): the tier mark and the tier's name, in
            the tier's own material, then what the tier holds. */}
        <div className={`flex gap-4 rounded-2xl p-5 tier-card-${tierLook(plan.state)}`}>
          <TierMark state={plan.state} size={40} className="mt-0.5" />
          <div className="min-w-0 space-y-1.5">
            <div className="tier-card-title font-display text-[19px]">
              {t(plan.state === "ultra" ? "common.tierUltra" : "common.tierPremium")}
            </div>
            <p className="tier-card-muted text-xs leading-relaxed">
              {plan.state === "ultra"
                ? t("settings.planUltra")
                : plan.state === "premium"
                  ? t("settings.planPremium")
                  : t(plan.state === "trial" ? "settings.planTrial" : "settings.planExpired", {
                      date: plan.trialEndsAt ? fmtDate(plan.trialEndsAt) : "",
                    })}
            </p>
            {account && <p className="tier-card-muted text-[11px]">{t("settings.planMark")}</p>}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className={sectionTitle}>{t("settings.connections")}</h2>
        <div className="space-y-4 rounded-2xl bg-card p-5 shadow-soft">
          <p className="text-xs text-sand-600">{t("settings.connectionsDesc")}</p>
          {account && (
            <div className="border-t border-line pt-4 text-xs">
              <div className="font-semibold text-sand-800">{t("settings.signIn")}</div>
              <p className="mt-0.5 text-sand-600">
                {t("settings.signInDesc", {
                  email: account.email,
                  password: t(data.passwordSet ? "settings.passwordSet" : "settings.passwordNone"),
                })}
              </p>
            </div>
          )}
          {drive && (
            <div className="flex items-center gap-3 border-t border-line pt-4 text-xs">
              <div className="min-w-0">
                <div className="font-semibold text-sand-800">{t("settings.drive")}</div>
                <p className="mt-0.5 text-sand-600">
                  {driveText}
                  {driveNotice && (
                    <span className="mt-1 block font-semibold text-clay-800">{driveNotice}</span>
                  )}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {driveGrant === "picked" && drive.access === "all" && drive.canLink && (
                  <a href="/api/drive/link?next=/settings" className={primaryButton}>
                    {t("settings.driveRelink")}
                  </a>
                )}
                {driveGrant ? (
                  <button
                    onClick={() => void unlinkDrive()}
                    disabled={driveBusy}
                    className={secondaryButton}
                  >
                    {t("settings.driveUnlink")}
                  </button>
                ) : drive.canLink ? (
                  // The onboarding nudge's last step points here
                  // (components/nudges.tsx).
                  <a
                    href="/api/drive/link?next=/settings"
                    data-nudge="drive"
                    className={primaryButton}
                  >
                    {t("settings.driveLink")}
                  </a>
                ) : null}
              </div>
            </div>
          )}
          {!account && !drive && (
            <p className="border-t border-line pt-4 text-xs text-sand-600">
              {t("settings.connectionsNone")}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className={sectionTitle}>{t("settings.data")}</h2>
        <div className="space-y-4 rounded-2xl bg-card p-5 shadow-soft">
          <p className="text-xs text-sand-600">
            {t("settings.dataDesc")}{" "}
            <Link href="/privacy" className="underline hover:text-clay-800">
              {t("legal.privacyTitle")}
            </Link>
          </p>
          <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t border-line pt-4 text-xs">
            {rows.map((row) => (
              <Fragment key={row.label}>
                <dt className="text-sand-700">{t(row.label)}</dt>
                <dd className="min-w-0 text-sand-800">
                  <span className="break-words">{row.value}</span>
                  {row.desc && <span className="block text-sand-500">{t(row.desc)}</span>}
                </dd>
              </Fragment>
            ))}
          </dl>
          <p className="border-t border-line pt-4 text-[11px] text-sand-500">
            {t("settings.dataDelete", { email: CONTACT_EMAIL })}
          </p>
        </div>
      </section>

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

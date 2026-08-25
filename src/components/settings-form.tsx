"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LangSwitcher } from "@/components/lang-switcher";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";
import { api } from "@/lib/api";

type Theme = "light" | "dark" | "system";
type ContextValues = { background: string; purpose: string; application: string };

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

// Settings sections. Changes save automatically (release-edu pattern): theme to
// localStorage on click, context debounced to the profile API.
export function SettingsForm({
  profile,
  services,
  account,
}: {
  profile: ContextValues | null;
  services: { anthropic: boolean; google: boolean; admin: boolean };
  // The signed-in account; null = sign-in off (single-reader mode).
  account: { email: string; name: string; picture: string } | null;
}) {
  const t = useT();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system");

  const [values, setValues] = useState<ContextValues>(
    profile ?? { background: "", purpose: "", application: "" },
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(
    JSON.stringify({
      background: (profile?.background ?? "").trim(),
      purpose: (profile?.purpose ?? "").trim(),
      application: (profile?.application ?? "").trim(),
    }),
  );

  // Debounced auto-save. Every field is optional; saves whenever something changed.
  useEffect(() => {
    const trimmed = {
      background: values.background.trim(),
      purpose: values.purpose.trim(),
      application: values.application.trim(),
    };
    const payload = JSON.stringify(trimmed);
    if (payload === lastSaved.current) return;
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api("/api/profile", "PUT", trimmed);
        lastSaved.current = payload;
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1800);
      } catch {
        setStatus("idle");
      }
    }, 700);
  }, [values]);

  const field = (key: keyof ContextValues, label: string, placeholder: string) => (
    <label className="block">
      <span className="text-xs text-sand-700">{label}</span>
      <textarea
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        placeholder={placeholder}
        rows={2}
        className="mt-1 w-full rounded-2xl bg-card p-3 text-sm shadow-soft outline-none placeholder:text-sand-500"
      />
    </label>
  );

  const statusRow = (label: string, description: string, set: boolean) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="font-mono text-sm">{label}</div>
        <div className="text-xs text-sand-600">{description}</div>
      </div>
      <span
        className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
          set ? "bg-sage-200 text-sage-800" : "bg-sand-200 text-sand-600"
        }`}
      >
        {set ? t("settings.set") : t("settings.notSet")}
      </span>
    </div>
  );

  return (
    <div className="space-y-10">
      <div className="flex h-4 justify-end text-xs text-sand-600">
        {status === "saving"
          ? t("common.saving")
          : status === "saved"
            ? t("common.saved")
            : t("settings.autoSave")}
      </div>

      <section className="space-y-3">
        <h2 className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("settings.account")}
        </h2>
        {account ? (
          <div className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-soft">
            {account.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.picture} alt="" className="size-9 rounded-full" />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-full bg-clay-100 text-sm font-semibold text-clay-800">
                {account.name[0]?.toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold">{account.name}</div>
              <div className="truncate text-xs text-sand-600">{account.email}</div>
            </div>
            <a
              href="/api/auth/logout"
              className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("common.signOut")}
            </a>
          </div>
        ) : (
          <p className="text-xs text-sand-600">{t("settings.singleReader")}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("settings.language")}
        </h2>
        <LangSwitcher />
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("settings.theme")}
        </h2>
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

      <section className="space-y-3">
        <h2 className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("settings.context")}
        </h2>
        <p className="text-xs text-sand-600">{t("settings.contextDesc")}</p>
        <div className="space-y-3">
          {field("background", t("settings.background"), t("settings.backgroundPh"))}
          {field("purpose", t("settings.purpose"), t("settings.purposePh"))}
          {field("application", t("settings.application"), t("settings.applicationPh"))}
        </div>
      </section>

      <section className="space-y-1">
        <h2 className="mb-3 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("settings.services")}
        </h2>
        {statusRow("ANTHROPIC_API_KEY", t("settings.svcAnthropic"), services.anthropic)}
        {statusRow("GOOGLE_CLIENT_ID + SESSION_SECRET", t("settings.svcGoogle"), services.google)}
        {statusRow("ADMIN_PASSWORD", t("settings.svcAdmin"), services.admin)}
        <p className="pt-2 text-xs text-sand-600">{t("settings.envHint")}</p>
        {services.admin && (
          <a href="/admin" className="inline-block pt-1 text-sm text-clay underline">
            {t("settings.openInbox")}
          </a>
        )}
      </section>
    </div>
  );
}

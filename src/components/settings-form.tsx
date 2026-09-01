"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LangSwitcher } from "@/components/lang-switcher";
import { useT } from "@/components/lang-provider";
import { PersonBadge } from "@/components/collab/person-badge";
import type { TKey } from "@/lib/i18n/dictionaries";
import { PERSON_COLORS, personOf, type Person } from "@/lib/person";
import { api } from "@/lib/api";

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

// Settings: one Profile section (picture, name, symbol, color, background),
// then Language and Theme. Changes save automatically.
export function SettingsForm({
  account,
  background,
  premium,
}: {
  // The signed-in account; null = sign-in off (single-reader mode).
  account: (Person & { email: string; storedSymbol: string; storedColor: string }) | null;
  background: string;
  premium: boolean;
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

  // The badge preview mirrors what collaborators see, live.
  const preview = account
    ? personOf({ id: account.id, name: name.trim() || account.name, symbol, color, picture })
    : null;

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
        <h2 className={sectionTitle}>{t("settings.premium")}</h2>
        <p className="text-xs text-sand-600">
          {premium ? t("settings.premiumOn") : t("settings.premiumOff")}
        </p>
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

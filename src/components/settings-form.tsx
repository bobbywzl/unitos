"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

type Theme = "light" | "dark" | "system";
type ProfileValues = { background: string; purpose: string; application: string };

const THEMES: { value: Theme; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Always light" },
  { value: "dark", label: "Dark", description: "Always dark" },
  { value: "system", label: "System", description: "Follow the device" },
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
// localStorage on click, reader profile debounced to the profile API.
export function SettingsForm({
  profile,
  services,
}: {
  profile: ProfileValues | null;
  services: { anthropic: boolean; voyage: boolean; admin: boolean };
}) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system");

  const [values, setValues] = useState<ProfileValues>(
    profile ?? { background: "", purpose: "", application: "" },
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(JSON.stringify(profile));

  // Debounced auto-save. Saves only when all three fields have content (the API
  // requires all three) and something changed.
  useEffect(() => {
    const trimmed = {
      background: values.background.trim(),
      purpose: values.purpose.trim(),
      application: values.application.trim(),
    };
    if (!trimmed.background || !trimmed.purpose || !trimmed.application) return;
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

  const field = (key: keyof ProfileValues, label: string, placeholder: string) => (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{label}</span>
      <textarea
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        placeholder={placeholder}
        rows={2}
        className="mt-1 w-full rounded-md border border-neutral-300 bg-white p-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
      />
    </label>
  );

  const statusRow = (label: string, description: string, set: boolean) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="font-mono text-sm">{label}</div>
        <div className="text-xs text-neutral-500">{description}</div>
      </div>
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          set
            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
            : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
        }`}
      >
        {set ? "Set" : "Not set"}
      </span>
    </div>
  );

  return (
    <div className="space-y-10">
      <div className="flex h-4 justify-end text-xs text-neutral-500">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Changes save automatically"}
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Theme</h2>
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              aria-pressed={theme === t.value}
              className={`rounded-lg border px-4 py-3 text-left ${
                theme === t.value
                  ? "border-neutral-900 bg-neutral-100 dark:border-white dark:bg-neutral-800"
                  : "border-neutral-300 hover:border-neutral-500 dark:border-neutral-700"
              }`}
            >
              <div className="text-sm font-medium">
                {t.label}
                {theme === t.value && <span className="ml-1.5">✓</span>}
              </div>
              <div className="mt-0.5 text-xs text-neutral-500">{t.description}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Reader profile
        </h2>
        <p className="text-xs text-neutral-500">
          Injected into every AI prompt. Three questions, be concrete. A notebook can override this
          from its header.
        </p>
        <div className="space-y-3">
          {field("background", "Background", "e.g. Stanford student, stochastic calc + stats + quantum")}
          {field("purpose", "Purpose", "e.g. due diligence, exam prep, replicate results")}
          {field("application", "Application", "e.g. investment decision for Bough Capital")}
        </div>
      </section>

      <section className="space-y-1">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Services
        </h2>
        {statusRow("ANTHROPIC_API_KEY", "Derivations, assistant, glossary", services.anthropic)}
        {statusRow("VOYAGE_API_KEY", "Corpus search", services.voyage)}
        {statusRow("ADMIN_PASSWORD", "Feedback inbox at /admin", services.admin)}
        <p className="pt-2 text-xs text-neutral-500">
          Set these in your host&apos;s environment variables and redeploy. On Vercel: Settings →
          Environment Variables.
        </p>
        {services.admin && (
          <a href="/admin" className="inline-block pt-1 text-sm text-neutral-600 underline dark:text-neutral-300">
            Open the feedback inbox
          </a>
        )}
      </section>
    </div>
  );
}

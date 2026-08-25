"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/lang-provider";

export default function AdminLoginPage() {
  const router = useRouter();
  const t = useT();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? t("admin.loginFailed"));
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loginFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={login} className="w-full max-w-xs space-y-3">
        <h1 className="text-[28px]">{t("admin.loginTitle")}</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("admin.loginPasswordPh")}
          autoFocus
          className="w-full rounded-full bg-card px-4 py-2.5 text-sm shadow-soft outline-none placeholder:text-sand-500"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-full bg-clay px-4 py-2.5 text-sm font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {t("admin.signIn")}
        </button>
      </form>
    </main>
  );
}

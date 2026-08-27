import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { emailEnabled, peekEmailToken } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

// The reset page: the link in the reset email lands here. The token is only
// consumed when the form posts, so a reload keeps working.
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  if (!emailEnabled()) redirect("/signin");
  const { token = "", error } = await searchParams;
  const valid = await peekEmailToken(token, "reset");
  const t = await serverT();

  const authErrors: Record<string, string> = {
    "Password must be at least 8 characters": t("signin.errPasswordShort"),
    "Passwords do not match": t("signin.errPasswordMatch"),
  };
  const inputCls =
    "h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-sm text-ink placeholder:text-sand-600 focus:border-clay/60 focus:outline-none";

  return (
    <div className="dark relative flex min-h-screen flex-col overflow-hidden bg-[#14110d] text-ink">
      <div aria-hidden className="signin-glow pointer-events-none absolute inset-0" />
      <div aria-hidden className="signin-dots pointer-events-none absolute inset-0" />

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        <div className="rise-in">
          <div className="mb-6 flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-xl border border-clay/30 bg-clay/12">
              <Logo size={22} className="text-clay" />
            </span>
            <span className="font-display text-xl text-ink">{t("common.appName")}</span>
          </div>

          <h1 className="font-display text-[2rem] leading-[1.1] text-ink sm:text-[2.4rem]">
            {t("signin.resetTitle")}
          </h1>

          {error && (
            <p className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
              {authErrors[error] ?? error}
            </p>
          )}

          {valid ? (
            <form
              action="/api/auth/password/reset"
              method="post"
              className="mt-6 space-y-2.5 rounded-2xl border border-clay/30 bg-white/[0.03] p-5 shadow-[0_0_50px_-18px_rgba(217,138,82,0.5)] backdrop-blur-sm"
            >
              <input type="hidden" name="token" value={token} />
              <input
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={200}
                autoComplete="new-password"
                placeholder={t("signin.passwordLabel")}
                aria-label={t("signin.passwordLabel")}
                className={inputCls}
              />
              <input
                name="confirm"
                type="password"
                required
                maxLength={200}
                autoComplete="new-password"
                placeholder={t("signin.confirmPasswordLabel")}
                aria-label={t("signin.confirmPasswordLabel")}
                className={inputCls}
              />
              <button
                type="submit"
                className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-clay text-sm font-semibold text-clay-fg shadow-[0_8px_24px_-10px_rgba(217,138,82,0.7)] hover:brightness-110 active:scale-[0.99]"
              >
                {t("signin.setPassword")}
              </button>
            </form>
          ) : (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
              <p className="text-sm leading-relaxed text-sand-600">{t("signin.errEmailToken")}</p>
              <Link
                href="/signin?mode=forgot"
                className="mt-3 inline-block text-xs font-semibold text-clay hover:brightness-110"
              >
                {t("signin.sendReset")}
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

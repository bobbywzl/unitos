import Link from "next/link";
import { redirect } from "next/navigation";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";
import { authEnabled, currentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

function GoogleMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6C44.1 38 46.5 31.8 46.5 24.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.2C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

// The front door (SPEC.md §2), minimal: the wordmark, two lines, one button.
// Signed-in readers pass straight through; with sign-in off it points into
// the app.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const enabled = authEnabled();
  if (enabled && (await currentUser())) redirect("/");
  const t = await serverT();

  // Known /api/auth/callback failure phrases → the UI language (unknown → raw).
  const authErrors: Record<string, string> = {
    "Google returned no code": t("signin.errNoCode"),
    "Sign-in state mismatch — try again": t("signin.errState"),
    "Could not verify your Google identity": t("signin.errVerify"),
  };

  return (
    <div className="flex min-h-screen flex-col px-6">
      <header className="mx-auto flex w-full max-w-md justify-end pt-6">
        <LangSwitcher />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
        <div className="rise-in">
          <div className="flex items-center gap-2.5">
            <Logo size={34} className="text-clay" />
            <span className="font-display text-2xl text-sand-800">{t("common.appName")}</span>
          </div>

          <h1 className="mt-7 font-display text-4xl leading-[1.15] text-sand-800">
            {t("signin.heroA")}
            <br />
            <em className="text-clay not-italic">{t("signin.heroAccent")}</em>
          </h1>

          {error && (
            <p className="mt-7 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {authErrors[error] ?? error}
            </p>
          )}

          {enabled ? (
            <>
              <a
                href="/api/auth/login"
                className="mt-9 flex h-12 items-center justify-center gap-2.5 rounded-full bg-clay text-sm font-semibold text-clay-fg shadow-soft hover:bg-clay-600 active:scale-[0.99]"
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-white">
                  <GoogleMark />
                </span>
                {t("signin.google")}
              </a>
              <p className="mt-3.5 text-center text-xs text-sand-500">{t("signin.accountNote")}</p>
            </>
          ) : (
            <div className="mt-9 rounded-2xl bg-card px-5 py-4 shadow-soft">
              <p className="text-sm font-semibold text-sand-800">{t("signin.singleTitle")}</p>
              <p className="mt-1 text-xs leading-relaxed text-sand-600">{t("signin.singleDesc")}</p>
              <Link
                href="/"
                className="mt-2.5 inline-block rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600"
              >
                {t("signin.singleContinue")}
              </Link>
            </div>
          )}
        </div>
      </main>

      <footer className="mx-auto w-full max-w-md pb-6 text-center text-[11px] text-sand-500">
        <Link href="/privacy" className="hover:text-clay-700">
          {t("legal.seePrivacy")}
        </Link>
        <span aria-hidden> · </span>
        <Link href="/terms" className="hover:text-clay-700">
          {t("legal.seeTerms")}
        </Link>
      </footer>
    </div>
  );
}

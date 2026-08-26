import Link from "next/link";
import { redirect } from "next/navigation";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";
import { authEnabled, currentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import type { TKey } from "@/lib/i18n/dictionaries";

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

// Callouts point from the text in the screenshot: label + position in percent
// of the image, tuned to public/signin-reader.png.
const CALLOUTS: { key: TKey; left: string; top: string; alignRight?: boolean }[] = [
  { key: "signin.calloutAssistant", left: "2%", top: "13%" },
  { key: "signin.calloutDistill", left: "44%", top: "3%" },
  { key: "signin.calloutHighlight", left: "24%", top: "29%" },
  { key: "signin.calloutComment", left: "56.5%", top: "48%" },
  { key: "signin.calloutExtract", left: "22%", top: "84.5%" },
  { key: "signin.calloutPending", left: "97%", top: "40%", alignRight: true },
];

const FUNCTIONS: TKey[] = [
  "signin.fn1",
  "signin.fn2",
  "signin.fn3",
  "signin.fn4",
  "signin.fn5",
  "signin.fn6",
  "signin.fn7",
  "signin.fn8",
  "signin.fn9",
  "signin.fn10",
  "signin.fn11",
  "signin.fn12",
];

// The front door (SPEC.md §2): the hero and one button on the left; on the
// right the reader as it is — a real screenshot on Attention Is All You Need
// with the functions labeled from the text; below, the key functions listed.
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
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between pt-6">
        <div className="flex items-center gap-2.5">
          <Logo size={30} className="text-clay" />
          <span className="font-display text-xl text-sand-800">{t("common.appName")}</span>
        </div>
        <LangSwitcher />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 py-10 lg:py-14">
        <div className="grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
          {/* The pitch: two lines, one button */}
          <div className="rise-in">
            <h1 className="font-display text-4xl leading-[1.15] text-sand-800">
              {t("signin.heroA")}
              <br />
              <em className="text-clay not-italic">{t("signin.heroAccent")}</em>
            </h1>

            {error && (
              <p className="mt-6 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
                {authErrors[error] ?? error}
              </p>
            )}

            {enabled ? (
              <>
                <a
                  href="/api/auth/login"
                  className="mt-8 flex h-12 max-w-sm items-center justify-center gap-2.5 rounded-full bg-clay text-sm font-semibold text-clay-fg shadow-soft hover:bg-clay-600 active:scale-[0.99]"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-white">
                    <GoogleMark />
                  </span>
                  {t("signin.google")}
                </a>
                <p className="mt-3.5 max-w-sm text-center text-xs text-sand-500">
                  {t("signin.accountNote")}
                </p>
              </>
            ) : (
              <div className="mt-8 max-w-sm rounded-2xl bg-card px-5 py-4 shadow-soft">
                <p className="text-sm font-semibold text-sand-800">{t("signin.singleTitle")}</p>
                <p className="mt-1 text-xs leading-relaxed text-sand-600">
                  {t("signin.singleDesc")}
                </p>
                <Link
                  href="/"
                  className="mt-2.5 inline-block rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600"
                >
                  {t("signin.singleContinue")}
                </Link>
              </div>
            )}
          </div>

          {/* The reader as it is, functions labeled from the text */}
          <div className="rise-in-late relative">
            <div className="overflow-hidden rounded-2xl border border-line shadow-float">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/signin-reader.png" alt={t("signin.screenshotAlt")} className="block w-full" />
            </div>
            {CALLOUTS.map((c) => (
              <span
                key={c.key}
                aria-hidden
                className={`absolute hidden items-center gap-1.5 rounded-full bg-ink/90 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-paper shadow-float sm:inline-flex ${c.alignRight ? "-translate-x-full" : ""}`}
                style={{ left: c.left, top: c.top }}
              >
                <span className="size-1.5 rounded-full bg-clay-400" />
                {t(c.key)}
              </span>
            ))}
          </div>
        </div>

        {/* Key functions, listed */}
        <section className="mt-14 lg:mt-16">
          <h2 className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
            {t("signin.functionsTitle")}
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-x-10 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {FUNCTIONS.map((key) => (
              <li key={key} className="flex items-start gap-2.5 text-sm text-sand-700">
                <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-clay-300" />
                {t(key)}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl pb-6 text-center text-[11px] text-sand-500">
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

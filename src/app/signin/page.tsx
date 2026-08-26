import Link from "next/link";
import { redirect } from "next/navigation";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";
import { authEnabled, currentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

function GoogleMark({ size = 18 }: { size?: number }) {
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

// The showcase: the anchored-note moment, static, before anything is asked of
// the visitor. A reader excerpt with a highlighted sentence, the pending note
// it became, and the source chip that points back.
function Showcase({ t }: { t: TFunc }) {
  return (
    <div className="rounded-3xl bg-card p-5 shadow-soft sm:p-6">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-sand-800">
        <Logo size={14} className="text-clay" /> {t("signin.showcaseTitle")}
      </p>

      <div className="rounded-2xl bg-paper p-4">
        <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("signin.showcaseDocTitle")}
        </p>
        <div className="mt-2.5 space-y-2 text-[13px] leading-relaxed text-sand-700">
          <p>{t("signin.showcaseLine1")}</p>
          <p>
            <span className="rounded bg-clay-100 px-1 py-0.5 text-clay-800">
              {t("signin.showcaseLine2")}
            </span>
          </p>
          <p>{t("signin.showcaseLine3")}</p>
        </div>
      </div>

      <div aria-hidden className="ml-8 h-4 w-px border-l border-dashed border-clay-300" />

      <div className="rounded-xl border-l-2 border-amber-400 bg-paper p-3.5">
        <p className="text-[10px] font-bold tracking-[0.08em] text-sand-500 uppercase">
          {t("signin.showcaseNoteLabel")}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-sand-800">{t("signin.showcaseNote")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold text-clay-800">
            {t("signin.showcaseSource")}
          </span>
          <span className="text-[10px] text-sand-500">{t("signin.showcaseAccept")}</span>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-sand-600">{t("signin.showcaseCaption")}</p>
    </div>
  );
}

const PROPS: { label: TKey; sub: TKey; icon: React.ReactNode }[] = [
  {
    label: "signin.prop1Label",
    sub: "signin.prop1Sub",
    icon: (
      <path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2V5Zm9-2h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5V3Z" />
    ),
  },
  {
    label: "signin.prop2Label",
    sub: "signin.prop2Sub",
    icon: <path d="m14 4 6 6-9 9H5v-6l9-9Zm-3 3-6 6M13 19h7" />,
  },
  {
    label: "signin.prop3Label",
    sub: "signin.prop3Sub",
    icon: <path d="M4 4h16l-6 8v6l-4 2v-8L4 4Z" />,
  },
  {
    label: "signin.prop4Label",
    sub: "signin.prop4Sub",
    icon: (
      <path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2m0-12-2 2M8 16l-2 2m6-9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    ),
  },
];

// The front door (SPEC.md §2): a consumer landing page — nav, hero with the
// CTA card, the anchored-note showcase, value tiles, footer. Signed-in readers
// pass straight through; with sign-in off it points into the app.
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
    <div className="flex min-h-screen flex-col">
      {/* Top nav */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 pt-6">
        <div className="flex items-center gap-2.5">
          <Logo size={30} className="text-clay" />
          <span className="font-display text-xl text-sand-800">{t("common.appName")}</span>
        </div>
        <div className="flex items-center gap-2">
          <LangSwitcher />
          {enabled && (
            <a
              href="/api/auth/login"
              className="rounded-full px-4 py-1.5 text-sm font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("signin.navSignIn")}
            </a>
          )}
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pt-12 pb-16 lg:pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          {/* Left — the pitch + CTA */}
          <div className="rise-in">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-clay-100 px-3 py-1.5 text-xs font-semibold text-clay-800">
              <span aria-hidden className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-clay-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-clay-500" />
              </span>
              {t("signin.badge")}
            </div>

            <h1 className="font-display text-[2.4rem] leading-[1.12] text-balance text-sand-800 sm:text-5xl">
              {t("signin.heroA")}
              <br />
              <em className="text-clay not-italic">{t("signin.heroAccent")}</em>
            </h1>

            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-sand-700 sm:text-base">
              {t("signin.heroDesc")}
            </p>

            {error && (
              <p className="mt-6 max-w-xl rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
                {authErrors[error] ?? error}
              </p>
            )}

            {/* CTA card */}
            <div className="mt-8 max-w-xl">
              {enabled ? (
                <div className="rounded-2xl bg-card p-5 shadow-soft">
                  <p className="mb-3.5 text-sm font-semibold text-sand-800">{t("signin.ctaNew")}</p>
                  <a
                    href="/api/auth/login"
                    className="flex h-12 items-center justify-center gap-2.5 rounded-full bg-clay text-sm font-semibold text-clay-fg shadow-soft hover:bg-clay-600 active:scale-[0.99]"
                  >
                    <span className="flex size-7 items-center justify-center rounded-full bg-white">
                      <GoogleMark size={15} />
                    </span>
                    {t("signin.google")}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M5 12h14m-6-6 6 6-6 6" />
                    </svg>
                  </a>
                  <p className="mt-3 text-center text-[11px] text-sand-500">{t("signin.ctaNote")}</p>
                  <p className="mt-1 text-center text-[11px] text-sand-500">
                    {t("signin.accountNote")}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl bg-card px-5 py-4 shadow-soft">
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
          </div>

          {/* Right — the showcase, with the anchor chip floating over it */}
          <div className="rise-in-late relative">
            <Showcase t={t} />
            <div className="absolute -top-3.5 -right-2 rotate-2 rounded-xl bg-sage-200 px-3 py-1.5 text-[11px] font-semibold text-sage-800 shadow-soft sm:-right-4">
              {t("signin.showcaseChip")}
            </div>
          </div>
        </div>

        {/* Value tiles */}
        <div className="mt-16 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
          {PROPS.map((p) => (
            <div key={p.label} className="rounded-2xl bg-card p-5 shadow-soft">
              <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-clay-100">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-clay"
                  aria-hidden
                >
                  {p.icon}
                </svg>
              </div>
              <p className="text-sm leading-snug font-bold text-sand-800">{t(p.label)}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-sand-600">{t(p.sub)}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 py-5 text-[11px] text-sand-500 sm:flex-row">
          <span className="flex items-center gap-1.5">
            <Logo size={14} className="text-clay" /> {t("common.appName")}
          </span>
          <span>{t("signin.footerTagline")}</span>
          <span>
            <Link href="/privacy" className="hover:text-clay-700">
              {t("legal.seePrivacy")}
            </Link>
            <span aria-hidden> · </span>
            <Link href="/terms" className="hover:text-clay-700">
              {t("legal.seeTerms")}
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";
import { appleEnabled, authEnabled, currentUser, emailEnabled, googleEnabled } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import type { TKey } from "@/lib/i18n/dictionaries";
import { ReaderShowcase } from "./reader-showcase";

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

function AppleMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 12.54c-.03-2.36 1.93-3.49 2.02-3.55-1.1-1.61-2.81-1.83-3.42-1.85-1.45-.15-2.84.86-3.58.86-.74 0-1.88-.84-3.1-.82-1.59.02-3.06.93-3.88 2.36-1.66 2.87-.42 7.12 1.19 9.45.79 1.14 1.73 2.42 2.96 2.37 1.19-.05 1.64-.77 3.08-.77s1.84.77 3.1.75c1.28-.02 2.09-1.16 2.87-2.31.9-1.32 1.28-2.6 1.3-2.67-.03-.01-2.5-.96-2.54-3.82ZM14.7 5.6c.65-.79 1.09-1.89.97-2.98-.94.04-2.07.62-2.74 1.41-.6.7-1.13 1.82-.99 2.89 1.05.08 2.11-.53 2.76-1.32Z" />
    </svg>
  );
}

// The clay submit pill every Unitos-account form ends in.
function UnitosButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-clay text-sm font-semibold text-clay-fg shadow-[0_8px_24px_-10px_rgba(217,138,82,0.7)] hover:brightness-110 active:scale-[0.99]"
    >
      <Logo size={16} />
      {label}
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
    </button>
  );
}

// Callouts point from the text: chip, a dotted connector, and a dot on the
// exact spot in the screenshot. All positions are percent of the image,
// tuned to public/signin-reader.png. Array order is the tour order the
// cursor walks: highlight → comment → pending note → distill → extract →
// assistant.
type Callout = {
  key: TKey;
  chip: { left: string; top: string };
  alignRight?: boolean;
  line: { x1: number; y1: number; x2: number; y2: number };
  dot: { x: number; y: number };
};
const CALLOUTS: Callout[] = [
  {
    key: "signin.calloutHighlight",
    chip: { left: "1.5%", top: "48.5%" },
    line: { x1: 15, y1: 49, x2: 34, y2: 36 },
    dot: { x: 36, y: 34.3 },
  },
  {
    key: "signin.calloutComment",
    chip: { left: "46%", top: "60%" },
    line: { x1: 56, y1: 60.5, x2: 68, y2: 53.5 },
    dot: { x: 69.3, y: 52.3 },
  },
  {
    key: "signin.calloutPending",
    chip: { left: "98%", top: "43%" },
    alignRight: true,
    line: { x1: 88, y1: 43, x2: 86.2, y2: 30 },
    dot: { x: 86.2, y: 28 },
  },
  {
    key: "signin.calloutDistill",
    chip: { left: "36%", top: "2%" },
    line: { x1: 62, y1: 4.2, x2: 71, y2: 8.2 },
    dot: { x: 72.3, y: 9 },
  },
  {
    key: "signin.calloutExtract",
    chip: { left: "9%", top: "89%" },
    line: { x1: 24, y1: 89, x2: 33.5, y2: 82 },
    dot: { x: 35, y: 80.5 },
  },
  {
    key: "signin.calloutAssistant",
    chip: { left: "1.5%", top: "40%" },
    line: { x1: 6, y1: 39.5, x2: 7.2, y2: 26.5 },
    dot: { x: 7.2, y: 25 },
  },
];

// Only functions you need, as panels: icon chip, name, one line on what it does.
const FUNCTIONS: { key: TKey; sub: TKey; icon: React.ReactNode }[] = [
  {
    key: "signin.fnAssistant",
    sub: "signin.fnAssistantSub",
    icon: (
      <path d="M12 3a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V18a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3A7 7 0 0 1 12 3Zm-2 19h4" />
    ),
  },
  {
    key: "signin.fnNotes",
    sub: "signin.fnNotesSub",
    icon: <path d="m14 4 6 6-9 9H5v-6l9-9Zm-3 3-6 6M13 19h7" />,
  },
  {
    key: "signin.fnHighlight",
    sub: "signin.fnHighlightSub",
    icon: <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Zm-12-1h6m-6 4h4" />,
  },
  {
    key: "signin.fnExplain",
    sub: "signin.fnExplainSub",
    icon: (
      <path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2m0-12-2 2M8 16l-2 2m6-9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    ),
  },
  {
    key: "signin.fnSimplify",
    sub: "signin.fnSimplifySub",
    icon: <path d="M5 7h14M8 12h8M10 17h4" />,
  },
  {
    key: "signin.fnDistill",
    sub: "signin.fnDistillSub",
    icon: <path d="M4 4h16l-6 8v6l-4 2v-8L4 4Z" />,
  },
  {
    key: "signin.fnExtract",
    sub: "signin.fnExtractSub",
    icon: <path d="M4 6h16M4 12h16M4 18h9m4-2 4 4m0-4-4 4" />,
  },
];

// The front door (SPEC.md §2), dark by design: the hero, one glowing CTA card
// (Unitos account form on top, then Google and Apple), and the mark as a
// dimmed backdrop on the left; on the right the reader in motion — a cursor
// tours the screenshot and each function's callout fades in as it is used;
// below, only the functions you need, two rows of panels. The wrapper carries
// .dark so every token resolves to the dark ramp, whatever theme the
// visitor's system prefers.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; mode?: string }>;
}) {
  const { error, sent, mode: rawMode } = await searchParams;
  // The Unitos-account block has three modes: sign up (default), sign in
  // (email + password), forgot (email → reset link).
  const mode = rawMode === "in" || rawMode === "forgot" ? rawMode : "up";
  const enabled = authEnabled();
  if (enabled && (await currentUser())) redirect("/");
  const t = await serverT();

  // Known failure phrases → the UI language (unknown → raw).
  const authErrors: Record<string, string> = {
    "Google returned no code": t("signin.errNoCode"),
    "Apple returned no code": t("signin.errAppleNoCode"),
    "Sign-in state mismatch — try again": t("signin.errState"),
    "Could not verify your Google identity": t("signin.errVerify"),
    "Could not verify your Apple identity": t("signin.errAppleVerify"),
    "Enter a valid email": t("signin.errEmailInvalid"),
    "Could not send the confirmation email — try again": t("signin.errEmailSend"),
    "Confirmation link expired or already used — request a new one": t("signin.errEmailToken"),
    "Wrong email or password": t("signin.errBadLogin"),
    "This account has no password yet — use Forgot password to set one":
      t("signin.errNoPassword"),
  };

  const inputCls =
    "h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-sm text-ink placeholder:text-sand-600 focus:border-clay/60 focus:outline-none";
  const cardTitle =
    mode === "in"
      ? t("signin.signinTitle")
      : mode === "forgot"
        ? t("signin.forgotTitle")
        : t("signin.ctaTitle");

  return (
    <div className="dark relative flex min-h-screen flex-col overflow-hidden bg-[#14110d] text-ink">
      {/* Backdrop: clay glow + dot lattice + the mark covering the top-left quadrant, behind everything */}
      <div aria-hidden className="signin-glow pointer-events-none absolute inset-0" />
      <div aria-hidden className="signin-dots pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute top-0 left-0 h-1/2 w-1/2 opacity-[0.07]">
        <Logo size="100%" fit="cover" className="text-clay" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-[1560px] items-center justify-between px-6 pt-6 sm:px-10">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl border border-clay/30 bg-clay/12">
            <Logo size={22} className="text-clay" />
          </span>
          <span className="font-display text-xl text-ink">{t("common.appName")}</span>
        </div>
        <LangSwitcher />
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1560px] flex-1 px-6 pt-10 pb-16 sm:px-10 lg:pt-4">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          {/* The pitch: the hero and the CTA card; the mark covers the page backdrop above */}
          <div className="rise-in relative">
            <h1 className="font-display text-balance text-ink">
              <span className="block text-[2.6rem] leading-[1.04] [-webkit-text-stroke:1px_currentColor] sm:text-[3.4rem] xl:text-[4.15rem]">
                {t("signin.heroA")}
              </span>
              <span className="mt-3 block text-[1.45rem] leading-[1.2] text-clay [text-shadow:0_0_30px_rgba(217,138,82,0.45)] sm:text-[1.85rem] xl:text-[2.15rem]">
                {t("signin.heroAccent")}
              </span>
            </h1>

            {error && (
              <p className="relative mt-6 max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                {authErrors[error] ?? error}
              </p>
            )}

            {enabled && sent ? (
              // Check your email — the account exists once the link is clicked.
              <div className="relative mt-8 max-w-md rounded-2xl border border-clay/30 bg-white/[0.03] p-5 shadow-[0_0_50px_-18px_rgba(217,138,82,0.5)] backdrop-blur-sm">
                <span className="mb-3.5 flex size-11 items-center justify-center rounded-xl border border-clay/25 bg-clay/12 text-clay">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 1 8 6 8-6" />
                  </svg>
                </span>
                <p className="text-base font-semibold text-ink">{t("signin.sentTitle")}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-sand-600">
                  {t(mode === "forgot" ? "signin.resetSentTo" : "signin.sentTo")}{" "}
                  <strong className="font-semibold text-ink">{sent}</strong>
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-sand-600">
                  {t(mode === "forgot" ? "signin.resetSentRest" : "signin.sentRest")}
                </p>
                <Link
                  href={mode === "forgot" ? "/signin?mode=forgot" : "/signin"}
                  className="mt-3 inline-block text-xs font-semibold text-clay hover:brightness-110"
                >
                  {t("signin.sentBack")}
                </Link>
              </div>
            ) : enabled ? (
              <div className="relative mt-8 max-w-md rounded-2xl border border-clay/30 bg-white/[0.03] p-5 shadow-[0_0_50px_-18px_rgba(217,138,82,0.5)] backdrop-blur-sm">
                <div className="mb-3.5 flex items-center gap-2">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="text-clay"
                    aria-hidden
                  >
                    <path d="M11 4l1.7 4.3L17 10l-4.3 1.7L11 16l-1.7-4.3L5 10l4.3-1.7L11 4Zm7 9 .9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9L18 13Z" />
                  </svg>
                  <span className="text-sm font-semibold text-ink">{cardTitle}</span>
                </div>
                <div className="space-y-3">
                  {emailEnabled() && mode === "up" && (
                    <form action="/api/auth/email/start" method="post" className="space-y-2.5">
                      <div className="grid grid-cols-[0.8fr_1.2fr] gap-2.5">
                        <input
                          name="name"
                          type="text"
                          autoComplete="name"
                          maxLength={80}
                          placeholder={t("signin.nameLabel")}
                          aria-label={t("signin.nameLabel")}
                          className={inputCls}
                        />
                        <input
                          name="email"
                          type="email"
                          required
                          autoComplete="email"
                          maxLength={200}
                          placeholder={t("signin.emailLabel")}
                          aria-label={t("signin.emailLabel")}
                          className={inputCls}
                        />
                      </div>
                      <UnitosButton label={t("signin.unitos")} />
                      <p className="text-center text-xs text-sand-600">
                        <Link href="/signin?mode=in" className="font-semibold text-clay hover:brightness-110">
                          {t("signin.toSignin")}
                        </Link>
                      </p>
                    </form>
                  )}
                  {emailEnabled() && mode === "in" && (
                    <form action="/api/auth/password/login" method="post" className="space-y-2.5">
                      <input
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        maxLength={200}
                        placeholder={t("signin.emailLabel")}
                        aria-label={t("signin.emailLabel")}
                        className={inputCls}
                      />
                      <input
                        name="password"
                        type="password"
                        required
                        autoComplete="current-password"
                        maxLength={200}
                        placeholder={t("signin.passwordLabel")}
                        aria-label={t("signin.passwordLabel")}
                        className={inputCls}
                      />
                      <UnitosButton label={t("signin.unitos")} />
                      <p className="flex justify-between text-xs text-sand-600">
                        <Link href="/signin?mode=forgot" className="font-semibold text-clay hover:brightness-110">
                          {t("signin.forgot")}
                        </Link>
                        <Link href="/signin" className="font-semibold text-clay hover:brightness-110">
                          {t("signin.toSignup")}
                        </Link>
                      </p>
                    </form>
                  )}
                  {emailEnabled() && mode === "forgot" && (
                    <form action="/api/auth/password/forgot" method="post" className="space-y-2.5">
                      <input
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        maxLength={200}
                        placeholder={t("signin.emailLabel")}
                        aria-label={t("signin.emailLabel")}
                        className={inputCls}
                      />
                      <UnitosButton label={t("signin.sendReset")} />
                      <p className="text-center text-xs text-sand-600">
                        <Link href="/signin?mode=in" className="font-semibold text-clay hover:brightness-110">
                          {t("signin.toSignin")}
                        </Link>
                      </p>
                    </form>
                  )}
                  {emailEnabled() && (googleEnabled() || appleEnabled()) && (
                    <div className="flex items-center gap-3 text-[11px] text-sand-600">
                      <span className="h-px flex-1 bg-white/10" />
                      {t("signin.or")}
                      <span className="h-px flex-1 bg-white/10" />
                    </div>
                  )}
                  {googleEnabled() && (
                    <a
                      href="/api/auth/login"
                      className="flex h-12 items-center justify-center gap-2.5 rounded-full bg-white text-sm font-semibold text-[#3c4043] shadow-soft hover:brightness-95 active:scale-[0.99]"
                    >
                      <GoogleMark />
                      {t("signin.google")}
                    </a>
                  )}
                  {appleEnabled() && (
                    <a
                      href="/api/auth/apple/login"
                      className="flex h-12 items-center justify-center gap-2.5 rounded-full bg-ink text-sm font-semibold text-paper shadow-soft hover:brightness-95 active:scale-[0.99]"
                    >
                      <AppleMark />
                      {t("signin.apple")}
                    </a>
                  )}
                </div>
                <p className="mt-3 text-center text-[11px] text-sand-600">
                  {t("signin.accountNote")}
                </p>
              </div>
            ) : (
              <div className="relative mt-8 max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
                <p className="text-sm font-semibold text-ink">{t("signin.singleTitle")}</p>
                <p className="mt-1 text-xs leading-relaxed text-sand-600">
                  {t("signin.singleDesc")}
                </p>
                <Link
                  href="/"
                  className="mt-3 inline-block rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:brightness-110"
                >
                  {t("signin.singleContinue")}
                </Link>
              </div>
            )}
          </div>

          {/* The reader in motion: the cursor walks the functions, callouts fade in */}
          <div className="rise-in-late relative">
            <div className="rounded-3xl bg-gradient-to-b from-clay/35 via-white/10 to-transparent p-px shadow-[0_0_80px_-30px_rgba(217,138,82,0.45)]">
              <div className="rounded-[calc(1.5rem-1px)] bg-card/90 p-4 backdrop-blur-xl sm:p-5">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <Logo size={14} className="text-clay" />
                  {t("signin.showcaseTitle")}
                </p>
                <ReaderShowcase
                  src="/signin-reader.png"
                  alt={t("signin.screenshotAlt")}
                  callouts={CALLOUTS.map((c) => ({
                    text: t(c.key),
                    chip: c.chip,
                    alignRight: c.alignRight,
                    line: c.line,
                    dot: c.dot,
                  }))}
                />
                <p className="mt-3 text-[11px] leading-relaxed text-sand-600">
                  {t("signin.showcaseCaption")}
                </p>
              </div>
            </div>
            {/* Floating chip — the product's core moment */}
            <span className="absolute -top-3.5 -right-2 rotate-2 rounded-full border border-clay/40 bg-clay/15 px-3 py-1.5 text-[11px] font-semibold text-clay-800 shadow-[0_0_24px_-6px_rgba(217,138,82,0.7)] backdrop-blur sm:-right-4">
              {t("signin.chipAccepted")}
            </span>
          </div>
        </div>

        {/* Only functions you need: two rows, right beneath the hero */}
        <section className="rise-in-later mt-12 lg:mt-14">
          <h2 className="text-center font-display text-[1.65rem] text-ink sm:text-3xl">
            {t("signin.functionsTitle")}
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {FUNCTIONS.map((f) => (
              <div
                key={f.key}
                className="flex w-full flex-col rounded-2xl border border-white/[0.07] bg-white/[0.03] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-clay/40 hover:bg-white/[0.05] hover:shadow-[0_0_40px_-12px_rgba(217,138,82,0.6)] sm:w-[calc(50%-0.5rem)] lg:w-[calc(25%-0.75rem)]"
              >
                <div className="flex items-center gap-3.5">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-clay/25 bg-clay/12 text-clay">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      {f.icon}
                    </svg>
                  </span>
                  <p className="text-lg leading-snug font-bold text-ink">{t(f.key)}</p>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-sand-600">{t(f.sub)}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-[1560px] flex-col items-center justify-between gap-2 px-6 py-5 text-[11px] text-sand-600 sm:flex-row sm:px-10">
          <span className="flex items-center gap-1.5">
            <Logo size={14} className="text-clay/80" />
            {t("common.appName")}
          </span>
          <span>{t("signin.tagline")}</span>
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

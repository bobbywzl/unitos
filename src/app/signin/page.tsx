import { Noto_Serif_Display } from "next/font/google";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FunnelStepMark } from "@/components/funnel-step";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";
import { isAdmin } from "@/lib/admin-auth";
import { appleEnabled, authEnabled, currentUser, emailEnabled, googleEnabled } from "@/lib/auth";
import { billingOn } from "@/lib/billing/switch";
import { serverT } from "@/lib/i18n/server";
import { PlansStory } from "@/app/plans/plans-story";
import { BetaNotice } from "./beta-notice";
import { HeroPitch, type PitchRow } from "./hero-pitch";
import { HeroReel } from "./hero-reel";
import { ReaderDeck } from "./reader-deck";

export const dynamic = "force-dynamic";

// The sign-in page's display face (.font-hero in globals.css): a condensed,
// high-contrast serif, set in capitals — formal and eye-catching, unlike
// Caprasimo, which carries headings inside the app. Variable weight and
// width; .font-hero picks 900 and 66%.
const heroFont = Noto_Serif_Display({
  variable: "--font-hero",
  axes: ["wdth"],
  subsets: ["latin"],
  display: "swap",
});

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

// The clay submit pill every Unitos-account form ends in: the mark, the
// label, an arrow.
function UnitosButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="flex h-[50px] w-full items-center justify-center gap-2.5 rounded-full bg-clay text-[15px] font-bold text-[#1d1610] shadow-[0_10px_28px_-10px_rgba(217,138,82,0.8)] hover:bg-[#e69a63] active:scale-[0.99]"
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

// The front door (SPEC.md §2), dark by design: the hero, the sign-in card
// under a clay glow (the email alone, Start now, then Google and Apple) with
// the sentence beside it — no billing information — and the mark as a dimmed
// backdrop on the left; on the right the reader deck: five screens of the
// app, each a drawn mock with a looping demo. Under the fold, when billing
// is on, the plans story (app/plans/plans-story.tsx) follows down a
// gradient from the dark ground to its cream. The wrapper carries .dark so
// every token resolves to the dark ramp, whatever theme the visitor's
// system prefers.
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
  // The plans story under the fold (SPEC.md §24): while the billing switch
  // is on, or as the admin's preview; off, the page ends at the front door.
  const plansOn = enabled && (await billingOn());
  const plans = plansOn || (enabled && (await isAdmin()));

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
    "This email is blocked": t("signin.errBlocked"),
  };

  const inputCls =
    "h-12 w-full rounded-[14px] border border-white/[0.14] bg-white/[0.05] px-4 text-[15px] text-ink placeholder:text-sand-600 focus:border-clay/70 focus:outline-none";
  const link = "font-semibold text-clay hover:brightness-110";
  const deckTabs = t("signin.deckTabs").split("|");
  const deckCaptions = t("signin.deckCaptions").split("|");
  const cardTitle =
    mode === "in"
      ? t("signin.signinTitle")
      : mode === "forgot"
        ? t("signin.forgotTitle")
        : t("signin.ctaTitle");
  // The hero's first line splits at {item}, where the reel goes.
  const [heroBefore = "", heroAfter = ""] = t("signin.heroA").split("{item}");
  const heroItems = t("signin.heroItems").split("|");
  // The pitch: the lead line, three rows each stamped Done, then the closer
  // (hero-pitch.tsx).
  const pitchRows: PitchRow[] = [
    { text: t("signin.heroPitchLead"), done: false, lead: true },
    { text: t("signin.heroPitchRow1"), done: true },
    { text: t("signin.heroPitchRow2"), done: true },
    { text: t("signin.heroPitchRow3"), done: true },
    { text: t("signin.heroPitchClose"), done: false, close: true },
  ];

  return (
    <div
      className={`${heroFont.variable} dark relative flex min-h-screen flex-col overflow-x-clip bg-[#14110d] text-ink`}
    >
      {/* The onboarding funnel (lib/funnel.ts): the first step. */}
      <FunnelStepMark step="signin" />
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

      {/* The beta notice, once per tab: Unitos is in beta, and free and
          unlimited for beta accounts for now. */}
      {enabled && <BetaNotice />}

      <main className="relative z-10 mx-auto w-full max-w-[1560px] flex-1 px-6 pt-10 pb-20 sm:px-10 lg:pt-4">
        <section className="grid items-center gap-[clamp(28px,4vw,56px)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr))]">
          {/* The pitch: the hero, the card, the sentence beside it */}
          <div className="rise-in relative @container">
            {/* Capitals in the hero face, heaviest weight: "Got a ___?" with
                the reel in the blank — the "?" travels inside each item —
                as large as the column allows, then "Put it in Unitos."
                smaller. The type sizes with the column (cqw): the reel is as
                wide as its longest item, about 10em with the tracking, so
                the reel fills the column and "GOT" takes the line above it. */}
            <h1 className="font-hero text-ink uppercase">
              <span className="block text-[length:clamp(1.75rem,7.6cqw,3.5rem)] leading-[1.05]">
                <HeroReel before={heroBefore} items={heroItems} after={heroAfter} />
              </span>
              <span className="mt-2 block text-[length:clamp(1.25rem,5.7cqw,2.6rem)] leading-[1.05]">
                {t("signin.heroB")}
              </span>
            </h1>
            <HeroPitch rows={pitchRows} doneLabel={t("common.done")} />

            {error && (
              <p className="relative mt-6 max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                {authErrors[error] ?? error}
              </p>
            )}

            <div className="mt-7 grid items-center gap-6 [grid-template-columns:minmax(0,440px)] sm:[grid-template-columns:minmax(0,440px)_minmax(220px,320px)]">
              <div className="relative">
                {/* The halo behind the card, breathing with the card's ring. */}
                {enabled && <div aria-hidden className="si-halo pointer-events-none absolute -inset-[30px] rounded-[40px]" />}
                {enabled && sent ? (
                  // Check your email — the account opens once the link is clicked.
                  <div className="si-card-glow relative rounded-[20px] bg-[rgba(28,23,18,0.9)] p-[22px] backdrop-blur-[10px]">
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
                    <Link href={mode === "forgot" ? "/signin?mode=forgot" : "/signin"} className={`mt-3 inline-block text-xs ${link}`}>
                      {t("signin.sentBack")}
                    </Link>
                  </div>
                ) : enabled ? (
                  <div className="si-card-glow relative rounded-[20px] bg-[rgba(28,23,18,0.9)] p-[22px] backdrop-blur-[10px]">
                    <div className="mb-3.5 flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-clay" aria-hidden>
                        <path d="M11 4l1.7 4.3L17 10l-4.3 1.7L11 16l-1.7-4.3L5 10l4.3-1.7L11 4Zm7 9 .9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9L18 13Z" />
                      </svg>
                      <span className="text-[15px] font-bold text-ink">{cardTitle}</span>
                    </div>
                    {emailEnabled() && mode === "up" && (
                      // Sign-up is the email alone: the confirmation link
                      // opens the account on the dashboard, and no card is
                      // asked for.
                      <form action="/api/auth/email/start" method="post" className="space-y-2.5">
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
                        <UnitosButton label={t("signin.startNow")} />
                        <p className="text-center text-xs text-sand-600">
                          <Link href="/signin?mode=in" className={link}>
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
                        <UnitosButton label={t("signin.signIn")} />
                        <p className="flex justify-between text-xs text-sand-600">
                          <Link href="/signin?mode=forgot" className={link}>
                            {t("signin.forgot")}
                          </Link>
                          <Link href="/signin" className={link}>
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
                          <Link href="/signin?mode=in" className={link}>
                            {t("signin.toSignin")}
                          </Link>
                        </p>
                      </form>
                    )}
                    {emailEnabled() && (googleEnabled() || appleEnabled()) && (
                      <div className="my-3.5 flex items-center gap-3 text-[11px] text-sand-600">
                        <span className="h-px flex-1 bg-white/10" />
                        {t("signin.or")}
                        <span className="h-px flex-1 bg-white/10" />
                      </div>
                    )}
                    <div className="space-y-2.5">
                      {googleEnabled() && (
                        <a
                          href="/api/auth/login"
                          className="flex h-12 items-center justify-center gap-2.5 rounded-full bg-white text-sm font-semibold text-[#3c4043] hover:bg-[#f1eee9] active:scale-[0.99]"
                        >
                          <GoogleMark />
                          {t("signin.google")}
                        </a>
                      )}
                      {appleEnabled() && (
                        <a
                          href="/api/auth/apple/login"
                          className="flex h-12 items-center justify-center gap-2.5 rounded-full bg-ink text-sm font-semibold text-paper hover:brightness-95 active:scale-[0.99]"
                        >
                          <AppleMark />
                          {t("signin.apple")}
                        </a>
                      )}
                    </div>
                    <p className="mt-3 text-center text-[11px] leading-relaxed text-sand-600">{t("signin.accountNote")}</p>
                  </div>
                ) : (
                  <div className="relative rounded-[20px] border border-white/10 bg-[rgba(28,23,18,0.9)] p-[22px] backdrop-blur-[10px]">
                    <p className="text-sm font-semibold text-ink">{t("signin.singleTitle")}</p>
                    <p className="mt-1 text-xs leading-relaxed text-sand-600">{t("signin.singleDesc")}</p>
                    <Link
                      href="/"
                      className="mt-3 inline-block rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:brightness-110"
                    >
                      {t("signin.singleContinue")}
                    </Link>
                  </div>
                )}
              </div>

              {/* The sentence beside the card, the arrow pointing at it:
                  no billing information. */}
              {enabled && (
                <div className="flex flex-col gap-3.5 py-2">
                  <div className="flex items-center gap-2.5 text-[#e9a874]">
                    <svg
                      width="56"
                      height="24"
                      viewBox="0 0 56 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="si-nudge shrink-0"
                      aria-hidden
                    >
                      <path d="M54 12H10" strokeDasharray="6 6" className="si-dash" />
                      <path d="m12 5-8 7 8 7" />
                    </svg>
                    <span className="text-[11px] font-bold tracking-[0.14em] uppercase">{t("signin.noCardKicker")}</span>
                  </div>
                  <p className="font-display text-[clamp(22px,2vw,28px)] leading-[1.2] text-balance text-ink">{t("signin.noCard")}</p>
                  <p className="text-sm leading-[1.55] text-balance text-sand-600">{t("signin.noCardSub")}</p>
                </div>
              )}
            </div>
          </div>

          {/* The reader deck: five screens, scroll or tab across */}
          <div className="rise-in-late relative min-w-0">
            <ReaderDeck
              tabs={deckTabs}
              captions={deckCaptions}
              prevLabel={t("signin.deckPrev")}
              nextLabel={t("signin.deckNext")}
            />
          </div>
        </section>
      </main>

      {plans && (
        <>
          <div aria-hidden className="si-to-plans relative z-10" />
          <div className="plans-root">
            <PlansStory preview={!plansOn} />
          </div>
        </>
      )}

      <footer className="relative z-10 border-t border-white/[0.06] bg-[#0b0a08]">
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

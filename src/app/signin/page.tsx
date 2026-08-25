import Link from "next/link";
import { redirect } from "next/navigation";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";
import { authEnabled, currentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

// The front door (SPEC.md §2): what the product is, one button. Signed-in
// readers pass straight through; with sign-in off it points into the app.
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

  const points = [
    {
      key: "corpora",
      text: t("signin.pointCorpora"),
      icon: (
        <path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2V5Zm9-2h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5V3Z" />
      ),
    },
    {
      key: "notes",
      text: t("signin.pointNotes"),
      icon: <path d="m14 4 6 6-9 9H5v-6l9-9Zm-3 3-6 6M13 19h7" />,
    },
    {
      key: "assistant",
      text: t("signin.pointAssistant"),
      icon: (
        <path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2m0-12-2 2M8 16l-2 2m6-9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
      ),
    },
  ];

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-end">
          <LangSwitcher />
        </div>
        <div className="rounded-3xl bg-card px-8 py-10 shadow-soft">
          <div className="flex items-center gap-3">
            <Logo size={44} className="text-clay" />
            <h1 className="font-display text-[34px]">{t("common.appName")}</h1>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-sand-800">{t("signin.tagline")}</p>

          <ul className="mt-6 space-y-3.5">
            {points.map((p) => (
              <li key={p.key} className="flex items-start gap-3">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 shrink-0 text-clay"
                  aria-hidden
                >
                  {p.icon}
                </svg>
                <span className="text-sm leading-relaxed text-sand-700">{p.text}</span>
              </li>
            ))}
          </ul>

          {error && (
            <p className="mt-6 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {authErrors[error] ?? error}
            </p>
          )}

          {enabled ? (
            <>
              <a
                href="/api/auth/login"
                className="mt-7 flex items-center justify-center gap-3 rounded-full border border-line bg-white px-5 py-3 text-sm font-semibold text-[#1f1f1f] shadow-soft hover:bg-[#f4f1ec]"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
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
                {t("signin.google")}
              </a>
              <p className="mt-4 text-center text-xs text-sand-500">{t("signin.accountNote")}</p>
            </>
          ) : (
            <div className="mt-7 rounded-2xl bg-paper px-4 py-3.5 text-sm">
              <p className="font-semibold text-sand-800">{t("signin.singleTitle")}</p>
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
      </div>
    </main>
  );
}

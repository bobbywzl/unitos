import Link from "next/link";
import { LangSwitcher } from "@/components/lang-switcher";
import { serverT } from "@/lib/i18n/server";

// The billing frame (SPEC.md §24): the ground, the header (a back link and
// the language switcher), and the page's column. Light is the cream ground
// of the plan page and every Unitos Premium page; night is the starry ground
// of the Unitos Ultra order page and confirmation page. The plan page's back
// link goes to the app; every other page's goes back to the plan page.
export async function BillingFrame({
  night = false,
  back,
  preview,
  children,
}: {
  night?: boolean;
  back: "app" | "plans";
  // Billing is off and the admin is looking: the line that says so.
  preview: boolean;
  children: React.ReactNode;
}) {
  const t = await serverT();
  return (
    <div className={`relative isolate min-h-screen overflow-clip ${night ? "billing-night" : "billing-light"}`}>
      <div aria-hidden className="billing-ground-light absolute inset-0 -z-20" />
      {night && (
        <div aria-hidden className="billing-ground-night absolute inset-0 -z-10">
          <div className="billing-stars-a absolute -inset-[4%] opacity-90" />
          <div className="billing-stars-b absolute -inset-[4%] opacity-70" />
        </div>
      )}
      <header className="relative flex items-center justify-between gap-4 px-[clamp(20px,5vw,48px)] py-[22px] print:hidden">
        <Link
          href={back === "app" ? "/" : "/billing"}
          className="inline-flex items-center gap-2 text-sm font-semibold text-(--bl-muted) hover:text-(--bl-link)"
        >
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          {t(back === "app" ? "billing.backToApp" : "billing.backToPlans")}
        </Link>
        <LangSwitcher tone="billing" />
      </header>
      <main className="relative mx-auto w-full max-w-[980px] px-[clamp(20px,5vw,48px)] pt-[clamp(16px,4vh,40px)] pb-[14vh]">
        {preview && (
          <p className="mb-6 rounded-2xl bg-(--bl-track) px-4 py-3 text-xs text-(--bl-muted) print:hidden">
            {t("billing.preview")}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}

// The floating tier mark behind a page's content: the white crystal or the
// black diamond, large and faint, drifting at the top right.
export function TierWatermark({ tier, size }: { tier: "premium" | "ultra"; size: number }) {
  return (
    <div
      aria-hidden
      className="billing-float-slow pointer-events-none absolute -top-[60px] -right-[6%] z-0 opacity-55 max-sm:hidden"
      style={{ width: size, height: size }}
    >
      {tier === "ultra" ? (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M7 4h10l4.5 5.5L12 21 2.5 9.5Z" fill="#1a1713" />
          <path d="M7 4h10l-2 5.5H9Z" fill="#4a423a" />
          <path d="M2.5 9.5 7 4l2 5.5Z" fill="#302a24" />
          <path d="M21.5 9.5 17 4l-2 5.5Z" fill="#302a24" />
          <path d="M9 9.5h6L12 21Z" fill="#3a332c" />
          <path d="M7 4h10l4.5 5.5L12 21 2.5 9.5Z" fill="none" stroke="#d6b26a" strokeOpacity="0.7" strokeWidth="0.3" strokeLinejoin="round" />
          <path d="M2.5 9.5h19M9 9.5 12 21l3-11.5" stroke="#d6b26a" strokeOpacity="0.45" strokeWidth="0.2" />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M12 2l6 6v9l-6 5-6-5V8Z" fill="#ffffff" />
          <path d="M12 2v20l6-5V8Z" fill="#ece6da" />
          <path d="M12 2l6 6-6 3.5Z" fill="#f7f4ee" />
          <path d="M12 11.5V22l-6-5V8Z" fill="#f3efe7" />
          <path d="M12 2l6 6v9l-6 5-6-5V8Z" fill="none" stroke="#c9bfad" strokeWidth="0.35" strokeLinejoin="round" />
          <path d="M6 8l6 3.5L18 8M12 11.5V22" fill="none" stroke="#d3cab9" strokeWidth="0.25" />
        </svg>
      )}
    </div>
  );
}

// A translated line with one value in bold: the date in "Your trial ends on
// {date}". The value is found in the finished string, so the sentence order
// of each language holds.
export function emphasize(text: string, value: string, className = "font-bold text-(--bl-title)"): React.ReactNode {
  const at = value ? text.indexOf(value) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <strong className={className}>{value}</strong>
      {text.slice(at + value.length)}
    </>
  );
}

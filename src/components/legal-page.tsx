import Link from "next/link";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";
import { serverT } from "@/lib/i18n/server";
import type { TKey } from "@/lib/i18n/dictionaries";
import { legalText, type LegalSection } from "@/lib/legal";

// One layout for both legal documents. Public: these pages are linked from the
// Google consent screen, so a signed-out reader must be able to read them
// (middleware lets /privacy and /terms through).
export async function LegalPage({
  title,
  intro,
  sections,
  otherHref,
  otherLabel,
}: {
  title: TKey;
  intro: TKey;
  sections: LegalSection[];
  otherHref: string;
  otherLabel: TKey;
}) {
  const t = await serverT();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <div className="mb-7 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full bg-sand-100 py-[7px] pr-4 pl-3 text-[13px] text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
          >
            <Logo size={16} />
            {t("legal.backToApp")}
          </Link>
          <LangSwitcher />
        </div>
        <h1 className="font-display text-[34px]">{t(title)}</h1>
        <p className="mt-1 text-xs text-sand-500">{t("legal.updated")}</p>
        <p className="mt-4 text-[15px] leading-relaxed text-sand-800">{t(intro)}</p>
      </header>

      <div className="space-y-7">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="mb-2 text-[17px] font-semibold text-sand-800">{t(section.heading)}</h2>
            <div className="space-y-2.5">
              {section.blocks.map((block, i) =>
                "p" in block ? (
                  <p key={i} className="text-sm leading-relaxed text-sand-700">
                    {legalText(t, block.p)}
                  </p>
                ) : (
                  <ul key={i} className="space-y-2 pl-1">
                    {block.ul.map((item) => (
                      <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-sand-700">
                        <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-clay-300" />
                        <span>{legalText(t, item)}</span>
                      </li>
                    ))}
                  </ul>
                ),
              )}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-10 border-t border-line pt-5">
        <Link href={otherHref} className="text-sm text-sand-600 hover:text-clay-700">
          {t(otherLabel)}
        </Link>
      </footer>
    </main>
  );
}

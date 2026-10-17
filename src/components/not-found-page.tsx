import Link from "next/link";
import { Logo } from "@/components/logo";
import { serverT } from "@/lib/i18n/server";
import type { TKey } from "@/lib/i18n/dictionaries";

// The not-found page: its title, one line that says why, and the way back
// to Projects. Server-rendered.
export async function NotFoundPage({ body }: { body: TKey }) {
  const t = await serverT();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-paper px-6">
      <Logo size={120} className="text-sand-400" />
      <h1 className="font-display text-[26px] text-ink">{t("common.notFoundTitle")}</h1>
      <p className="max-w-sm text-center text-sm text-sand-600">{t(body)}</p>
      <Link
        href="/"
        className="rounded-full bg-clay px-5 py-2 text-sm font-semibold text-clay-fg hover:bg-clay-600"
      >
        {t("common.notFoundHome")}
      </Link>
    </main>
  );
}

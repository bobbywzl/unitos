import Link from "next/link";
import { Logo } from "@/components/logo";
import { serverT } from "@/lib/i18n/server";

// Translated 404 for every unmatched route (a corpus id that does not exist,
// a stale link). Server-rendered, with a way back to the shelf.
export default async function NotFound() {
  const t = await serverT();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-paper px-6">
      <Logo size={120} className="text-sand-400" />
      <h1 className="font-display text-[26px] text-ink">{t("common.notFoundTitle")}</h1>
      <p className="max-w-sm text-center text-sm text-sand-600">{t("common.notFoundBody")}</p>
      <Link
        href="/"
        className="rounded-full bg-clay px-5 py-2 text-sm font-semibold text-clay-fg hover:bg-clay-600"
      >
        {t("common.notFoundHome")}
      </Link>
    </main>
  );
}

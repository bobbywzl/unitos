import { Logo } from "@/components/logo";
import { OfflineShelf } from "@/components/offline/offline-shelf";
import { serverT } from "@/lib/i18n/server";

// The offline page (SPEC.md §17, Unitos Ultra). The service worker caches it
// at install and answers every page load with it when the network is gone
// and no saved copy holds the URL. It reads nothing from the server: the
// saved projects come from this browser's IndexedDB. Online again, it goes
// to Projects by itself.
export const dynamic = "force-dynamic";

export default async function OfflinePage() {
  const t = await serverT();
  return (
    <main className="mx-auto w-full max-w-[1080px] px-6 pb-16 sm:px-16">
      <header className="flex items-center gap-3 pt-[26px]">
        <Logo size={38} className="text-clay" />
        <span className="font-display text-[21px]">{t("common.appName")}</span>
      </header>
      <div className="pt-16">
        <OfflineShelf />
      </div>
    </main>
  );
}

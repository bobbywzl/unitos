import Link from "next/link";
import { redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { personOf } from "@/lib/person";
import { Logo } from "@/components/logo";
import { AccountGuard } from "@/components/account-guard";
import { SettingsForm } from "@/components/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const t = await serverT();
  const user = await currentUser();
  if (!user) redirect("/signin");
  const profile = await db.readerProfile.findUnique({ where: { userId: user.id } });

  // The profile is one Background field. Older purpose and application values
  // merge into it here, so nothing typed before the change is lost; the next
  // save writes the merged text and clears the old columns.
  const background = [profile?.background, profile?.purpose, profile?.application]
    .map((v) => v?.trim() ?? "")
    .filter(Boolean)
    .join("\n");

  const account = authEnabled()
    ? {
        ...personOf(user),
        email: user.email,
        storedSymbol: user.symbol,
        storedColor: user.color,
      }
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <AccountGuard userId={user.id} enabled={authEnabled()} />
      <header className="mb-8 flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full bg-sand-100 py-[7px] pr-4 pl-3 text-[13px] text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          <Logo size={16} />
          {t("common.works")}
        </Link>
        <h1 className="text-[28px]">{t("common.settings")}</h1>
      </header>
      <SettingsForm
        account={account}
        background={background}
        premium={authEnabled() ? user.premium : true}
      />
    </main>
  );
}

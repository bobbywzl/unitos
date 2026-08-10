import Link from "next/link";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { Logo } from "@/components/logo";
import { SettingsForm } from "@/components/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await db.readerProfile.findUnique({ where: { userId: USER_ID } });

  // Status only — values never leave the server.
  const services = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    voyage: Boolean(process.env.VOYAGE_API_KEY),
    admin: Boolean(process.env.ADMIN_PASSWORD),
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-8 flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full bg-sand-100 py-[7px] pr-4 pl-3 text-[13px] text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          <Logo size={16} />
          Works
        </Link>
        <h1 className="text-[28px]">Settings</h1>
      </header>
      <SettingsForm
        profile={
          profile
            ? {
                background: profile.background,
                purpose: profile.purpose,
                application: profile.application,
              }
            : null
        }
        services={services}
      />
    </main>
  );
}

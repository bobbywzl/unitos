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
          className="flex items-center gap-2 text-sm text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
        >
          <Logo size={24} />
          <span>Notebooks</span>
        </Link>
        <h1 className="text-lg font-semibold">Settings</h1>
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

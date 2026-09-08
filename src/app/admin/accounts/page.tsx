import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { authEnabled } from "@/lib/auth";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { personColor, personOf, personSymbol, type Person } from "@/lib/person";
import { PersonBadge } from "@/components/collab/person-badge";
import { AdminNav } from "@/components/admin/admin-nav";
import { AccountReset } from "@/components/admin/account-reset";
import { TierControl } from "@/components/admin/tier-control";
import { TierChip } from "@/components/tier-mark";
import { tierState, type TierState } from "@/lib/tiers";

export const dynamic = "force-dynamic";

// Admin: every account, its tier, and what it holds — projects, documents,
// notes — with Tier (components/admin/tier-control.tsx, TIERS.md), which sets
// the account's tier, and Reset account (lib/account-reset.ts), which deletes
// the account's data and puts it back at onboarding. Sign-in off: the local
// reader is the one account; it has no row to set a tier on.

type AccountRow = {
  id: string;
  name: string;
  // null = the local reader: no account row, so no email and no dates.
  email: string | null;
  // The badge (lib/person.ts), with the tier state for the tier mark.
  person: Person;
  createdAt: Date | null;
  lastSeenAt: Date | null;
  // The account's tier state (lib/tiers.ts) and the trial's end when it has one.
  plan: { state: TierState; trialEndsAt: Date | null };
  driveLinked: boolean;
};

type Held = { projects: number; documents: number; notes: number };

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-sand-100 px-2 py-0.5 text-[11px] text-sand-700">{children}</span>
  );
}

export default async function AdminAccountsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  const [users, notebooks] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "desc" } }),
    db.notebook.findMany({
      select: {
        userId: true,
        _count: { select: { documents: true } },
        sections: { select: { _count: { select: { notes: true } } } },
      },
    }),
  ]);
  const held = new Map<string, Held>();
  for (const nb of notebooks) {
    const row = held.get(nb.userId) ?? { projects: 0, documents: 0, notes: 0 };
    row.projects += 1;
    row.documents += nb._count.documents;
    row.notes += nb.sections.reduce((sum, s) => sum + s._count.notes, 0);
    held.set(nb.userId, row);
  }

  const accounts: AccountRow[] = [
    ...(authEnabled()
      ? []
      : [
          {
            id: USER_ID,
            name: t("admin.localReader"),
            email: null,
            person: {
              id: USER_ID,
              name: t("admin.localReader"),
              symbol: personSymbol(t("admin.localReader")),
              color: personColor(USER_ID),
              picture: "",
              tier: "ultra" as const,
            },
            createdAt: null,
            lastSeenAt: null,
            plan: { state: "ultra" as const, trialEndsAt: null },
            driveLinked: false,
          },
        ]),
    ...users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      person: personOf(u),
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      plan: { state: tierState(u), trialEndsAt: u.trialEndsAt },
      driveLinked: Boolean(u.driveRefreshToken),
    })),
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <AdminNav active="accounts" />
      <header className="mb-6">
        <h1 className="text-[28px]">{t("admin.accounts")}</h1>
        <p className="text-sm text-sand-600">{t("admin.accountsDesc")}</p>
      </header>
      {accounts.length === 0 ? (
        <p className="text-sm text-sand-600">{t("admin.noAccounts")}</p>
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => {
            const counts = held.get(a.id) ?? { projects: 0, documents: 0, notes: 0 };
            return (
              <li key={a.id} className="rounded-2xl bg-card p-4 shadow-soft">
                <div className="flex flex-wrap items-center gap-2">
                  <PersonBadge person={a.person} size={28} />
                  <h2 className="text-sm font-bold text-sand-800">{a.name}</h2>
                  <span className="text-xs text-sand-500">{a.email ?? a.id}</span>
                  <Chip>{t("admin.countCorpora", { n: counts.projects })}</Chip>
                  <Chip>{t("admin.countDocuments", { n: counts.documents })}</Chip>
                  <Chip>{t("admin.countNotes", { n: counts.notes })}</Chip>
                  <TierChip
                    state={a.plan.state}
                    trialEndsAt={a.plan.trialEndsAt?.toISOString() ?? null}
                  />
                  {a.driveLinked && <Chip>{t("admin.accountDrive")}</Chip>}
                </div>
                {a.createdAt && a.lastSeenAt && (
                  <p className="mt-2 text-xs text-sand-500">
                    {t("admin.accountCreated", { date: fmtDate(a.createdAt) })} ·{" "}
                    {t("admin.accountLastSeen", { date: fmtDate(a.lastSeenAt) })}
                  </p>
                )}
                {a.email !== null && (
                  <TierControl
                    userId={a.id}
                    state={a.plan.state}
                    trialEndsAt={a.plan.trialEndsAt?.toISOString() ?? null}
                  />
                )}
                <AccountReset userId={a.id} confirm={a.email ?? a.id} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

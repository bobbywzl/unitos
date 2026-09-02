import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { authEnabled } from "@/lib/auth";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { personSymbol } from "@/lib/person";
import { AdminNav } from "@/components/admin/admin-nav";
import { AccountReset } from "@/components/admin/account-reset";

export const dynamic = "force-dynamic";

// Admin: every account and what it holds — projects, documents, notes — with
// Reset account (lib/account-reset.ts), which deletes the account's data and
// puts it back at onboarding. Sign-in off: the local reader is the one account.

type AccountRow = {
  id: string;
  name: string;
  // null = the local reader: no account row, so no email and no dates.
  email: string | null;
  picture: string;
  createdAt: Date | null;
  lastSeenAt: Date | null;
  premium: boolean;
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
            picture: "",
            createdAt: null,
            lastSeenAt: null,
            premium: false,
            driveLinked: false,
          },
        ]),
    ...users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      picture: u.picture,
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      premium: u.premium,
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
                  {a.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.picture} alt="" className="size-7 rounded-full object-cover" />
                  ) : (
                    <span className="flex size-7 items-center justify-center rounded-full bg-clay-100 text-xs font-semibold text-clay-800">
                      {personSymbol(a.name)}
                    </span>
                  )}
                  <h2 className="text-sm font-bold text-sand-800">{a.name}</h2>
                  <span className="text-xs text-sand-500">{a.email ?? a.id}</span>
                  <Chip>{t("admin.countCorpora", { n: counts.projects })}</Chip>
                  <Chip>{t("admin.countDocuments", { n: counts.documents })}</Chip>
                  <Chip>{t("admin.countNotes", { n: counts.notes })}</Chip>
                  {a.premium && <Chip>{t("admin.accountPremium")}</Chip>}
                  {a.driveLinked && <Chip>{t("admin.accountDrive")}</Chip>}
                </div>
                {a.createdAt && a.lastSeenAt && (
                  <p className="mt-2 text-xs text-sand-500">
                    {t("admin.accountCreated", { date: fmtDate(a.createdAt) })} ·{" "}
                    {t("admin.accountLastSeen", { date: fmtDate(a.lastSeenAt) })}
                  </p>
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

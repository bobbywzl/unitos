import { redirect } from "next/navigation";
import { AccountGuard } from "@/components/account-guard";
import { PhoneApp, type PhoneProject, type PhoneSection } from "@/components/phone/phone-app";
import { authEnabled, currentUser } from "@/lib/auth";
import { roleOf } from "@/lib/collab";
import { db } from "@/lib/db";
import { accountTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

// The notes a section shows on the phone page: the newest of its order.
const NOTES_SHOWN = 60;

// The phone page (SPEC.md §33): the iPhone app's screen. No side bar and no
// reader: the account's projects, one project's sections with their notes,
// a box to write or speak a note, and the assistant at Project scope. It
// reads the same rows the notes full page reads and writes through the same
// routes, so a note added here is a note everywhere.
export default async function PhonePage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const authOn = authEnabled();
  const { p: wantedId } = await searchParams;

  const own = await db.notebook.findMany({
    where: authOn ? { userId: user.id } : undefined,
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
  });
  const shared = authOn
    ? await db.notebookCollaborator.findMany({
        where: { email: user.email },
        select: { role: true, notebook: { select: { id: true, title: true, updatedAt: true } } },
      })
    : [];
  // The project written in last comes first: it is the one the page opens on.
  const projects: (PhoneProject & { updatedAt: Date })[] = [
    ...own.map((n) => ({ id: n.id, title: n.title, canEdit: true, updatedAt: n.updatedAt })),
    ...shared.map((r) => ({
      id: r.notebook.id,
      title: r.notebook.title,
      canEdit: r.role !== "VIEWER",
      updatedAt: r.notebook.updatedAt,
    })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const open = projects.find((p) => p.id === wantedId) ?? projects[0] ?? null;
  let sections: PhoneSection[] = [];
  if (open) {
    const notebook = await db.notebook.findUnique({
      where: { id: open.id },
      include: {
        collaborators: true,
        sections: {
          // The Annotations section holds the reader's annotations, not notes.
          where: { hidden: false },
          orderBy: { order: "asc" },
          include: {
            notes: {
              where: { status: { not: "REJECTED" }, sideChatOfId: null },
              orderBy: { order: "asc" },
              take: NOTES_SHOWN,
              select: { id: true, content: true, status: true },
            },
          },
        },
      },
    });
    // The list above and this read are two reads: the role is checked on
    // the row the notes come from.
    const role = notebook ? (authOn ? roleOf(notebook, user) : "owner") : null;
    if (notebook && role) {
      const titleOf = new Map(notebook.sections.map((s) => [s.id, s.title]));
      sections = notebook.sections.map((s) => ({
        id: s.id,
        // A section inside a section names both.
        title: s.parentId && titleOf.has(s.parentId) ? `${titleOf.get(s.parentId)} / ${s.title}` : s.title,
        notes: s.notes.map((n) => ({ id: n.id, content: n.content, pending: n.status === "PENDING" })),
      }));
    }
  }

  const tier = accountTier(user, authOn);
  return (
    <>
      <AccountGuard userId={user.id} enabled={authOn} />
      <PhoneApp
        // A new project starts the page's state over: its section, its
        // draft, its conversation.
        key={open?.id ?? "none"}
        projects={projects.map(({ id, title, canEdit }) => ({ id, title, canEdit }))}
        project={open ? { id: open.id, title: open.title, canEdit: open.canEdit } : null}
        sections={sections}
        premium={tier !== "expired"}
        signedIn={authOn}
      />
    </>
  );
}

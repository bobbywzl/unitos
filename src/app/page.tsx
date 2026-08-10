import Link from "next/link";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { Logo } from "@/components/logo";
import { WorksShelf } from "@/components/works/works-shelf";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [works, profile] = await Promise.all([
    db.notebook.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        // Hidden sections (Annotations) stay out of the count, so the tag on a work
        // matches the number of sections its outline shows.
        _count: { select: { sections: { where: { hidden: false } }, documents: true } },
        // The pending queue carries to the front door (design 2a).
        sections: { select: { _count: { select: { notes: { where: { status: "PENDING" } } } } } },
      },
    }),
    db.readerProfile.findUnique({ where: { userId: USER_ID } }),
  ]);

  return (
    <main className="mx-auto w-full max-w-[1080px] px-16 pb-16">
      <header className="flex items-center gap-3 pt-6">
        <Logo size={38} className="text-clay" />
        <span className="font-display text-[21px]">Dissect</span>
        <Link
          href="/settings"
          aria-label="Settings"
          className="ml-auto flex size-[38px] items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </Link>
      </header>

      <div className="pt-16">
        <WorksShelf
          hasProfile={profile !== null}
          works={works.map((w) => ({
            id: w.id,
            title: w.title,
            sectionCount: w._count.sections,
            documentCount: w._count.documents,
            pendingCount: w.sections.reduce((sum, s) => sum + s._count.notes, 0),
            updatedAt: w.updatedAt.toISOString(),
          }))}
        />
      </div>
    </main>
  );
}

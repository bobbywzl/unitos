import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { NotebookList } from "@/components/notebook-list";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [notebooks, profile] = await Promise.all([
    db.notebook.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { sections: true, documents: true } } },
    }),
    db.readerProfile.findUnique({ where: { userId: USER_ID } }),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Dissect</h1>
      <NotebookList
        hasProfile={profile !== null}
        notebooks={notebooks.map((n) => ({
          id: n.id,
          title: n.title,
          sectionCount: n._count.sections,
          documentCount: n._count.documents,
          updatedAt: n.updatedAt.toISOString(),
        }))}
      />
    </main>
  );
}

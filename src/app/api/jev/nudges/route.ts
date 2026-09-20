import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { JEV_MODEL, jevEnabled, systemOne } from "@/lib/jev";

// The nudges a reader has already earned (SPEC.md §6): Jev reads the
// reader's own click log and says, per nudge, whether the reader has
// already done what it teaches; the nudge sequence skips those. One call,
// one noul per step, the reader's actions as the state. No key, or no
// signed-in reader: nothing is known, every nudge shows.

const DONE_MIN = 0.75;
const HISTORY_DAYS = 180;
const ACTION_ROWS = 150;

// The ids of the steps in components/nudges.tsx, each with what the step
// teaches. A step the client does not know is ignored there.
const STEPS: Record<string, string> = {
  project: "Create a project from the dashboard's New project button.",
  document: "Add a document to a project with the + button.",
  select: "Select a passage of the article so the selection toolbar opens.",
  rail: "Open the side panel from its rail.",
  tools: "Run Extract on a document.",
  merge: "Merge two notes by holding one over the other until the ring closes.",
  float: "Drag a note out of the tray onto the article.",
  fullPage: "Open the notes full page from the four arrows in the tray.",
  board: "Open a section's board from its title on the notes full page.",
  settings: "Open Settings from More in the side panel.",
  drive: "Link Google Drive on the settings page.",
};

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || !jevEnabled()) return NextResponse.json({ done: [] });
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.clickEvent.groupBy({
    by: ["surface", "control"],
    where: { userId: user.id, createdAt: { gte: since }, NOT: { control: { startsWith: "lead-predicted:" } } },
    _count: { _all: true },
    orderBy: { _count: { control: "desc" } },
    take: ACTION_ROWS,
  });
  if (rows.length === 0) return NextResponse.json({ done: [] });
  const result = await systemOne({
    state: {
      reader_actions: rows.map((r) => ({ surface: r.surface, control: r.control, count: r._count._all })),
      steps: STEPS,
    },
    questions: Object.fromEntries(
      Object.entries(STEPS).map(([id, what]) => [
        id,
        {
          type: "noul" as const,
          instructions: `The reader's actions show they have already done step "${id}": ${what}`,
          criteria: {
            true: "An action in the list is this very thing, done at least once.",
            false: "No action in the list is this thing. A related but different action does not count.",
          },
        },
      ]),
    ),
    usage: { userId: user.id, feature: "nudges", model: JEV_MODEL },
    signal: req.signal,
    label: "NUDGES",
  });
  if (!result.ok) {
    if (!req.signal.aborted) console.warn("[nudges] jev failed:", result.error);
    return NextResponse.json({ done: [] });
  }
  const done = Object.keys(STEPS).filter((id) => {
    const a = result.answers[id];
    return a?.type === "noul" && a.noul >= DONE_MIN;
  });
  return NextResponse.json({ done });
}

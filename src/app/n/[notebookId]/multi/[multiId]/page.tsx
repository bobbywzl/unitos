import { notFound, redirect } from "next/navigation";
import { AccountGuard } from "@/components/account-guard";
import { CollabProvider, type CollabState } from "@/components/collab/collab-context";
import { SyncRefresh } from "@/components/collab/sync-refresh";
import { MultiPage } from "@/components/multi/multi-page";
import { authEnabled, currentUser } from "@/lib/auth";
import { peopleByIds, roleOf } from "@/lib/collab";
import { db } from "@/lib/db";
import { documentsGraph, loadMultiUpload } from "@/lib/multi/view";
import { billingLinks } from "@/lib/billing/switch";
import { accountTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

// The multi upload page (SPEC.md §22). Two members read side by side in the
// reader, with the Stitch assistant docked at the bottom; three or more read
// here as a graph or a list, the generated content beside them, the Stitch
// assistant at the foot.
export default async function MultiUploadPage(props: {
  params: Promise<{ notebookId: string; multiId: string }>;
}) {
  const { notebookId, multiId } = await props.params;
  const user = await currentUser();
  if (!user) redirect("/signin");
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: { collaborators: true },
  });
  if (!notebook) notFound();
  const myRole = authEnabled() ? roleOf(notebook, user) : "owner";
  if (!myRole) notFound();
  const multi = await loadMultiUpload(multiId);
  if (!multi || multi.notebookId !== notebookId) notFound();

  if (multi.members.length === 2) {
    const [a, b] = multi.members;
    redirect(`/n/${notebookId}?doc=${a.id}&doc2=${b.id}&view=side&multi=${multi.id}`);
  }
  if (multi.members.length < 2 && multi.members.length > 0) {
    redirect(`/n/${notebookId}?doc=${multi.members[0].id}`);
  }

  const graph = await documentsGraph(multi.members);
  const authorIds = new Set<string>([notebook.userId]);
  for (const link of graph.recommended) {
    if (link.createdById) authorIds.add(link.createdById);
    for (const r of link.replies) authorIds.add(r.userId);
  }
  const tier = accountTier(user, authEnabled());
  const collab: CollabState = {
    authOn: authEnabled(),
    role: myRole,
    canEdit: myRole !== "viewer",
    shared: authEnabled() && notebook.collaborators.length > 0,
    myId: user.id,
    people: await peopleByIds(authorIds),
    tier,
    trialEndsAt: user.trialEndsAt?.toISOString() ?? null,
    premium: tier !== "expired",
    ultra: tier === "ultra",
    billing: await billingLinks(),
  };

  return (
    <>
      <AccountGuard userId={user.id} enabled={authEnabled()} />
      <CollabProvider value={collab}>
        <SyncRefresh notebookId={notebook.id} rev={notebook.rev} />
        <MultiPage multi={multi} graph={graph} />
      </CollabProvider>
    </>
  );
}

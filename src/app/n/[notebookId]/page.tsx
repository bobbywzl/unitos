import { redirect } from "next/navigation";

// Phase 2 replaces this with the split view (reader left, notes drawer right).
export default async function NotebookPage(props: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await props.params;
  redirect(`/n/${notebookId}/notes`);
}

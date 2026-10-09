import { NotFoundPage } from "@/components/not-found-page";

// Translated 404 for every unmatched route (a stale link). A project's own
// URLs have their own line: src/app/n/[notebookId]/not-found.tsx.
export default function NotFound() {
  return <NotFoundPage body="common.notFoundBody" />;
}

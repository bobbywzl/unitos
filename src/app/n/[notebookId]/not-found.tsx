import { NotFoundPage } from "@/components/not-found-page";

// A project's URL whose project is gone for this account: deleted, or no
// longer shared with them (the pages under /n/[notebookId] call notFound()).
export default function ProjectNotFound() {
  return <NotFoundPage body="works.projectNotFoundBody" />;
}

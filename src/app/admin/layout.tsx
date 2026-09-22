import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { isAdmin } from "@/lib/admin-auth";
import { gatewayConfigured } from "@/lib/gateway";

// The admin pages (SPEC.md §18) share the menu on the left
// (components/admin/admin-sidebar.tsx). Signed out, a page renders alone:
// it redirects to the login page, which has no menu.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) return children;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AdminSidebar gateway={gatewayConfigured()} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

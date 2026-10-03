import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { isAdmin } from "@/lib/admin-auth";
import { balanceAlerts } from "@/lib/balances";
import { gatewayConfigured } from "@/lib/gateway";

// The admin pages (SPEC.md §18) share the menu on the left
// (components/admin/admin-sidebar.tsx). Signed out, a page renders alone:
// it redirects to the login page, which has no menu. The menu counts the
// balances that warn (lib/balances.ts) beside Usage, from the stored
// readings: the live ones are read when the usage page opens.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) return children;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AdminSidebar gateway={gatewayConfigured()} balanceAlerts={await balanceAlerts()} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

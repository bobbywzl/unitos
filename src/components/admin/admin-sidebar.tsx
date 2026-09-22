"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { TFunc } from "@/lib/i18n/dictionaries";

// The admin menu (SPEC.md §18): a column on the left with one entry per
// page and, under the open page, one entry per section of it — a jump to
// the section's id on the page. On a narrow screen the column folds behind
// a Menu button. The App link and Sign out sit at the bottom.

type Key = Parameters<TFunc>[0];
type Section = { id: string; label: Key };
type Page = { href: string; label: Key; sections: Section[] };

const PAGES: Page[] = [
  {
    href: "/admin",
    label: "admin.feedback",
    sections: [
      { id: "services", label: "admin.services" },
      { id: "models", label: "admin.models" },
      { id: "inbox", label: "admin.feedback" },
    ],
  },
  { href: "/admin/digest", label: "admin.digest", sections: [] },
  { href: "/admin/usage", label: "admin.usage", sections: [] }, // usageSections below
  {
    href: "/admin/gateway",
    label: "admin.gateway",
    sections: [
      { id: "app-key", label: "admin.gatewayAppKey" },
      { id: "feature-models", label: "admin.featureModels" },
      { id: "models", label: "admin.gatewayModels" },
    ],
  },
  { href: "/admin/notifications", label: "admin.notifications", sections: [] },
  { href: "/admin/accounts", label: "admin.accounts", sections: [] },
  {
    href: "/admin/clicks",
    label: "admin.clicks",
    sections: [
      { id: "daily", label: "admin.clicksDaily" },
      { id: "groups", label: "admin.clicksGroups" },
    ],
  },
  {
    href: "/admin/funnel",
    label: "admin.funnel",
    sections: [
      { id: "waterfall", label: "admin.funnelWaterfall" },
      { id: "stopped", label: "admin.funnelStopped" },
      { id: "daily", label: "admin.funnelDaily" },
    ],
  },
  {
    href: "/admin/billing",
    label: "admin.billing",
    sections: [
      { id: "switch", label: "admin.billingSwitch" },
      { id: "services", label: "admin.services" },
      { id: "prices", label: "admin.billingPrices" },
      { id: "receipts", label: "admin.billingReceipts" },
    ],
  },
];

// The usage page's AI section is the gateway's spend when the gateway is
// set, else the app's own count; the layout says which.
function usageSections(gateway: boolean): Section[] {
  return [
    { id: "spending", label: "admin.usageSpending" },
    gateway ? { id: "gateway", label: "admin.gatewaySpend30" } : { id: "app", label: "admin.usageCostAll" },
  ];
}

export function AdminSidebar({ gateway }: { gateway: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState("");

  // The section in view: the address's hash, kept current as it changes.
  useEffect(() => {
    const read = () => setHash(window.location.hash.slice(1));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [pathname]);

  if (pathname === "/admin/login") return null;

  const isActive = (page: Page) => (page.href === "/admin" ? pathname === "/admin" : pathname.startsWith(page.href));

  async function signOut() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin/login");
  }

  const list = (
    <nav className="flex flex-1 flex-col gap-0.5">
      {PAGES.map((page) => {
        const active = isActive(page);
        const sections = page.href === "/admin/usage" ? usageSections(gateway) : page.sections;
        return (
          <div key={page.href}>
            <Link
              href={page.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`block rounded-lg px-3 py-1.5 text-sm font-semibold ${
                active ? "bg-ink text-paper" : "text-sand-700 hover:bg-sand-100 hover:text-clay-800"
              }`}
            >
              {t(page.label)}
            </Link>
            {active && sections.length > 0 && (
              <div className="my-1 ml-3 flex flex-col border-l border-line">
                {sections.map((section) => (
                  <Link
                    key={section.id}
                    href={`${page.href}#${section.id}`}
                    onClick={() => {
                      setHash(section.id);
                      setOpen(false);
                    }}
                    className={`block py-1 pl-3 text-xs ${
                      hash === section.id ? "font-semibold text-clay-800" : "text-sand-600 hover:text-clay-800"
                    }`}
                  >
                    {t(section.label)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  const foot = (
    <div className="mt-6 flex flex-col gap-1 border-t border-line pt-3 text-sm">
      <Link href="/" className="px-3 py-1 text-sand-600 hover:text-clay-700">
        {t("common.app")}
      </Link>
      <button onClick={() => void signOut()} className="px-3 py-1 text-left text-sand-600 hover:text-clay-700">
        {t("common.signOut")}
      </button>
    </div>
  );

  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-card px-4 py-2 md:hidden">
        <span className="text-sm font-bold">{t("admin.loginTitle")}</span>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          {t("admin.menu")}
        </button>
      </div>
      <aside
        className={`${open ? "flex" : "hidden"} w-full flex-col border-b border-line bg-card px-3 py-4 md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0 md:py-6`}
      >
        <div className="mb-4 hidden px-3 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase md:block">
          {t("admin.loginTitle")}
        </div>
        {list}
        {foot}
      </aside>
    </>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

// Shared header of the admin pages (Scalae admin pattern): one tab per page,
// App link, sign out.
export function AdminNav({ active }: { active: "feedback" | "digest" }) {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin/login");
  }

  const tab = (href: string, id: "feedback" | "digest", label: string) => (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        active === id ? "bg-ink text-paper" : "bg-card text-sand-600 shadow-soft hover:text-clay-800"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="mb-6 flex items-center gap-1">
      {tab("/admin", "feedback", "Feedback")}
      {tab("/admin/digest", "digest", "Digest")}
      <div className="ml-auto flex items-center gap-3 text-sm">
        <Link href="/" className="text-sand-600 hover:text-clay-700">
          App
        </Link>
        <button onClick={() => void signOut()} className="text-sand-600 hover:text-clay-700">
          Sign out
        </button>
      </div>
    </nav>
  );
}

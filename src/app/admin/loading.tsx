import { LoadingDots } from "@/components/thinking";

// An admin page is rendered from the database on every visit, which takes a
// while: a press on the menu shows the page's column loading at once, the
// menu stays, and the page takes the column's place when it lands.
export default function AdminLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8 text-sand-500">
      <LoadingDots />
    </main>
  );
}

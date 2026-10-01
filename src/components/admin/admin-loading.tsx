import { LoadingDots } from "@/components/thinking";

/** The column while a slow admin page comes from the server: a press on the
    menu shows it at once, the menu marks the page, and the page takes the
    column's place when it lands. Only the digest, usage, and funnel pages
    have one (their loading.tsx): React shows a loading state for 300 ms at
    least, so on a page that lands sooner it would only slow the page. */
export function AdminLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8 text-sand-500">
      <LoadingDots />
    </main>
  );
}

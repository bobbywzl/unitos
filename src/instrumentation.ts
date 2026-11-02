// Runs once when the server starts (Next's instrumentation hook): the
// Chinese strings register (lib/i18n/register-all.ts), so translate("zh", …)
// answers in Chinese in every server module, including one that never
// imports lib/i18n/server.ts. The edge runtime (the middleware) carries its
// own three strings and skips this.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  await import("@/lib/i18n/register-all");
}

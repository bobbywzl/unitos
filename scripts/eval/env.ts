// The runner's environment (SPEC.md §25): no database is needed to run the
// tools — lib/models.ts falls back to the default model ids when the
// ModelChoice table cannot be read — but the Prisma client refuses to start
// without a DATABASE_URL, so a stand-in fills it when none is set, and the
// one warning the failed read prints is dropped: it is the expected state,
// not a fault. Imported first by run.ts, before any module that loads the
// client.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://eval:eval@127.0.0.1:1/eval?connect_timeout=1";
  process.env.DIRECT_URL ??= process.env.DATABASE_URL;
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[models] model choices not read")) return;
    warn(...args);
  };
}

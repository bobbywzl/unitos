// The runner's environment (SPEC.md §25): no database is needed to run the
// tools — lib/models.ts and lib/feature-models.ts fall back to the default
// model ids when the ModelChoice and FeatureModel tables cannot be read —
// but the Prisma client refuses to start without a DATABASE_URL, so a
// stand-in fills it when none is set, and the warnings the failed reads
// print are dropped: they are the expected state, not a fault. Imported
// first by run.ts, before any module that loads the client.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://eval:eval@127.0.0.1:1/eval?connect_timeout=1";
  process.env.DIRECT_URL ??= process.env.DATABASE_URL;
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && /^\[models\] (model choices|feature models) not read/.test(args[0])) return;
    warn(...args);
  };
}

// A dry run (MOONSHOT_API_KEY=mock, scripts/qa/mock-kimi.mjs) answers the
// Claude calls too — Collapse runs on Claude Opus 5.5 — from the same mock,
// which speaks Anthropic's Messages API, unless an Anthropic key is set.
if (process.env.MOONSHOT_API_KEY === "mock" && !process.env.ANTHROPIC_API_KEY && process.env.MOONSHOT_BASE_URL) {
  process.env.ANTHROPIC_API_KEY = "mock";
  process.env.ANTHROPIC_BASE_URL = process.env.MOONSHOT_BASE_URL;
}

// The Claude client's base is the API's /v1 (lib/claude.ts). A base URL
// with no path is the API's root, as Anthropic's own SDK takes it: the
// eval adds /v1, so a root set for another client still reaches the API.
const anthropicBase = process.env.ANTHROPIC_BASE_URL?.trim();
if (anthropicBase) {
  try {
    const url = new URL(anthropicBase);
    if (url.pathname === "/" || url.pathname === "") process.env.ANTHROPIC_BASE_URL = `${url.origin}/v1`;
  } catch {
    // Not a URL: the client reports it on the first call.
  }
}

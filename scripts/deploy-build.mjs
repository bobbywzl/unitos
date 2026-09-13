// Deploy build: normalize database env across providers, migrate, build.
// Vercel Neon sets DATABASE_URL + DATABASE_URL_UNPOOLED. Vercel Postgres (legacy)
// sets POSTGRES_PRISMA_URL + POSTGRES_URL_NON_POOLING. Supabase setups set
// DATABASE_URL + DIRECT_URL directly. All three work here.
import { spawnSync } from "node:child_process";

// Note: assigning undefined into process.env coerces to the string "undefined" — only set when found.
const pooledUrl =
  process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL;
const directUrl =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  pooledUrl;
if (pooledUrl) process.env.DATABASE_URL = pooledUrl;
if (directUrl) process.env.DIRECT_URL = directUrl;

if (!pooledUrl) {
  console.error(
    [
      "",
      "No database configured.",
      "Connect one in Vercel: Storage → Create Database → Neon (env vars are added automatically),",
      "or set DATABASE_URL and DIRECT_URL in Project Settings → Environment Variables.",
      "Then redeploy.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const run = (args) => {
  const result = spawnSync("npx", args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(["prisma", "generate"]);
// Migrations run in the production build only. Vercel builds every pushed
// branch as a preview with the same database variables, so a preview build
// would apply a work branch's migration to the production database — the
// database the code on main reads.
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  console.log(`Preview build (${process.env.VERCEL_ENV}): skipping prisma migrate deploy.`);
} else {
  // The first production run of 20260912120000_billing stopped on a column a
  // preview build of an earlier branch had already added, and Prisma keeps a
  // failed migration on record until it is resolved. Mark that one rolled
  // back so deploy applies its guarded rewrite; once it is applied, resolve
  // exits non-zero on every later deploy and that is ignored. Delete this
  // block once a production deploy has passed.
  spawnSync("npx", ["prisma", "migrate", "resolve", "--rolled-back", "20260912120000_billing"], {
    stdio: "inherit",
    env: process.env,
  });
  run(["prisma", "migrate", "deploy"]);
}
run(["next", "build"]);

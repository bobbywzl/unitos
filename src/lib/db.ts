import { PrismaClient } from "@prisma/client";

// Vercel Postgres integrations name env vars differently; normalize before the client reads them.
// Assigning undefined into process.env coerces to the string "undefined" — only set when found.
const pooledUrl =
  process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL;
const directUrl =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  pooledUrl;
if (pooledUrl) process.env.DATABASE_URL = pooledUrl;
if (directUrl) process.env.DIRECT_URL = directUrl;

// Serverless + pooled connection (Neon -pooler host, Supabase port 6543): mark pgbouncer and
// cap Prisma's pool so instances do not exhaust the pooler (release-edu pattern).
function tunedDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw || !process.env.VERCEL) return raw;
  try {
    const url = new URL(raw);
    const pooled = url.hostname.includes("-pooler") || url.port === "6543";
    if (pooled && !url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true");
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "1");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "30");
    return url.toString();
  } catch {
    return raw;
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const dbUrl = tunedDatabaseUrl();
export const db =
  globalForPrisma.prisma ??
  new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

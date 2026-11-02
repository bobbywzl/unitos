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
// The cap is how many queries one instance runs at once: the pages read
// their rows side by side (the reader page starts eleven reads together),
// so a cap of 1 queues them one round trip after another. 4 keeps the
// pooler's client limit out of reach at the app's size (.env.example).
const CONNECTION_LIMIT = "4";
function tunedDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw || !process.env.VERCEL) return raw;
  try {
    const url = new URL(raw);
    const pooled = url.hostname.includes("-pooler") || url.port === "6543";
    if (pooled && !url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true");
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", CONNECTION_LIMIT);
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "30");
    return url.toString();
  } catch {
    return raw;
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: Db };

const dbUrl = tunedDatabaseUrl();
// A document's stored file (fileData: a PDF, a Word file, up to tens of
// megabytes) leaves the database only when a read asks for it by name
// (`select`, or `omit: { fileData: false }`). Without this, every read of a
// Document row — the reader page on every open and every refresh, the AI
// tools on every call — carried the whole file over the wire and threw it
// away. The types follow the omit, so a read that needs the bytes says so.
const makeClient = () =>
  new PrismaClient({
    ...(dbUrl ? { datasources: { db: { url: dbUrl } } } : {}),
    omit: { document: { fileData: true } },
  });
/** The app's Prisma client, with the omit above in its type. */
export type Db = ReturnType<typeof makeClient>;
export const db: Db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

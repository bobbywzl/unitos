import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { isLang, type Lang } from "@/lib/i18n/config";
import { serverT } from "@/lib/i18n/server";
import { deeplConfigured, deeplTranslate } from "@/lib/translate/deepl";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// Translation of a document (SPEC.md §19): every text block and transcript
// line translated by DeepL into the reader's language, cached per block per
// language. GET answers what is cached; POST translates what is missing or
// stale (the block was edited since) and answers the whole map. The reader
// shows each translation under its block; anchors stay on the original text.
const TRANSLATABLE = new Set(["PARAGRAPH", "HEADING", "LIST", "TRANSCRIPT", "TABLE", "FIGURE"]);
// A table's plain text past this reads as data, not prose; it stays untranslated.
const TABLE_MAX_CHARS = 5_000;

const bodySchema = z.object({ lang: z.enum(["en", "zh"]) });

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

type Block = { id: string; type: string; text: string };

function translatable(block: Block): boolean {
  if (!TRANSLATABLE.has(block.type) || block.text.trim() === "") return false;
  if (block.type === "TABLE" && block.text.length > TABLE_MAX_CHARS) return false;
  return true;
}

async function current(documentId: string, lang: Lang) {
  const blocks: Block[] = await db.block.findMany({
    where: { documentId },
    orderBy: { order: "asc" },
    select: { id: true, type: true, text: true },
  });
  const wanted = blocks.filter(translatable);
  const rows = await db.blockTranslation.findMany({
    where: { lang, blockId: { in: wanted.map((b) => b.id) } },
    select: { blockId: true, sourceHash: true, text: true },
  });
  const byBlock = new Map(rows.map((r) => [r.blockId, r]));
  const translations: Record<string, string> = {};
  const missing: Block[] = [];
  for (const block of wanted) {
    const row = byBlock.get(block.id);
    if (row && row.sourceHash === hashOf(block.text)) translations[block.id] = row.text;
    else missing.push(block);
  }
  return { wanted, translations, missing };
}

export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const lang = new URL(req.url).searchParams.get("lang");
  if (!isLang(lang)) {
    return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  }
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const { translations, missing } = await current(documentId, lang);
  return NextResponse.json({ lang, translations, complete: missing.length === 0 });
}

export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  if (!deeplConfigured()) {
    return NextResponse.json({ error: t("api.translateNeedsKey") }, { status: 503 });
  }
  const { wanted, translations, missing } = await current(documentId, data.lang);
  if (wanted.length === 0) {
    return NextResponse.json({ error: t("api.translateNothing") }, { status: 400 });
  }
  if (missing.length > 0) {
    let result: { texts: string[] };
    try {
      result = await deeplTranslate(
        missing.map((b) => b.text),
        data.lang,
        { userId: access.user.id, signal: req.signal },
      );
    } catch (err) {
      console.error("[translate] DeepL failed:", err);
      return NextResponse.json(
        { error: t("api.translateFailed", { reason: err instanceof Error ? err.message : String(err) }) },
        { status: 502 },
      );
    }
    const writes = missing.map((block, i) =>
      db.blockTranslation.upsert({
        where: { blockId_lang: { blockId: block.id, lang: data.lang } },
        create: { blockId: block.id, lang: data.lang, sourceHash: hashOf(block.text), text: result.texts[i] },
        update: { sourceHash: hashOf(block.text), text: result.texts[i] },
      }),
    );
    for (let i = 0; i < writes.length; i += 50) await db.$transaction(writes.slice(i, i + 50));
    missing.forEach((block, i) => {
      translations[block.id] = result.texts[i];
    });
    console.log(`[translate] ${documentId}: ${missing.length} blocks → ${data.lang}`);
  }
  return NextResponse.json({ lang: data.lang, translations, complete: true });
}

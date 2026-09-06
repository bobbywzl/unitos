import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { buildGlossary, glossaryEntries, glossaryInLanguage, lacksDefinitionsIn } from "@/lib/glossary";
import { currentLang, serverT } from "@/lib/i18n/server";
import { kimiConfigured } from "@/lib/kimi";

export const maxDuration = 120;

// The body is optional: lang is the language the definitions are wanted in;
// absent, the reader's language.
const bodySchema = z.object({ lang: z.enum(["en", "zh"]).optional() });

// The document glossary in one language (SPEC.md §8 Phase 7). No glossary:
// build it, definitions in lang. A glossary without definitions in lang: one
// model call writes them. Definitions already in lang: no model call.
export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  if (!kimiConfigured()) {
    return NextResponse.json({ error: t("api.glossaryNeedsKey") }, { status: 503 });
  }
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const raw: unknown = await req.json().catch(() => ({}));
  const body = bodySchema.safeParse(raw ?? {});
  if (!body.success) {
    return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  }
  const lang = body.data.lang ?? (await currentLang());
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { glossary: true },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const entries = glossaryEntries(document.glossary);
  const userId = access.user.id;

  if (entries.length === 0) {
    try {
      const count = await buildGlossary(documentId, userId, lang);
      if (count === 0) return NextResponse.json({ error: t("api.documentNotFoundOrEmpty") }, { status: 404 });
      return NextResponse.json({ ok: true, termCount: count });
    } catch (err) {
      console.error("Glossary failed:", err);
      return NextResponse.json({ error: t("api.glossaryFailed") }, { status: 422 });
    }
  }
  if (!lacksDefinitionsIn(entries, lang)) {
    return NextResponse.json({ ok: true, termCount: entries.length });
  }
  try {
    const count = await glossaryInLanguage(documentId, userId, lang);
    return NextResponse.json({ ok: true, termCount: count });
  } catch (err) {
    console.error("Glossary language failed:", err);
    return NextResponse.json({ error: t("api.glossaryLanguageFailed") }, { status: 422 });
  }
}

import type { ModelMessage } from "ai";
import { z } from "zod";
import { bumpDocument } from "@/lib/collab";
import { db } from "@/lib/db";
import { KIMI_K3 } from "@/lib/derive/config";
import { documentPrefix } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { isLang, type Lang } from "@/lib/i18n/config";
import { currentLang } from "@/lib/i18n/server";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { languageName } from "@/lib/prompts/types";
import type { UsageMeta } from "@/lib/usage";

// On-ingest glossary extraction: terms, acronyms, symbols (SPEC.md §8 Phase 7).
// Stored as Document.glossary: [{term, definition, blockIds[], lang, definitions}].
// A definition is assistant-voice output, so it is written in the reader's
// language (PromptCtx.lang). lang: the language definition was written in.
// definitions: one definition per language the glossary has been asked for;
// definitions[lang] mirrors definition. An entry saved before lang was stored
// has no lang: its language is unknown, so only definitions can serve it.
// The term is never translated: it stays as the document writes it.
const GLOSSARY_MODEL = KIMI_K3;
const TERM_MAX = 80;
const DEFINITION_MAX = 500;

export type GlossaryEntry = {
  term: string;
  definition: string;
  blockIds: string[];
  lang?: Lang;
  definitions?: Partial<Record<Lang, string>>;
};

const glossarySchema = z.object({
  terms: z
    .array(
      z.object({
        term: z.string().min(1).max(TERM_MAX),
        definition: z.string().min(1).max(DEFINITION_MAX),
        blockIds: z.array(z.string()).max(50),
      }),
    )
    .max(200),
});

const glossaryLanguageSchema = z.object({
  definitions: z
    .array(
      z.object({
        term: z.string().min(1).max(TERM_MAX),
        definition: z.string().min(1).max(DEFINITION_MAX),
      }),
    )
    .max(200),
});

// The stored glossary as entries. A row without a term or definition is skipped.
export function glossaryEntries(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: GlossaryEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.term !== "string" || typeof row.definition !== "string") continue;
    const entry: GlossaryEntry = {
      term: row.term,
      definition: row.definition,
      blockIds: Array.isArray(row.blockIds)
        ? row.blockIds.filter((id): id is string => typeof id === "string")
        : [],
    };
    if (isLang(row.lang)) entry.lang = row.lang;
    if (row.definitions && typeof row.definitions === "object") {
      const definitions: Partial<Record<Lang, string>> = {};
      for (const [key, text] of Object.entries(row.definitions as Record<string, unknown>)) {
        if (isLang(key) && typeof text === "string") definitions[key] = text;
      }
      entry.definitions = definitions;
    }
    entries.push(entry);
  }
  return entries;
}

// The definition to show in lang; null when the entry has none in lang.
export function definitionFor(entry: GlossaryEntry, lang: Lang): string | null {
  return entry.definitions?.[lang] ?? (entry.lang === lang ? entry.definition : null);
}

// Whether any entry has no definition in lang.
export function lacksDefinitionsIn(entries: GlossaryEntry[], lang: Lang): boolean {
  return entries.some((entry) => definitionFor(entry, lang) === null);
}

// Terms match by text, not by case or surrounding space.
function termKey(term: string): string {
  return term.trim().toLowerCase();
}

function glossaryPrompt(lang: Lang): string {
  return [
    "Build a glossary for this document: technical terms, acronyms, and symbols a reader",
    "may need defined.",
    "1. Only include terms the document actually uses. 5 to 60 terms for a typical document.",
    "2. term: the term exactly as the document writes it. Never translate the term.",
    `3. definition: one sentence, two at most, in plain words, grounded in how the document uses the term. Write every definition in ${languageName(lang)}.`,
    "4. blockIds: blocks where the term is defined or used centrally. Use ids exactly as",
    "   they appear in [block <id>] markers.",
    "",
    'Return ONLY JSON: {"terms": [{"term": "<term>", "definition": "<sentences>", "blockIds": ["<id>"]}]}',
  ].join("\n");
}

function glossaryLanguagePrompt(title: string, entries: GlossaryEntry[], lang: Lang): string {
  const name = languageName(lang);
  const terms = entries.map((entry) => ({ term: entry.term, definition: entry.definition }));
  return [
    `A reader opened the document "${title}" with the interface in ${name}. The glossary below has`,
    `definitions in another language. Write every definition in ${name}.`,
    "1. term: copy the term exactly as given. Never translate the term.",
    `2. definition: the same meaning as the given definition, one sentence, two at most, in plain words, in ${name}.`,
    "3. One definition per term given, in the given order. Skip none.",
    "",
    "Glossary:",
    JSON.stringify(terms),
    "",
    'Return ONLY JSON: {"definitions": [{"term": "<term>", "definition": "<sentences>"}]}',
  ].join("\n");
}

// Build the glossary: one model call over the whole document, definitions in
// the reader's language. Callers in after() pass the language captured at
// request time; the default reads the request and falls back to English
// outside one. Returns the number of terms; 0 when there is nothing to read.
export async function buildGlossary(
  documentId: string,
  userId: string | null = null,
  lang?: Lang,
): Promise<number> {
  if (!kimiConfigured()) return 0;
  const definitionLang = lang ?? (await currentLang());
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true, startTime: true, endTime: true } } },
  });
  if (!document || document.blocks.length === 0) return 0;

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.blocks, document.references),
    },
    { role: "user", content: glossaryPrompt(definitionLang) },
  ];
  const result = await callForJson({
    model: kimi(GLOSSARY_MODEL),
    messages,
    maxOutputTokens: 8192,
    providerOptions: kimiOptions(),
    schema: glossarySchema,
    label: "GLOSSARY",
    usage: { userId, feature: "glossary", model: GLOSSARY_MODEL } satisfies UsageMeta,
  });
  if (!result.ok) throw new Error(result.error);

  const validBlockIds = new Set(document.blocks.map((b) => b.id));
  const entries: GlossaryEntry[] = result.data.terms.map((t) => ({
    term: t.term,
    definition: t.definition,
    blockIds: t.blockIds.filter((id) => validBlockIds.has(id)),
    lang: definitionLang,
    definitions: { [definitionLang]: t.definition },
  }));
  await db.document.update({ where: { id: documentId }, data: { glossary: entries } });
  // The glossary lands after ingest returns; open workspaces see it arrive.
  await bumpDocument(documentId);
  return entries.length;
}

// Definitions in one more language: the glossary exists, the reader's language
// has no definitions in it. One model call over the term list writes them into
// definitions[lang]; definition and lang stay as they are. A term the model
// skips keeps no definition in lang. Returns the number of terms; 0 when the
// document has no glossary.
export async function glossaryInLanguage(
  documentId: string,
  userId: string | null,
  lang: Lang,
): Promise<number> {
  if (!kimiConfigured()) return 0;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { title: true, glossary: true },
  });
  if (!document) return 0;
  const entries = glossaryEntries(document.glossary);
  if (entries.length === 0) return 0;
  const wanted = entries.filter((entry) => definitionFor(entry, lang) === null);
  if (wanted.length === 0) return entries.length;

  const messages: ModelMessage[] = [
    { role: "user", content: glossaryLanguagePrompt(document.title, wanted, lang) },
  ];
  const result = await callForJson({
    model: kimi(GLOSSARY_MODEL),
    providerOptions: kimiOptions(),
    messages,
    maxOutputTokens: 8192,
    schema: glossaryLanguageSchema,
    label: "GLOSSARY_LANGUAGE",
    usage: { userId, feature: "glossary", model: GLOSSARY_MODEL } satisfies UsageMeta,
  });
  if (!result.ok) throw new Error(result.error);

  const byTerm = new Map<string, string>();
  for (const d of result.data.definitions) {
    const key = termKey(d.term);
    if (!byTerm.has(key)) byTerm.set(key, d.definition);
  }
  // Read again before writing: a re-parse may have rebuilt the glossary while
  // the model ran. Definitions land on the entries that exist now, by term.
  const fresh = await db.document.findUnique({ where: { id: documentId }, select: { glossary: true } });
  const current = glossaryEntries(fresh?.glossary);
  if (current.length === 0) return 0;
  let landed = 0;
  const updated = current.map((entry): GlossaryEntry => {
    const definition = byTerm.get(termKey(entry.term));
    if (definition === undefined || definitionFor(entry, lang) !== null) return entry;
    landed += 1;
    return { ...entry, definitions: { ...entry.definitions, [lang]: definition } };
  });
  if (landed === 0) return current.length;
  await db.document.update({ where: { id: documentId }, data: { glossary: updated } });
  // Open workspaces see the definitions arrive.
  await bumpDocument(documentId);
  return current.length;
}

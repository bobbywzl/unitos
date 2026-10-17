import { LANGS } from "@/lib/i18n/config";
import { translate, type TFunc } from "@/lib/i18n/dictionaries";

// The default section's title in the reader's language (SPEC.md §6). A new
// project's first section, and the section notes land in when none is
// picked, are stored with the default title in the language of the account
// that made them ("Notes", "笔记"). Drawn, a stored default reads in the
// language the reader has on now; any other title reads as typed. The
// stored title never changes, and the rename field shows it as stored.

const DEFAULTS = new Set(LANGS.map((lang) => translate(lang, "reader.defaultSectionTitle")));

export function shownSectionTitle(title: string, t: TFunc): string {
  return DEFAULTS.has(title.trim()) ? t("reader.defaultSectionTitle") : title;
}

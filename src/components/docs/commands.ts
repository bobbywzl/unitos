import type { Editor } from "@tiptap/react";
import type { TKey } from "@/lib/i18n/dictionaries";

// The page editor's commands (SPEC.md §29). The editor has no menu bar, so
// what Google Docs keeps in its menus — Page setup, Preferences, Find and
// replace, Special characters — is reached through Search the menus (the
// toolbar's first button, Alt+/), the "@" menu, the right-click menu, and
// the shortcuts. Each area registers its commands here when its module
// loads; Search the menus lists them all.

export type DocsMenu = "file" | "edit" | "view" | "insert" | "format" | "tools";

export type DocsCommand = {
  /** Unique id, "area:name". */
  id: string;
  /** The label, as Google Docs' menu names it. */
  label: TKey;
  /** The Google Docs menu the command lives in, shown beside it. */
  menu: DocsMenu;
  /** More words that find it. */
  keywords?: string[];
  /** Its shortcut, "Mod+Shift+C" (keys.ts prints it). */
  shortcut?: string;
  run: (editor: Editor) => void;
  /** False greys it out; absent = always on. */
  enabled?: (editor: Editor) => boolean;
};

const registry = new Map<string, DocsCommand>();

/** Add or replace commands (by id). */
export function registerDocsCommands(list: DocsCommand[]): void {
  for (const command of list) registry.set(command.id, command);
}

/** Every registered command, in registration order. */
export function docsCommands(): DocsCommand[] {
  return [...registry.values()];
}

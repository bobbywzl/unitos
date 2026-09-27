import { readSetting, writeSetting } from "@/lib/settings";

// The import switch (SPEC.md §30): the operator turns it on or off on the
// admin dashboard. On, an add of a PDF judged an article, a web page, or a
// Markdown or text file is an import that opens in the page editor; off,
// every add is a block document. It is read at import only: a document made
// while it was on keeps its rich text. The switch is the AppSetting row
// "imports": "on" or "off"; no row = off.

export const IMPORTS_KEY = "imports";

export async function importPageEditorOn(): Promise<boolean> {
  return (await readSetting(IMPORTS_KEY)) === "on";
}

export async function setImportPageEditorOn(on: boolean): Promise<void> {
  await writeSetting(IMPORTS_KEY, on ? "on" : "off");
}

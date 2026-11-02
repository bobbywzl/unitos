import { ZH } from "@/lib/i18n/dict/zh";
import { registerDictionary } from "@/lib/i18n/dictionaries";

// Every language on the server and in scripts: English is in every bundle
// (dict/en.ts); importing this module registers Chinese too. The server
// imports it at start (instrumentation.ts) and from lib/i18n/server.ts; a
// script that translates into Chinese imports it itself. The browser never
// does: a page in Chinese gets its strings from components/lang-provider-zh.tsx.
registerDictionary("zh", ZH);

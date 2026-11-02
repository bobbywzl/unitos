// Every namespace's Chinese strings: the server registers them at start
// (lib/i18n/server.ts), the browser loads them on a page in Chinese alone
// (components/lang-provider-zh.tsx).
import { zh as common } from "@/lib/i18n/dict/common.zh";
import { zh as signin } from "@/lib/i18n/dict/signin.zh";
import { zh as works } from "@/lib/i18n/dict/works.zh";
import { zh as outline } from "@/lib/i18n/dict/outline.zh";
import { zh as reader } from "@/lib/i18n/dict/reader.zh";
import { zh as docs } from "@/lib/i18n/dict/docs.zh";
import { zh as docsPage } from "@/lib/i18n/dict/docsPage.zh";
import { zh as docsInsert } from "@/lib/i18n/dict/docsInsert.zh";
import { zh as docsTyping } from "@/lib/i18n/dict/docsTyping.zh";
import { zh as docsLayer } from "@/lib/i18n/dict/docsLayer.zh";
import { zh as docsSuggest } from "@/lib/i18n/dict/docsSuggest.zh";
import { zh as docsVersions } from "@/lib/i18n/dict/docsVersions.zh";
import { zh as assistant } from "@/lib/i18n/dict/assistant.zh";
import { zh as billing } from "@/lib/i18n/dict/billing.zh";
import { zh as panels } from "@/lib/i18n/dict/panels.zh";
import { zh as panes } from "@/lib/i18n/dict/panes.zh";
import { zh as plans } from "@/lib/i18n/dict/plans.zh";
import { zh as stitch } from "@/lib/i18n/dict/stitch.zh";
import { zh as structure } from "@/lib/i18n/dict/structure.zh";
import { zh as video } from "@/lib/i18n/dict/video.zh";
import { zh as settings } from "@/lib/i18n/dict/settings.zh";
import { zh as admin } from "@/lib/i18n/dict/admin.zh";
import { zh as api } from "@/lib/i18n/dict/api.zh";
import { zh as legal } from "@/lib/i18n/dict/legal.zh";

export const ZH = {
  common,
  signin,
  works,
  outline,
  reader,
  docs,
  docsPage,
  docsInsert,
  docsTyping,
  docsLayer,
  docsSuggest,
  docsVersions,
  assistant,
  billing,
  panels,
  panes,
  plans,
  stitch,
  structure,
  video,
  settings,
  admin,
  api,
  legal,
} as const;

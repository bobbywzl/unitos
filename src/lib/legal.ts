import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

// The two legal documents as data, so /privacy and /terms render identically
// and the text lives in the dictionary with every other string.

// The place whose law governs the terms, named in the Governing law section.
// Set this to where you actually live before telling people to sign up.

type Block = { p: TKey } | { ul: TKey[] };
export type LegalSection = { heading: TKey; blocks: Block[] };

export const PRIVACY_SECTIONS: LegalSection[] = [
  { heading: "legal.pWhoHeading", blocks: [{ p: "legal.pWho" }] },
  {
    heading: "legal.pCollectHeading",
    blocks: [
      { p: "legal.pCollectIntro" },
      {
        ul: [
          "legal.pCollectAccount",
          "legal.pCollectContent",
          "legal.pCollectContext",
          "legal.pCollectPrefs",
          "legal.pCollectFeedback",
          "legal.pCollectLogs",
        ],
      },
    ],
  },
  { heading: "legal.pCookiesHeading", blocks: [{ p: "legal.pCookies" }] },
  {
    heading: "legal.pAiHeading",
    blocks: [
      { p: "legal.pAiIntro" },
      { ul: ["legal.pAiAnthropic", "legal.pAiOpenAI", "legal.pAiGoogle", "legal.pAiYouTube"] },
      { p: "legal.pAiTraining" },
    ],
  },
  { heading: "legal.pWhereHeading", blocks: [{ p: "legal.pWhere" }] },
  { heading: "legal.pRetentionHeading", blocks: [{ p: "legal.pRetention" }] },
  {
    heading: "legal.pRightsHeading",
    blocks: [
      { p: "legal.pRightsIntro" },
      { ul: ["legal.pRightsExport", "legal.pRightsEdit", "legal.pRightsDelete"] },
      { p: "legal.pRightsLaw" },
    ],
  },
  { heading: "legal.pChildrenHeading", blocks: [{ p: "legal.pChildren" }] },
  { heading: "legal.pSecurityHeading", blocks: [{ p: "legal.pSecurity" }] },
  { heading: "legal.pChangesHeading", blocks: [{ p: "legal.pChanges" }] },
  { heading: "legal.pContactHeading", blocks: [{ p: "legal.pContact" }] },
];

export const TERMS_SECTIONS: LegalSection[] = [
  { heading: "legal.tServiceHeading", blocks: [{ p: "legal.tService" }] },
  { heading: "legal.tAccountHeading", blocks: [{ p: "legal.tAccount" }] },
  { heading: "legal.tContentHeading", blocks: [{ p: "legal.tContent" }] },
  {
    heading: "legal.tUseHeading",
    blocks: [
      { p: "legal.tUseIntro" },
      { ul: ["legal.tUseRights", "legal.tUseIllegal", "legal.tUseAbuse", "legal.tUseAutomate"] },
    ],
  },
  { heading: "legal.tAiHeading", blocks: [{ p: "legal.tAi" }] },
  { heading: "legal.tThirdHeading", blocks: [{ p: "legal.tThird" }] },
  { heading: "legal.tAvailabilityHeading", blocks: [{ p: "legal.tAvailability" }] },
  { heading: "legal.tLiabilityHeading", blocks: [{ p: "legal.tLiability" }] },
  { heading: "legal.tEndHeading", blocks: [{ p: "legal.tEnd" }] },
  { heading: "legal.tLawHeading", blocks: [{ p: "legal.tLaw" }] },
  { heading: "legal.tChangesHeading", blocks: [{ p: "legal.tChanges" }] },
  { heading: "legal.tContactHeading", blocks: [{ p: "legal.tContact" }] },
];

// Governing law names the jurisdiction; every other line takes no parameters.
export function legalText(t: TFunc, key: TKey): string {
  return key === "legal.tLaw" ? t(key, { jurisdiction: t("legal.jurisdiction") }) : t(key);
}

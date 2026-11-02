// The privacy policy and terms, both languages. Rendered by /privacy and
// /terms through lib/legal.ts. Plain words, short sentences: a reader decides
// whether to sign in from these pages, so they say what actually happens.

export const en = {
  // Shared
  updated: "Last updated: 6 September 2026",
  backToApp: "Back to Unitos",
  privacyTitle: "Privacy Policy",
  termsTitle: "Terms of Service",
  seeTerms: "Terms of Service",
  seePrivacy: "Privacy Policy",

  // ── Privacy ──────────────────────────────────────────────────────────────
  pIntro:
    "Unitos is a reading and note-taking app at unitosnotebook.com. This policy says what the app stores, who it sends your material to, and what you can do about it. It covers the app only.",

  pWhoHeading: "Who runs Unitos",
  pWho:
    "Unitos is run by an independent developer, not a company. Questions about this policy, your data, or a deletion request go to robertwzl311@gmail.com.",

  pCollectHeading: "What Unitos stores",
  pCollectIntro: "Unitos stores what it needs to be your notebook, and nothing else:",
  pCollectAccount:
    "Your account: the email address, name, and profile picture on the Google or Apple account you sign in with, or the name, email, and password you sign up with. Sign-in asks for those things and nothing more — it cannot read your Gmail or Calendar.",
  pCollectDrive:
    "Google Drive, only if you link it in Settings: a token that lets Unitos read your Drive files — every file you can read, or only the files you pick, as the Google consent screen said. Unitos reads a file only when you add it, keeps that copy as a document, and never changes anything in your Drive. Unlink in Settings any time; that revokes the token.",
  pCollectContent:
    "What you put in: the documents and videos you upload, the pages you add by URL and the text parsed from them, and every project, section, note, annotation, highlight, comment, distillation, extraction, match, and summary you make.",
  pCollectContext:
    "Your context: the background, purpose, and application you optionally write in the Context tab, which conditions what the assistant says.",
  pCollectPrefs: "Your preferences: interface language and theme.",
  pCollectFeedback:
    "Feedback you send: the message, the page you sent it from, and your browser's user-agent string.",
  pCollectUsage:
    "Usage: where you left off in each document, which controls you click, with the open project, and each AI call's provider, model, token counts, and cost — never the text of the call. Settings → Your data shows these counts.",
  pCollectLogs:
    "Ordinary server logs kept by the hosting provider, such as IP addresses and request times.",

  pCookiesHeading: "Cookies",
  pCookies:
    "Unitos sets three cookies, all functional: one that keeps you signed in, one that remembers your language, and one for the administrator area. There are no advertising, analytics, or tracking cookies, and no third-party trackers on any page.",

  pAiHeading: "Where your material goes",
  pAiIntro:
    "Unitos is an AI reading tool, so parts of what you store are sent to AI providers to answer your requests. This only happens when you ask for something — nothing is sent in the background:",
  pAiAnthropic:
    "Anthropic (Claude) receives document text, page images, and your upload instructions, when you add a document or convert handwritten pages.",
  pAiMoonshot:
    "Moonshot AI (Kimi) receives document text, your notes and annotations, and your context, when you use Simplify, Extract, Analyze, Summarize, or the assistant.",
  pAiOpenAI:
    "OpenAI receives the text you ask to be read aloud. OpenAI and Groq receive the audio of videos you upload, or of YouTube videos you add that have no captions, for transcription.",
  pAiGoogle:
    "Google (Gemini) receives videos you upload, or the link to a YouTube video you add, for transcription and for describing a frame you ask about.",
  pAiYouTube:
    "YouTube receives a request for captions, preview frames, and — when the video has no captions — its audio, when you add a YouTube video.",
  pAiTraining:
    "These providers process this material to return a result. Unitos does not sell your material and does not use it to train any model. Each provider handles it under its own API terms — Anthropic and OpenAI do not train on API content by default; Moonshot AI's terms let it use API content to improve its models unless a restriction is agreed with it; Google's terms depend on the Gemini plan in use.",

  pWhereHeading: "Where it is stored",
  pWhere:
    "Everything is stored in a PostgreSQL database, including uploaded files, and the app runs on Vercel. Both are third-party providers that hold the data on Unitos's behalf.",

  pRetentionHeading: "How long it is kept",
  pRetention:
    "Your material stays until you delete it. Deleting a project deletes its notes and annotations. Rejected notes are kept seven days so you can undo, then permanently deleted by a daily job. To delete your account and everything in it, email robertwzl311@gmail.com and it will be done.",

  pRightsHeading: "Your choices",
  pRightsIntro: "It is your material, and you can:",
  pRightsExport: "Export any project to Markdown or Word from the app, at any time.",
  pRightsEdit: "Edit or delete any document, note, or annotation yourself.",
  pRightsDelete: "Ask for a copy of your data, a correction, or full deletion, by email.",
  pRightsLaw:
    "If you are in the EEA, the UK, or California, you have rights of access, correction, deletion, and portability under laws such as the GDPR and CCPA. Unitos honours these for everyone, by email, without charge.",

  pChildrenHeading: "Children",
  pChildren:
    "Unitos is not intended for children under 13, and is not knowingly used by them. If a child's data has ended up here, email and it will be removed.",

  pSecurityHeading: "Security",
  pSecurity:
    "Traffic is encrypted over HTTPS, the sign-in cookie cannot be read by scripts, and each account can only reach its own projects. No service can promise perfect security, so please do not store anything you could not bear to lose or to see exposed.",

  pChangesHeading: "Changes to this policy",
  pChanges:
    "If this policy changes, the date at the top changes with it. A change that materially affects what happens to your material will be announced in the app before it takes effect.",

  pContactHeading: "Contact",
  pContact: "Email robertwzl311@gmail.com about anything on this page.",

  // ── Terms ────────────────────────────────────────────────────────────────
  tIntro:
    "These terms are the agreement between you and Unitos. Using the app at unitosnotebook.com means you accept them. If you do not, please do not use the app.",

  tServiceHeading: "What Unitos is",
  tService:
    "Unitos is a tool for reading documents and videos closely and keeping notes anchored to them, with an assistant that reads what you have collected. It is early software, run by one developer, and provided free.",

  tAccountHeading: "Your account",
  tAccount:
    "You sign in with a Google account, and that account is yours alone — keep it secure, and do not share it. You must be at least 13 years old. Unitos may suspend an account that breaks these terms.",

  tContentHeading: "Your material",
  tContent:
    "What you upload and write stays yours. You give Unitos only the permission it needs to run the app for you: to store your material, to process it, and to send the relevant parts to the AI providers named in the Privacy Policy when you ask for something. That permission ends when you delete the material.",

  tUseHeading: "Using it fairly",
  tUseIntro: "When you use Unitos, do not:",
  tUseRights:
    "Upload documents or videos you have no right to use, or use Unitos in a way that breaks someone's copyright.",
  tUseIllegal: "Store or produce anything unlawful, or anything designed to harm someone.",
  tUseAbuse:
    "Attack, overload, or probe the service, work around its limits, or use it to build a competing product from its output.",
  tUseAutomate: "Run automated bulk requests that are not ordinary use of the app.",

  tAiHeading: "What the assistant says",
  tAi:
    "The assistant and every AI feature can be wrong, incomplete, or confidently mistaken, including when they quote or cite a document. Check anything that matters against the source itself — that is what the anchors and source chips are for. Nothing Unitos produces is legal, financial, medical, or investment advice, and decisions you make from it are yours.",

  tThirdHeading: "Services Unitos relies on",
  tThird:
    "Signing in uses Google, and the AI features use Anthropic, Moonshot AI, OpenAI, Groq, Google, and YouTube. Their own terms apply to their part of the work, and an outage or change at any of them can affect Unitos.",

  tAvailabilityHeading: "Availability",
  tAvailability:
    "Unitos is provided as it is, with no promise that it will be available, uninterrupted, or free of faults, and features may change or be withdrawn. Keep your own copies of anything you cannot afford to lose — the export in the app is there for that.",

  tLiabilityHeading: "Liability",
  tLiability:
    "To the extent the law allows, Unitos is not liable for lost material, lost profit, or any indirect or consequential loss arising from your use of it. Nothing here limits liability that cannot legally be limited.",

  tEndHeading: "Ending your use",
  tEnd:
    "You can stop at any time, and email robertwzl311@gmail.com to have your account and material deleted. Unitos may end or restrict access if these terms are broken, or if running the service is no longer possible.",

  jurisdiction: "the State of California, United States",
  tLawHeading: "Governing law",
  tLaw:
    "These terms are governed by the laws of {jurisdiction}, and disputes belong to the courts there.",

  tChangesHeading: "Changes to these terms",
  tChanges:
    "If these terms change, the date at the top changes with them, and continuing to use Unitos means accepting the new version.",

  tContactHeading: "Contact",
  tContact: "Email robertwzl311@gmail.com about anything on this page.",
};

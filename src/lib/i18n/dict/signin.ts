// The sign-in page (/signin): dark front door — badge, hero, one CTA card,
// the reader as it is, key functions as cards. zh glossary: dict/common.ts.

export const en = {
  // The hero: "Got a ___?" — the blank rolls through heroItems (| separated,
  // article included), one every 2 seconds; {item} in heroA is the blank.
  // heroB is the punch line, larger.
  heroA: "Got {item}?",
  heroItems:
    "a video|an audio file|an article|a research paper|a legal document|a PDF assignment",
  heroB: "Put it in Unitos Notebook.",
  // The pitch, typed out on load (signin/hero-pitch.tsx): one line, big and
  // bold, just under the hero's second line in size, that underlines itself.
  heroPitch: "Your understanding, your pace.",
  // The trial band under the card and the deck, above the plans
  // (signin/trial-band.tsx): the lead line, then the offer, bigger, sparkling.
  trialLead: "Break everything down, see all your progress.",
  trialOffer: "Try it now for 2 months free!",
  ctaTitle: "New here? Start your first project",
  signinTitle: "Welcome back",
  forgotTitle: "Reset your password",
  // The sign-up card: the email alone, then Start now. No card, no name:
  // the confirmation link opens the account.
  startNow: "Start now — it's free",
  signIn: "Sign in",
  emailLabel: "Email",
  passwordLabel: "Password",
  confirmPasswordLabel: "Confirm password",
  forgot: "Forgot password?",
  toSignin: "Already have an account? Sign in",
  toSignup: "New here? Create one",
  sendReset: "Send the reset link",
  or: "or",
  google: "Continue with Google",
  apple: "Continue with Apple",
  accountNote: "Sign-in creates your account and keeps your projects yours.",
  // The sentence beside the card, the arrow pointing at it.
  noCardKicker: "No billing information",
  noCard: "Enter your email. Start your work now.",
  noCardSub: "Two months of Unitos Premium, free. We never ask for a card to begin.",

  // The beta notice: opens once per tab when the page loads, a bowing figure above it.
  betaTitle: "Unitos is in beta",
  betaThanks:
    "Thank you for being here this early. Every project you build and every piece of feedback you send shapes what Unitos becomes.",
  betaFree:
    "As our thanks, every beta account gets Unitos free and without limits for now: the whole notebook, and the GLM, Kimi, Claude, Gemini, and Groq tokens it uses, at no cost to you.",
  betaSigned: "— The Unitos team",
  betaContinue: "Continue",

  // Check-your-email state (/signin?sent=<email>; mode=forgot after a reset)
  sentTitle: "Check your email",
  sentTo: "We sent a confirmation link to",
  sentRest: "Click it to open your account. The link expires in 30 minutes.",
  resetSentTo: "If an account exists, a reset link is on its way to",
  resetSentRest: "Click it to set a new password. The link expires in 30 minutes.",
  sentBack: "Use a different email",

  // The confirmation email
  emailSubject: "Confirm your email — Unitos",
  emailTitle: "Confirm your email",
  emailBody: "Click the button to confirm this email address and create your Unitos account.",
  emailCta: "Confirm email",
  emailExpiry: "The link expires in 30 minutes.",
  emailIgnore: "If you did not request this, ignore this email.",

  // The reset email
  resetEmailSubject: "Reset your password — Unitos",
  resetEmailTitle: "Reset your password",
  resetEmailBody: "Click the button to set a new password for your Unitos account.",
  resetEmailCta: "Set a new password",

  // The reset page (/reset)
  setPassword: "Set password",
  resetTitle: "Set a new password",

  // The reader deck (signin/reader-deck.tsx): five screens, | separated —
  // the tab of each and the caption under it.
  deckTabs: "Reader|Notes full page|Notes in the reader|Graph and Stitch|Collaboration",
  deckCaptions:
    "Select a passage and the popover opens under it: the assistant’s command box, then Simplify, Visualize, Comment, Add to notes, Link across texts — the highlight colors right above. Simplify rewrites it beside the article, Visualize (Ultra) draws it, and the assistant answers a command on it in a chat card — every one saved under Annotations.|The notes full page: compare notes side by side or stacked. Hold a note and carry it over another; the ring draws itself, the held note falls in, and the other blooms as it takes it — seams kept, Undo a step away.|Notes stay beside the reader. Drag a highlight’s card onto a note and a reference lands in it; hold a note and let it go over the article, and it floats there — read it, then press the pencil and write against the text.|The graph draws every document as a node and every link as a curve. Stitch reads the documents you pick — papers, transcripts, web pages — and proposes links you accept.|Share a project: collaborators highlight, reply under notes, resolve threads, and propose edits you accept — every change signed.",
  deckPrev: "Previous screen",
  deckNext: "Next screen",

  tagline: "One project · every note anchored · accepted by you",

  // Single-reader mode
  singleTitle: "Sign-in is off on this instance.",
  singleDesc:
    "It runs as a single reader. Set SESSION_SECRET plus Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET), Apple (APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY), or email (RESEND_API_KEY, EMAIL_FROM) credentials to open sign-in.",
  singleContinue: "Open Unitos",

  // Callback errors
  errNoCode: "Google returned no code",
  errState: "Sign-in state mismatch — try again",
  errVerify: "Could not verify your Google identity",
  errAppleNoCode: "Apple returned no code",
  errAppleVerify: "Could not verify your Apple identity",
  errEmailInvalid: "Enter a valid email",
  errEmailSend: "Could not send the confirmation email — try again",
  errEmailToken: "Confirmation link expired or already used — request a new one",
  errBadLogin: "Wrong email or password",
  errNoPassword: "This account has no password yet — use Forgot password to set one",
  errBlocked: "This email is blocked",
  errPasswordShort: "Password must be at least 8 characters",
  errPasswordMatch: "Passwords do not match",
};

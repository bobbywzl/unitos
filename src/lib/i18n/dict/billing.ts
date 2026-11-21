// UI strings of billing (SPEC.md §24): the plan page, the order page, the
// confirmation page, and the receipts, all under /billing, plus the links to
// them in the app. zh glossary: dict/common.ts. Every key exists in both
// languages — zh's type enforces it.

export const en = {
  // The plan page's title, and the link to it in the Ultra message in the
  // reader.
  plans: "Plans",
  intro: "Two tiers. Pick one and pay with Stripe.",
  cancelAnyTime: "Cancel any time.",
  backToApp: "Back to Unitos",
  backToPlans: "Back to plans",
  preview: "Billing is off. Only the admin sees this page. Turn it on from Admin › Billing.",
  // What each tier holds (TIERS.md). The plan page lists six lines per
  // tier; the order page lists the first four of Unitos Premium and the
  // first line and the two short lines of Unitos Ultra.
  premiumFeature1: "Reading, notes, anchoring, export",
  premiumFeature2: "Documents: PDF, web page, image, video, audio",
  premiumFeature3: "AI: derivations, assistant, extract, glossary, conversion",
  premiumFeature4: "Sharing and collaboration",
  premiumFeature5: "Extract: a set number of runs per document",
  premiumFeature6: "Annotations up to the included allowance · standard storage · images up to 25 MB in notes",
  ultraFeature1: "Everything in Unitos Premium",
  ultraFeature2: "Visualize: the selection as a picture — a diagram, a drawing, or a short animation",
  ultraFeature3:
    "Tool conversations: continue a Simplify, Analyze, or Visualize card into a conversation",
  ultraFeature4: "Offline copies: a project's pages and images kept in the browser, so it opens without a network",
  ultraFeature5: "2× the Extract runs, and unlimited annotations",
  ultraFeature6: "5× the storage space",
  ultraShort2: "Visualize, Tool conversations, offline copies",
  ultraShort3: "2× the runs, unlimited annotations, 5× the storage",
  // The price line: "{price} / month", "{price} / 3 months".
  priceInterval: "{price} / {interval}",
  priceIntervalN: "{price} / {n} {interval}s",
  intervalN: "{n} {interval}s",
  intervalDay: "day",
  intervalWeek: "week",
  intervalMonth: "month",
  intervalYear: "year",
  priceUnset: "Price not set",
  // The card's price: the monthly rate, then the other interval's rate under
  // it. Monthly selected: "or {price} / month billed yearly · save {n}%".
  // Yearly selected: "{price} billed yearly · save {n}%".
  perMonth: "/ month",
  altMonthly: "or {price} / month billed yearly",
  altYearly: "{price} billed yearly",
  altSave: "save {n}%",
  // The Monthly/Yearly toggle on the plan page, and the badge Yearly
  // carries: the largest yearly saving among the tiers, a whole percent,
  // floored.
  intervalToggleMonthly: "Monthly",
  intervalToggleYearly: "Yearly",
  saveUpTo: "Save up to {n}%",
  switchToYearly: "Switch to yearly billing",
  switchToMonthly: "Switch to monthly billing",
  // The trial on the plan page (TIERS.md): a new account gets Unitos
  // Premium free for two months, so a checkout on the trial starts free.
  freeNow: "{n} Months Free Now",
  startFreeLine:
    "Start free: nothing is charged today. Your first payment is on {date} — cancel before then and pay nothing.",
  startFree: "Start Free",
  getTier: "Get {tier}",
  yourPlan: "Your plan",
  signInToChoose: "Sign in to choose a tier",
  // The account's state over the cards.
  currentTrial: "Your Unitos Premium trial ends on {date}. Pick a tier to keep Premium after that.",
  currentExpired: "Your trial ended on {date}. Pick a tier to bring Premium features back.",
  currentSubscribed: "You have {tier}. The paid period ends on {date}.",
  currentGranted: "You have {tier}, granted by the operator. Nothing to pay.",
  // The beta (TIERS.md): before the state line while BETA is on.
  betaLine:
    "Unitos is in beta: every account has Unitos Ultra for now. The tier you choose takes effect when the beta ends.",
  manage: "Manage subscription",
  manageOpening: "Opening Stripe…",
  manageFailed: "Could not open Stripe. {reason}",
  receipts: "Receipts",
  seePlans: "See plans",
  // The upgrade panel: the tier chip pressed by a Unitos Premium account.
  // The list under the intro is ultraFeature2–6.
  upgradeIntro: "What Unitos Ultra adds to Unitos Premium:",
  // The billing ask: after 30 minutes of active time, a card to keep Unitos
  // Premium after the trial (lib/active-time.ts).
  askTitle: "Keep Unitos Premium free for {n} months",
  askBody:
    "Your account has Unitos Premium free until {date}. Add a card now to keep it after that: nothing is charged until {date}, and canceling before then costs nothing.",
  askAddCard: "Add a card",
  askNotNow: "Not now",
  // The subscription panel in Settings: the plan, its status, the billing
  // interval, the card on file, and the actions on the subscription.
  panelPlan: "Plan",
  panelStatus: "Status",
  panelBilling: "Billing",
  panelCard: "Card",
  panelCardValue: "{brand} ending in {last4}",
  panelCardNone: "None",
  panelStatusTrial: "Free trial until {date}. No card on file.",
  panelStatusTrialAsk:
    "Add a card to keep Unitos Premium after the trial. Nothing is charged until then, and canceling before then costs nothing.",
  panelStatusExpired: "The trial ended on {date}. Pick a tier to bring Unitos Premium back.",
  panelStatusGranted: "Granted by the operator. Nothing to pay.",
  panelSubTrial: "Free until {date}. The first payment lands then.",
  panelSubRenews: "Renews on {date}.",
  panelSubCanceling: "Canceled. Paid until {date}; the tier ends then.",
  panelSubPastDue: "The last payment failed. Update the card to keep the tier.",
  panelSubHeld: "Held by Stripe. Manage subscription says why.",
  panelStripe: "Stripe holds the card and the invoices. Manage subscription opens them.",
  changePlan: "Change plan",
  updateCard: "Update card",
  cancelSubscription: "Cancel subscription",
  // The order page: the tier, its price, the account, and Pay.
  orderTitle: "Order",
  orderSub: "{tier}, {billed}. Stripe handles the payment.",
  billedMonthly: "billed monthly",
  billedYearly: "billed yearly",
  orderAccount: "Account",
  orderTier: "Tier",
  orderPrice: "Price",
  // The yearly price with its monthly rate: "{year} / year ({month} / month)".
  priceYearLine: "{year} / year ({month} / month)",
  orderChargedNow: "Charged now",
  orderFirstCharge: "First charge",
  orderFirstChargeValue: "{price} on {date}",
  orderFreeUntil: "Free until {date}, then {price} every {interval}.",
  orderRenewsOn: "Renews every {interval} on {date}.",
  orderCanceled: "Payment was canceled. Nothing was charged.",
  orderAlready: "This account already has a subscription: {tier}. Change it from Manage subscription.",
  orderLegal: "By paying you agree to the {terms} and the {privacy}.",
  orderLegalAfter: "Card details go to Stripe, never to Unitos.",
  pay: "Pay with Stripe",
  paying: "Opening Stripe…",
  payingBody: "Stripe's secure checkout opens in this tab. When you are done paying, Stripe brings you back here.",
  payFailed: "Could not open Stripe. {reason}",
  // The confirmation page: Stripe returns here after payment.
  confirmedTitle: "You're Powerful!",
  confirmedThanks: "Thank you for choosing Unitos.",
  confirmedBody: "You have {tier}. Every project reads the tier on its next load.",
  confirmedNoteTrial: "Nothing was charged today. The first payment of {price} lands on {date}.",
  confirmedNoteCharged: "{price} charged today. Next renewal on {date}.",
  confirmedProcessing: "Payment is processing",
  confirmedProcessingBody:
    "Stripe has not settled the payment yet. The tier turns on and the receipt appears under Receipts when it does.",
  confirmedDashboard: "Go to dashboard",
  // The confirmation page without a session id: a stray visit.
  confirmedNoneTitle: "No order to confirm",
  confirmedNoneBody: "Stripe brings you here after a payment. This visit has no order. Choose a tier on the plans page.",
  confirmedReceipt: "See the receipt",
  // Receipts: one per payment.
  receiptsEmpty: "No receipts. One appears here for every payment.",
  receiptTitle: "Receipt",
  receiptNumber: "Number",
  receiptDate: "Date",
  receiptAccount: "Account",
  receiptTier: "Tier",
  receiptPeriod: "Period",
  receiptPeriodRange: "{from} – {to}",
  receiptAmount: "Amount",
  receiptStatus: "Status",
  statusPaid: "Paid",
  statusRefunded: "Refunded",
  receiptPdf: "PDF from Stripe",
  receiptStripe: "Invoice on Stripe",
  receiptPrint: "Print",
  receiptIssuer: "Issued by Unitos through Stripe.",
};

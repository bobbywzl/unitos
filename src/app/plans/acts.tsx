import Link from "next/link";
import type { TFunc } from "@/lib/i18n/dictionaries";

// The acts of the plans page (SPEC.md §24), from the design file: the hero,
// the white crystal, what Unitos Premium holds (the tools, the notes, the
// collaboration, the document kinds), the turn, the descent, the black
// diamond, and what Unitos Ultra adds. The markup is the design's, one
// class per element (plans.css); the words are the plans dictionary's; the
// prices come from Stripe through the page. The choreography runs on
// scroll-driven timelines, no script.

/** The rates the acts show: "$19.99 / month" and "$15.99 / month billed yearly", per tier. */
export type PlansPrices = { premiumMonth: string; premiumYearly: string; ultraMonth: string; ultraYearly: string };

export function PlansActs({ t, prices, freeMonths }: { t: TFunc; prices: PlansPrices; freeMonths: number }) {
  return (
    <>
      <section className="pn-1" data-act="hero">
        <div className="pn-2">
          <div className="pn-3" data-hero="1">
            <h1 className="pn-4">
              {t("billing.plans")}
            </h1>
            <p className="pn-5">
              {t("billing.intro")}
            </p>
            <p className="pn-6" data-reveal="1">
              {t("billing.cancelAnyTime")}
            </p>
            <p className="pn-7">
              {t("billing.freeNow", { n: freeMonths })}
            </p>
          </div>
          <div className="pn-8" data-hint="1">
            <span className="pn-9">
              {t("plans.scroll")}
            </span>
            <svg className="pn-10" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </section>
      <section className="pn-11" data-act="premium">
        <div className="pn-12" />
        <div className="pn-13">
          <div className="pn-14" />
          <div className="pn-15" />
          <div className="pn-16" />
          <svg className="pn-17" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-18" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-19" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-20" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-21" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-22" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-23" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-24" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-25" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-26" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-27" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-28" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-29" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
        </div>
        <div className="pn-30">
          <div className="pn-31" data-glow="premium" />
          <div className="pn-32">
            <div className="pn-33" data-stone="premium">
              <svg className="pn-34" width="min(58vw, 420px, 46vh)" height="min(58vw, 420px, 46vh)" viewBox="0 0 24 24">
                <path d="M12 2l6 6v9l-6 5-6-5V8Z" fill="#ffffff" />
                <path d="M12 2v20l6-5V8Z" fill="#e9e3d8" />
                <path d="M12 2l6 6-6 3.5Z" fill="#f7f4ee" />
                <path d="M12 2 6 8l6 3.5Z" fill="#ffffff" />
                <path d="M12 11.5V22l-6-5V8Z" fill="#f3efe7" />
                <path d="M12 2l6 6v9l-6 5-6-5V8Z" fill="none" stroke="#a89c88" strokeWidth="0.5" strokeLinejoin="round" />
                <path d="M6 8l6 3.5L18 8M12 11.5V22" fill="none" stroke="#b9ad99" strokeOpacity="0.8" strokeWidth="0.32" />
                <path d="M9.2 6.2 11 4.4" stroke="#fff" strokeWidth="0.7" strokeLinecap="round" />
                <defs>
                  <clipPath id="pl-clip-prem">
                    <path d="M12 2l6 6v9l-6 5-6-5V8Z" />
                  </clipPath>
                  <linearGradient id="pl-sheen-prem" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor="#fff" stopOpacity="0" />
                    <stop offset="0.45" stopColor="#fff" stopOpacity="0.95" />
                    <stop offset="0.55" stopColor="#f3e6c4" stopOpacity="0.9" />
                    <stop offset="1" stopColor="#fff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <g clipPath="url(#pl-clip-prem)">
                  <rect className="pn-35" x="-2" y="0" width="7" height="24" fill="url(#pl-sheen-prem)" />
                  <path className="pn-36" d="M12 2l6 6-6 3.5Z" fill="#ffffff" />
                  <path className="pn-37" d="M12 11.5V22l-6-5V8Z" fill="#ffffff" />
                </g>
                <g transform="translate(9.90 -0.10) scale(0.175)">
                  <path className="pn-38" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#ffffff" />
                </g>
                <g transform="translate(15.90 5.90) scale(0.175)">
                  <path className="pn-39" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#ffffff" />
                </g>
                <g transform="translate(3.90 5.90) scale(0.175)">
                  <path className="pn-40" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#ffffff" />
                </g>
                <g transform="translate(9.90 9.40) scale(0.175)">
                  <path className="pn-41" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#ffffff" />
                </g>
                <g transform="translate(15.90 14.90) scale(0.175)">
                  <path className="pn-42" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#ffffff" />
                </g>
                <g transform="translate(9.90 19.90) scale(0.175)">
                  <path className="pn-43" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#ffffff" />
                </g>
                <g transform="translate(6.90 2.90) scale(0.175)">
                  <path className="pn-44" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#ffffff" />
                </g>
              </svg>
            </div>
          </div>
          <div className="pn-45" data-stone-label="premium">
            <h2 className="pn-46">
              {t("common.tierPremium")}
            </h2>
            <p className="pn-47">
              {prices.premiumMonth}{" "}
              <span className="pn-48">
                ·
              </span>
              {" "}{prices.premiumYearly}
            </p>
            <div className="pn-49">
              <span className="pn-50">
                {t("billing.freeNow", { n: freeMonths })}
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="pn-51">
        <div className="pn-52">
          <div className="pn-53" data-reveal="1">
            <div>
              <h3 className="pn-54">
                {t("plans.onlyNecessaryTools")}
              </h3>
              <p className="pn-55">
                {t("plans.sixToolsEachReads")}
              </p>
            </div>
            <div className="pn-56">
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.simplify")}
                </h4>
                <div className="pn-59">
                  <div className="pn-60">
                    <span className="pn-61" />
                    <p className="pn-62">
                      {t("plans.theFieldWeakensWith")}{" "}
                      <span className="pn-63">
                        {t("plans.itsStrengthFallsAs")}
                      </span>
                    </p>
                    <span className="pn-64" />
                    <span className="pn-65" />
                  </div>
                  <div className="pn-66">
                    <span className="pn-67">
                      {t("plans.assistant")}
                    </span>
                    <span className="pn-68">
                      {t("plans.simplify")}
                    </span>
                    <span className="pn-67">
                      {t("plans.colors")}
                    </span>
                    <span className="pn-67">
                      {t("plans.comment")}
                    </span>
                  </div>
                  <div className="pn-69">
                    <span className="pn-70">
                      {t("plans.simplified")}
                    </span>
                    <span className="pn-71">
                      {t("plans.twiceAsFarA")}
                    </span>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.rewritesTheSelectionIn")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.extract")}
                </h4>
                <div className="pn-59">
                  <div className="pn-84">
                    <span className="pn-85">
                      {t("plans.whereIsFluxDefined")}
                    </span>
                    <span className="pn-86">
                      ↵
                    </span>
                  </div>
                  <div className="pn-87">
                    <div className="pn-88">
                      <span className="pn-89">
                        {t("plans.theFluxThroughA")}{" "}
                        <span className="pn-81">
                          ¶ 4
                        </span>
                      </span>
                      <span className="pn-90">
                        {t("plans.definesTheTermDirectly")}
                      </span>
                    </div>
                    <div className="pn-91">
                      <span className="pn-89">
                        {t("plans.theSameFluxWhatever")}{" "}
                        <span className="pn-81">
                          ¶ 7
                        </span>
                      </span>
                      <span className="pn-90">
                        {t("plans.usesItThreeParagraphs")}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.askTheArticleOne")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.assistant")}
                </h4>
                <div className="pn-59">
                  <div className="pn-60">
                    <span className="pn-61" />
                    <p className="pn-62">
                      {t("plans.theFieldWeakensWith")}{" "}
                      <span className="pn-63">
                        {t("plans.itsStrengthFallsAs")}
                      </span>
                    </p>
                    <span className="pn-64" />
                    <span className="pn-65" />
                  </div>
                  <div className="pn-66">
                    <span className="pn-68">
                      {t("plans.assistant")}
                    </span>
                    <span className="pn-67">
                      {t("plans.simplify")}
                    </span>
                    <span className="pn-67">
                      {t("plans.colors")}
                    </span>
                    <span className="pn-67">
                      {t("plans.comment")}
                    </span>
                  </div>
                  <div className="pn-92">
                    <span className="pn-93">
                      {t("plans.whyAQuarter")}
                    </span>
                    <span className="pn-94">
                      {t("plans.distanceIsSquared")}{" "}
                      <span className="pn-81">
                        ¶ 2
                      </span>
                      {" "}{t("plans.thePassageSOwn")}{" "}
                      <span className="pn-81">
                        ¶ 5
                      </span>
                      .
                    </span>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.typeOrSpeakA")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.multiUpload")}
                </h4>
                <div className="pn-59">
                  <div className="pn-95">
                    {t("plans.dropDocumentsHere")}
                  </div>
                  <div className="pn-60">
                    <span className="pn-96">
                      {t("plans.n3MembersOnePage")}
                    </span>
                    <div className="pn-97">
                      <span className="pn-98">
                        {t("plans.pdf")}
                      </span>
                      <span className="pn-99">
                        {t("plans.principiaBookIii")}
                      </span>
                    </div>
                    <div className="pn-100">
                      <span className="pn-101">
                        {t("plans.video")}
                      </span>
                      <span className="pn-99">
                        {t("plans.lecture4InverseSquare")}
                      </span>
                    </div>
                    <div className="pn-102">
                      <span className="pn-103">
                        {t("plans.web")}
                      </span>
                      <span className="pn-99">
                        {t("plans.gaussOnFluxWeb")}
                      </span>
                    </div>
                  </div>
                  <div className="pn-104">
                    <span className="pn-105">
                      {t("plans.stitch")}
                    </span>
                    <span className="pn-106">
                      {t("plans.findWhereTheseDocuments")}
                    </span>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.dropTwoOrMore")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.graphView")}
                </h4>
                <div className="pn-59">
                  <div className="pn-107">
                    <span className="pn-108">
                      {t("plans.list")}
                    </span>
                    <span className="pn-109">
                      {t("plans.graph")}
                    </span>
                  </div>
                  <span className="pn-110">
                    {t("plans.n3Documents5Links")}
                  </span>
                  <svg className="pn-111" viewBox="0 0 300 160" fill="none">
                    <g className="pn-112" stroke="#c67139" strokeLinecap="round">
                      <path d="M62 52C110 20 170 24 232 46" strokeWidth="3.5" />
                      <path d="M62 52C90 100 130 116 150 128" strokeWidth="1.6" />
                      <path d="M232 46C220 90 190 112 150 128" strokeWidth="1.6" strokeDasharray="4 4" stroke="#7a8a5e" />
                    </g>
                    <g className="pn-113">
                      <g className="pn-114">
                        <circle cx="62" cy="52" r="20" fill="#ffe1d0" stroke="#c67139" strokeWidth="1.5" />
                        <text className="pn-115" x="62" y="55" textAnchor="middle" fontSize="9" fontWeight="700" fill="#8c491a">
                          {t("plans.pdf")}
                        </text>
                      </g>
                      <circle cx="232" cy="46" r="20" fill="#e1eecc" stroke="#7a8a5e" strokeWidth="1.5" />
                      <text className="pn-115" x="232" y="49" textAnchor="middle" fontSize="9" fontWeight="700" fill="#3d472b">
                        {t("plans.video")}
                      </text>
                      <circle cx="150" cy="128" r="20" fill="#eee7db" stroke="#a89c88" strokeWidth="1.5" />
                      <text className="pn-115" x="150" y="131" textAnchor="middle" fontSize="9" fontWeight="700" fill="#645c50">
                        {t("plans.web")}
                      </text>
                    </g>
                  </svg>
                  <div className="pn-116">
                    {t("plans.n3LinksBetweenThese")}
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.theProjectAsA")}
                </p>
              </div>
            </div>
          </div>
          <div className="pn-117">
            <Link className="pn-118" href="/billing/order/premium">
              {t("plans.buyPremium")}
            </Link>
          </div>
          <div className="pn-53" data-reveal="1">
            <div>
              <h3 className="pn-54">
                {t("plans.perfectYourWorkflowWith")}
              </h3>
              <p className="pn-119">
                {t("plans.notesSitBesideThe")}
              </p>
            </div>
            <div className="pn-120">
              <div>
                <h4 className="pn-121">
                  {t("plans.aMiniatureGoogleDoc")}
                </h4>
                <p className="pn-122">
                  {t("plans.headingsListsChecklistsQuotes")}
                </p>
              </div>
              <div className="pn-123">
                <div className="pn-124">
                  <div className="pn-125">
                    <span className="pn-126">
                      {t("plans.note")}
                    </span>
                    <span className="pn-127">
                      {t("plans.saving")}
                    </span>
                    <span className="pn-128">
                      {t("plans.saved")}
                    </span>
                  </div>
                  <div className="pn-129">
                    <span className="pn-130">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 14 4 9l5-5" />
                        <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
                      </svg>
                    </span>
                    <span className="pn-130">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 14 5-5-5-5" />
                        <path d="M20 9H10a6 6 0 0 0 0 12h3" />
                      </svg>
                    </span>
                    <span className="pn-131" />
                    <span className="pn-132">
                      H1
                    </span>
                    <span className="pn-130">
                      H2
                    </span>
                    <span className="pn-130">
                      H3
                    </span>
                    <span className="pn-133">
                      •
                    </span>
                    <span className="pn-130">
                      –
                    </span>
                    <span className="pn-130">
                      1.
                    </span>
                    <span className="pn-130">
                      ☐
                    </span>
                    <span className="pn-130">
                      ❝
                    </span>
                    <span className="pn-131" />
                    <span className="pn-134">
                      B
                    </span>
                    <span className="pn-135">
                      I
                    </span>
                    <span className="pn-136">
                      U
                    </span>
                    <span className="pn-131" />
                    <span className="pn-137" />
                    <span className="pn-138" />
                    <span className="pn-139" />
                    <span className="pn-140" />
                    <span className="pn-131" />
                    <span className="pn-130">
                      ⇤
                    </span>
                    <span className="pn-130">
                      ⇥
                    </span>
                    <span className="pn-131" />
                    <span className="pn-130">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-5-5L5 21" />
                      </svg>
                    </span>
                  </div>
                  <div className="pn-141" />
                  <div className="pn-142">
                    <span className="pn-143">
                      {t("plans.inverseSquareInOne")}
                    </span>
                  </div>
                  <div className="pn-144">
                    <div className="pn-145">
                      <span className="pn-146">
                        {t("plans.theFieldFallsWith")}{" "}
                        <b>
                          {t("plans.square")}
                        </b>
                        {" "}{t("plans.ofDistance")}
                      </span>
                    </div>
                    <div className="pn-147">
                      <span className="pn-80">
                        •
                      </span>
                      <span className="pn-148">
                        {t("plans.twiceAsFarA2")}
                      </span>
                    </div>
                    <div className="pn-147">
                      <span className="pn-80">
                        •
                      </span>
                      <span className="pn-149">
                        <span className="pn-150">
                          {t("plans.flux")}
                        </span>
                        {" "}{t("plans.throughAnyClosedSurface")}
                      </span>
                    </div>
                    <div className="pn-151">
                      <span className="pn-152" />
                      <span className="pn-153">
                        {t("plans.checkAgainstPrincipiaBook")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="pn-56">
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.mergeWithAi")}
                </h4>
                <div className="pn-59">
                  <div className="pn-154">
                    <span className="pn-106">
                      {t("plans.n2Selected")}
                    </span>
                    <span className="pn-155">
                      {t("plans.mergeWithAi")}
                    </span>
                    <span className="pn-106">
                      {t("plans.pin")}
                    </span>
                  </div>
                  <div className="pn-156">
                    <div className="pn-157">
                      <span className="pn-158" />
                      <b>
                        {t("plans.distance")}
                      </b>
                      <br />
                      {t("plans.fieldFallsWithR")}
                    </div>
                    <div className="pn-157">
                      <span className="pn-158" />
                      <b>
                        {t("plans.flux")}
                      </b>
                      <br />
                      {t("plans.sameFluxWhateverThe")}
                    </div>
                  </div>
                  <span className="pn-159">
                    <span className="pn-160" />
                    {t("plans.mergingWithAi")}
                  </span>
                  <div className="pn-161">
                    <span className="pn-162">
                      {t("plans.mergedNote")}
                    </span>
                    <b className="pn-163">
                      {t("plans.inverseSquareAndFlux")}
                    </b>
                    <div className="pn-164">
                      <span className="pn-80">
                        •
                      </span>
                      <span>
                        {t("plans.fieldFallsWithR2")}{" "}
                        <span className="pn-165">
                          ¶ 2
                        </span>
                      </span>
                    </div>
                    <div className="pn-166">
                      <span className="pn-80">
                        •
                      </span>
                      <span>
                        {t("plans.fluxUnchangedByThe")}{" "}
                        <span className="pn-165">
                          ¶ 5
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="pn-167">
                    <span className="pn-106">
                      {t("plans.n2NotesMergedInto")}
                    </span>
                    <span className="pn-168">
                      {t("plans.undo")}
                    </span>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.selectTwoNotesWith")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.quotesStraightFromThe")}
                </h4>
                <div className="pn-59">
                  <div className="pn-169">
                    <span className="pn-170" />
                    <p className="pn-171">
                      {t("plans.the")}{" "}
                      <span className="pn-172">
                        {t("plans.fluxThroughASurface")}
                      </span>
                      {t("plans.andItHoldsWhatever")}
                    </p>
                    <span className="pn-173" />
                  </div>
                  <div className="pn-174">
                    {t("plans.fluxThroughASurface2")}
                  </div>
                  <div className="pn-175">
                    <b className="pn-176">
                      {t("plans.flux")}
                    </b>
                    <span>
                      {t("plans.whereTheArticleDefines")}
                    </span>
                    <span className="pn-177" />
                    <div className="pn-178">
                      <span>
                        {t("plans.fluxThroughASurface2")}
                      </span>
                      <span className="pn-179">
                        ¶ 4
                      </span>
                    </div>
                    <span className="pn-180">
                      {t("plans.letGoToPut")}
                    </span>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.dragAPassageOut")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.annotationsBecomeNotes")}
                </h4>
                <div className="pn-59">
                  <div className="pn-181">
                    <span className="pn-182">
                      {t("plans.annotations")}
                    </span>
                    <div className="pn-183">
                      <span className="pn-184" />
                      <span>
                        <span className="pn-185">
                          {t("plans.aQuarterAsStrong")}
                        </span>
                        <br />
                        <span className="pn-106">
                          {t("plans.checkThe1687Derivation")}
                        </span>
                      </span>
                    </div>
                    <div className="pn-186">
                      <span className="pn-184" />
                      <span>
                        <span className="pn-172">
                          {t("plans.fluxIsUnchanged")}
                        </span>
                        <br />
                        <span className="pn-106">
                          {t("plans.jump")}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="pn-187">
                    <span className="pn-182">
                      {t("plans.noteFloating")}
                    </span>
                    <b className="pn-176">
                      {t("plans.openQuestions")}
                    </b>
                    <span>
                      {t("plans.doesThe1687Result")}
                    </span>
                    <div className="pn-188">
                      <span className="pn-189">
                        {t("plans.aQuarterAsStrong")}
                      </span>
                      <br />
                      <span className="pn-106">
                        {t("plans.checkThe1687Derivation")}
                      </span>
                    </div>
                    <span className="pn-190">
                      {t("plans.dropToMergeThis")}
                    </span>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.whileANoteFloats")}
                </p>
              </div>
            </div>
            <div className="pn-191">
              <div>
                <h4 className="pn-121">
                  {t("plans.aNoteAbsorbsAnything")}
                </h4>
                <p className="pn-122">
                  {t("plans.dragInAHighlight")}
                </p>
              </div>
              <div className="pn-192">
                <span className="pn-193">
                  {t("plans.annotation")}
                </span>
                <span className="pn-194">
                  {t("plans.extraction")}
                </span>
                <span className="pn-195">
                  {t("plans.distilledPoint")}
                </span>
                <span className="pn-196">
                  {t("plans.quote4")}
                </span>
                <span className="pn-197">
                  {t("plans.picture25Mb")}
                </span>
                <div className="pn-198">
                  <span className="pn-199">
                    {t("plans.note")}
                  </span>
                  <b className="pn-200">
                    {t("plans.inverseSquare")}
                  </b>
                  <div className="pn-201">
                    <span>
                      {t("plans.highlightsComments")}
                    </span>
                    <span>
                      {t("plans.quotesExtractions")}
                    </span>
                    <span>
                      {t("plans.distilledPointsPictures")}
                    </span>
                  </div>
                  <span className="pn-202">
                    {t("plans.n5SourcesAttached")}
                  </span>
                </div>
              </div>
            </div>
            <div className="pn-191">
              <div>
                <h4 className="pn-121">
                  {t("plans.compareThenMerge")}
                </h4>
                <p className="pn-122">
                  {t("plans.selectNotesOnThe")}
                </p>
                <div className="pn-203">
                  <span className="pn-204">
                    {t("plans.sideBySide")}
                  </span>
                  <span className="pn-205">
                    {t("plans.stacked")}
                  </span>
                  <span className="pn-206">
                    {t("plans.mergeWithAi")}
                  </span>
                </div>
              </div>
              <div className="pn-207">
                <div className="pn-208">
                  <span className="pn-209">
                    {t("plans.compare3Notes")}
                  </span>
                  <span className="pn-210">
                    <span className="pn-211">
                      {t("plans.sideBySide")}
                    </span>
                    <span className="pn-212">
                      {t("plans.stacked")}
                    </span>
                  </span>
                </div>
                <div className="pn-213">
                  <div className="pn-214">
                    <b className="pn-215">
                      {t("plans.newton")}
                    </b>
                    {t("plans.forceFallsWithR")}
                    <span className="pn-216">
                      {t("plans.theInverseSquare")}
                    </span>
                  </div>
                  <div className="pn-214">
                    <b className="pn-215">
                      {t("plans.gauss")}
                    </b>
                    {t("plans.fluxThroughAClosed")}
                    <span className="pn-217">
                      {t("plans.whateverTheSurface")}
                    </span>
                  </div>
                  <div className="pn-214">
                    <b className="pn-215">
                      {t("plans.lecture4")}
                    </b>
                    {t("plans.bothSayOneThing")}
                    <span className="pn-218">
                      {t("plans.transcript1240")}
                    </span>
                  </div>
                </div>
                <div className="pn-219">
                  <div className="pn-220">
                    <span className="pn-221" />
                    <b className="pn-215">
                      {t("plans.newton")}
                    </b>
                    {t("plans.forceFallsWithR")}
                    <span className="pn-216">
                      {t("plans.theInverseSquare")}
                    </span>
                  </div>
                  <div className="pn-220">
                    <span className="pn-221" />
                    <b className="pn-215">
                      {t("plans.lecture4")}
                    </b>
                    {t("plans.bothSayOneThing")}
                    <span className="pn-218">
                      {t("plans.transcript1240")}
                    </span>
                  </div>
                  <div className="pn-222">
                    <span className="pn-106">
                      {t("plans.n2Selected")}
                    </span>
                    <span className="pn-223">
                      {t("plans.mergeWithAi")}
                    </span>
                  </div>
                </div>
                <span className="pn-224">
                  <span className="pn-160" />
                  {t("plans.mergingWithAi")}
                </span>
                <div className="pn-225">
                  <span className="pn-162">
                    {t("plans.mergedNote")}
                  </span>
                  <b className="pn-226">
                    {t("plans.geometrySetsTheFall")}
                  </b>
                  <div className="pn-227">
                    <span className="pn-80">
                      •
                    </span>
                    <span>
                      {t("plans.forceFallsWithR2")}{" "}
                      <span className="pn-228">
                        ¶ 2
                      </span>
                    </span>
                  </div>
                  <div className="pn-229">
                    <span className="pn-80">
                      •
                    </span>
                    <span>
                      {t("plans.theLecturePutsBoth")}{" "}
                      <span className="pn-228">
                        12:40
                      </span>
                    </span>
                  </div>
                </div>
                <div className="pn-230">
                  <span className="pn-106">
                    {t("plans.n2NotesMergedInto")}
                  </span>
                  <span className="pn-168">
                    {t("plans.undo")}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="pn-117">
            <Link className="pn-118" href="/billing/order/premium">
              {t("plans.buyPremium")}
            </Link>
          </div>
          <div className="pn-53" data-reveal="1">
            <div>
              <h3 className="pn-54">
                {t("plans.readAndWriteTogether")}
              </h3>
              <p className="pn-119">
                {t("plans.oneProjectEveryCollaborator")}
              </p>
            </div>
            <div className="pn-56">
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.shareTheProject")}
                </h4>
                <div className="pn-59">
                  <div className="pn-73">
                    <span className="pn-231" />
                    <span className="pn-232">
                      <span className="pn-233">
                        B
                      </span>
                      <span className="pn-234">
                        <span className="pn-235">
                          L
                        </span>
                      </span>
                    </span>
                    <span className="pn-236">
                      {t("plans.share")}
                    </span>
                  </div>
                  <div className="pn-237">
                    <span className="pn-238">
                      {t("plans.shareThisProjectWith")}
                    </span>
                    <div className="pn-239">
                      <span className="pn-240">
                        <span className="pn-241">
                          {t("plans.lenaLabEdu")}
                        </span>
                      </span>
                      <span className="pn-242">
                        {t("plans.editor")}
                      </span>
                      <span className="pn-243">
                        {t("plans.add")}
                      </span>
                    </div>
                    <div className="pn-244">
                      <span className="pn-233">
                        B
                      </span>
                      <span className="pn-245">
                        <b>
                          {t("plans.bobby")}
                        </b>
                        <br />
                        <span className="pn-48">
                          {t("plans.bobbyLabEdu")}
                        </span>
                      </span>
                      <span className="pn-48">
                        {t("plans.owner")}
                      </span>
                    </div>
                    <div className="pn-246">
                      <span className="pn-235">
                        L
                      </span>
                      <span className="pn-245">
                        <b>
                          {t("plans.lena")}
                        </b>
                        <br />
                        <span className="pn-48">
                          {t("plans.lenaLabEdu")}
                        </span>
                      </span>
                      <span className="pn-247">
                        {t("plans.editor")}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.theOwnerAddsCollaborators")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.notesTogether")}
                </h4>
                <div className="pn-248">
                  <div className="pn-249">
                    <div className="pn-250">
                      {t("plans.pending1")}
                      <span className="pn-251">
                        {t("plans.acceptReject")}
                      </span>
                    </div>
                    <div className="pn-252">
                      <div className="pn-253">
                        <span className="pn-254">
                          L
                        </span>
                        <b>
                          {t("plans.lena")}
                        </b>
                        <span className="pn-48">
                          {t("plans.pending")}
                        </span>
                      </div>
                      <p className="pn-255">
                        {t("plans.gaussGivesTheSame")}
                      </p>
                      <div className="pn-256">
                        <span className="pn-257">
                          {t("plans.accept")}
                        </span>
                        <span className="pn-258">
                          {t("plans.reject")}
                        </span>
                      </div>
                    </div>
                    <div className="pn-259">
                      <div className="pn-253">
                        <span className="pn-260">
                          B
                        </span>
                        <b>
                          {t("plans.bobby")}
                        </b>
                        <span className="pn-48">
                          {t("plans.sep16")}
                        </span>
                      </div>
                      <p className="pn-255">
                        {t("plans.inverseSquareTwiceAs")}
                      </p>
                      <div className="pn-261">
                        <span className="pn-262">
                          L
                        </span>
                        <span>
                          <b>
                            {t("plans.lena")}
                          </b>
                          {" "}
                          <span className="pn-263">
                            {t("plans.sep171012")}
                          </span>
                          <br />
                          {t("plans.doesThisHoldInside")}
                          <br />
                          <span className="pn-264">
                            {t("plans.resolve")}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.everyNoteCarriesWho")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.annotateTheSameReader")}
                </h4>
                <div className="pn-59">
                  <div className="pn-265">
                    <span className="pn-266" />
                    <p className="pn-171">
                      {t("plans.theFieldWeakensWith")}{" "}
                      <span className="pn-267">
                        {t("plans.itsStrengthFallsAs2")}
                      </span>
                      {" "}{t("plans.ofTheSeparation")}{" "}
                      <span className="pn-268">
                        {t("plans.andTheFluxThrough")}
                      </span>
                    </p>
                    <span className="pn-269" />
                    <span className="pn-270" />
                  </div>
                  <span className="pn-271">
                    <span className="pn-272">
                      B
                    </span>
                  </span>
                  <span className="pn-273">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7a8a5e" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12z" />
                    </svg>
                    <span className="pn-274">
                      L
                    </span>
                  </span>
                  <div className="pn-275">
                    <div className="pn-276">
                      <span className="pn-254">
                        L
                      </span>
                      <b>
                        {t("plans.lena")}
                      </b>
                      <span className="pn-48">
                        {t("plans.commented")}
                      </span>
                      <span className="pn-277">
                        {t("plans.jump")}
                      </span>
                    </div>
                    <p className="pn-255">
                      {t("plans.thisIsGaussNot")}
                    </p>
                    <div className="pn-278">
                      <span className="pn-279">
                        B
                      </span>
                      <span className="pn-280">
                        {t("plans.agreedLinkingItNow")}
                      </span>
                      <span className="pn-257">
                        {t("plans.reply")}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.highlightsAndCommentsFrom")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.commentOnEachOther")}
                </h4>
                <div className="pn-281">
                  <div className="pn-282">
                    <span>
                      {t("plans.edits")}
                    </span>
                    <span className="pn-251">
                      {t("plans.editedTextShows")}{" "}
                      <span className="pn-105">
                        {t("plans.inColor")}
                      </span>
                    </span>
                  </div>
                  <div className="pn-283">
                    <div className="pn-253">
                      <span className="pn-258">
                        {t("plans.edit")}
                      </span>
                      <span className="pn-284">
                        <span className="pn-254">
                          L
                        </span>
                        <span className="pn-263">
                          {t("plans.sep171020")}
                        </span>
                      </span>
                    </div>
                    <div className="pn-285">
                      <span className="pn-263">
                        {t("plans.was")}
                      </span>
                      <p className="pn-286">
                        {t("plans.fallsWithTheDistance")}
                      </p>
                    </div>
                    <div className="pn-287">
                      <span className="pn-263">
                        {t("plans.now")}
                      </span>
                      <p className="pn-171">
                        {t("plans.fallsAsThe")}{" "}
                        <span className="pn-80">
                          {t("plans.inverseSquare2")}
                        </span>
                        {" "}{t("plans.ofTheDistance")}
                      </p>
                    </div>
                    <span className="pn-288">
                      {t("plans.revert")}
                    </span>
                    <div className="pn-289">
                      <div className="pn-290">
                        <span className="pn-279">
                          B
                        </span>
                        <span>
                          <b>
                            {t("plans.bobby")}
                          </b>
                          {" "}
                          <span className="pn-263">
                            10:24
                          </span>
                          <br />
                          {t("plans.cite2ForThis")}
                        </span>
                      </div>
                      <div className="pn-291">
                        <span className="pn-262">
                          L
                        </span>
                        <span>
                          <b>
                            {t("plans.lena")}
                          </b>
                          {" "}
                          <span className="pn-263">
                            10:26
                          </span>
                          <br />
                          {t("plans.doneChipAdded")}
                        </span>
                        <span className="pn-292">
                          {t("plans.resolve")}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.editsToTheArticle")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.seeTheWholeHistory")}
                </h4>
                <div className="pn-293">
                  <div className="pn-294">
                    <div className="pn-276">
                      <span className="pn-126">
                        {t("plans.history")}
                      </span>
                      <span className="pn-295">
                        <span className="pn-296">
                          B
                        </span>
                        <span className="pn-297">
                          <span className="pn-298">
                            L
                          </span>
                        </span>
                        <span className="pn-299">
                          M
                        </span>
                      </span>
                    </div>
                    <span className="pn-263">
                      {t("plans.whoChangedWhatAnd")}
                    </span>
                    <div className="pn-300">
                      <span className="pn-274">
                        L
                      </span>
                      <span className="pn-245">
                        <b>
                          {t("plans.lena")}
                        </b>
                        {" "}
                        <span className="pn-106">
                          {t("plans.editedText")}
                        </span>
                        <br />
                        <span className="pn-106">
                          {t("plans.fallsAsTheInverse")}
                        </span>
                      </span>
                      <span className="pn-263">
                        10:20
                      </span>
                    </div>
                    <div className="pn-301">
                      <span className="pn-272">
                        B
                      </span>
                      <span className="pn-245">
                        <b>
                          {t("plans.bobby")}
                        </b>
                        {" "}
                        <span className="pn-106">
                          {t("plans.mergedNotes")}
                        </span>
                        <br />
                        <span className="pn-106">
                          {t("plans.inverseSquareAndFlux")}
                        </span>
                      </span>
                      <span className="pn-263">
                        09:52
                      </span>
                    </div>
                    <div className="pn-301">
                      <span className="pn-302">
                        M
                      </span>
                      <span className="pn-245">
                        <b>
                          {t("plans.mei")}
                        </b>
                        {" "}
                        <span className="pn-106">
                          {t("plans.removedAParagraph")}
                        </span>
                        <br />
                        <span className="pn-303">
                          {t("plans.duplicateStatementOfThe")}
                        </span>
                      </span>
                      <span className="pn-263">
                        09:31
                      </span>
                    </div>
                    <div className="pn-300">
                      <span className="pn-274">
                        L
                      </span>
                      <span className="pn-245">
                        <b>
                          {t("plans.lena")}
                        </b>
                        {" "}
                        <span className="pn-106">
                          {t("plans.addedALink")}
                        </span>
                        <br />
                        <span className="pn-106">
                          {t("plans.gaussOnFluxWeb2")}
                        </span>
                      </span>
                      <span className="pn-263">
                        09:14
                      </span>
                    </div>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.everyEditMergeAnd")}
                </p>
              </div>
              <div className="pn-57">
                <h4 className="pn-58">
                  {t("plans.planTheWorkTogether")}
                </h4>
                <div className="pn-59">
                  <div className="pn-304">
                    <span className="pn-126">
                      {t("plans.assistant")}
                    </span>
                    <span className="pn-305">
                      <span className="pn-258">
                        {t("plans.document")}
                      </span>
                      <span className="pn-257">
                        {t("plans.project")}
                      </span>
                    </span>
                  </div>
                  <div className="pn-306">
                    <span className="pn-307">
                      {t("plans.contradictions")}
                    </span>
                    <span className="pn-258">
                      {t("plans.gaps")}
                    </span>
                  </div>
                  <span className="pn-308">
                    <span className="pn-160" />
                    {t("plans.reading14Notes")}
                  </span>
                  <div className="pn-309">
                    <div className="pn-310">
                      <div className="pn-311">
                        {t("plans.contradiction")}
                      </div>
                      <p className="pn-312">
                        <span className="pn-279">
                          B
                        </span>
                        {" "}{t("plans.saysTheFallOff")}{" "}
                        <span className="pn-262">
                          L
                        </span>
                        {" "}{t("plans.saysItFollowsFrom")}
                      </p>
                    </div>
                    <div className="pn-313">
                      <div className="pn-314">
                        {t("plans.openQuestion")}
                      </div>
                      <p className="pn-312">
                        {t("plans.nobodyHasCoveredThe")}{" "}
                        <span className="pn-315">
                          {t("plans.assign")}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
                <p className="pn-72">
                  {t("plans.inTheSidePanel")}
                </p>
              </div>
            </div>
          </div>
          <div className="pn-117">
            <Link className="pn-118" href="/billing/order/premium">
              {t("plans.buyPremium")}
            </Link>
          </div>
          <div className="pn-316" data-reveal="1">
            <div>
              <h3 className="pn-317">
                {t("plans.everyDocumentKind")}
              </h3>
              <p className="pn-318">
                {t("plans.importedWholeAndAs")}
              </p>
            </div>
            <div className="pn-319">
              <span>
                {t("plans.pdf")}
              </span>
              <span className="pn-320">
                {t("plans.webPage")}
              </span>
              <span>
                {t("plans.image")}
              </span>
              <span className="pn-320">
                {t("plans.video")}
              </span>
              <span>
                {t("plans.audio")}
              </span>
            </div>
          </div>
          <div className="pn-117">
            <Link className="pn-118" href="/billing/order/premium">
              {t("plans.buyPremium")}
            </Link>
          </div>
        </div>
      </section>
      <section className="pn-321">
        <p className="pn-322" data-reveal="1">
          {t("plans.waitThereSMore")}
        </p>
      </section>
      <section className="pn-323" data-act="night">
        <div className="pn-324">
          <svg className="pn-325" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-326" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-327" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-328" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-329" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-330" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-331" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-332" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-333" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-334" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-335" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-336" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-337" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-338" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-339" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-340" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-341" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-342" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-343" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-344" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-345" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <div className="pn-346" />
        </div>
        <div className="pn-347" />
        <div className="pn-348">
          <div className="pn-349" data-descend="1">
            <h2 className="pn-350">
              {t("plans.everythingInPremiumAnd")}
            </h2>
          </div>
        </div>
      </section>
      <section className="pn-351" data-act="ultra">
        <div className="pn-352">
          <div className="pn-353" />
          <div className="pn-354" />
          <svg className="pn-355" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-356" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-357" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-358" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-359" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-360" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-361" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-362" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-363" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-364" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-365" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
          <svg className="pn-366" viewBox="0 0 24 24">
            <path d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="currentColor" />
          </svg>
        </div>
        <div className="pn-30">
          <div className="pn-367" />
          <div className="pn-368">
            <div className="pn-369" data-stone="ultra">
              <svg className="pn-370" width="min(60vw, 440px, 46vh)" height="min(60vw, 440px, 46vh)" viewBox="0 0 24 24">
                <path d="M7 4h10l4.5 5.5L12 21 2.5 9.5Z" fill="#1a1713" />
                <path d="M7 4h10l-2 5.5H9Z" fill="#5a524a" />
                <path d="M2.5 9.5 7 4l2 5.5Z" fill="#3a342e" />
                <path d="M21.5 9.5 17 4l-2 5.5Z" fill="#3a342e" />
                <path d="M9 9.5h6L12 21Z" fill="#433c35" />
                <path d="M7 4h10l4.5 5.5L12 21 2.5 9.5Z" fill="none" stroke="#d6b26a" strokeOpacity="0.9" strokeWidth="0.45" strokeLinejoin="round" />
                <path d="M2.5 9.5h19" stroke="#d6b26a" strokeOpacity="0.6" strokeWidth="0.3" />
                <path d="M8.6 6.3 10 5.2" stroke="#fff" strokeOpacity="0.9" strokeWidth="0.5" strokeLinecap="round" />
                <defs>
                  <clipPath id="pl-clip-ultra">
                    <path d="M7 4h10l4.5 5.5L12 21 2.5 9.5Z" />
                  </clipPath>
                  <linearGradient id="pl-sheen-ultra" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor="#f3e6c4" stopOpacity="0" />
                    <stop offset="0.5" stopColor="#fff6dd" stopOpacity="0.7" />
                    <stop offset="1" stopColor="#d6b26a" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <g clipPath="url(#pl-clip-ultra)">
                  <rect className="pn-371" x="-2" y="0" width="7" height="24" fill="url(#pl-sheen-ultra)" />
                  <path className="pn-372" d="M7 4h10l-2 5.5H9Z" fill="#d6b26a" />
                  <path className="pn-373" d="M21.5 9.5 17 4l-2 5.5Z" fill="#f3e6c4" />
                </g>
                <g transform="translate(4.80 1.80) scale(0.183)">
                  <path className="pn-374" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#fff6dd" />
                </g>
                <g transform="translate(14.80 1.80) scale(0.183)">
                  <path className="pn-375" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#fff6dd" />
                </g>
                <g transform="translate(19.30 7.30) scale(0.183)">
                  <path className="pn-376" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#fff6dd" />
                </g>
                <g transform="translate(0.30 7.30) scale(0.183)">
                  <path className="pn-377" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#fff6dd" />
                </g>
                <g transform="translate(9.80 18.80) scale(0.183)">
                  <path className="pn-378" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#fff6dd" />
                </g>
                <g transform="translate(9.80 7.30) scale(0.183)">
                  <path className="pn-379" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#fff6dd" />
                </g>
                <g transform="translate(6.80 7.30) scale(0.183)">
                  <path className="pn-380" d="M12 0C12.5 7.2 16.8 11.5 24 12C16.8 12.5 12.5 16.8 12 24C11.5 16.8 7.2 12.5 0 12C7.2 11.5 11.5 7.2 12 0Z" fill="#fff6dd" />
                </g>
              </svg>
            </div>
          </div>
          <div className="pn-381" data-stone-label="ultra">
            <h2 className="pn-382">
              {t("common.tierUltra")}
            </h2>
            <p className="pn-383">
              {prices.ultraMonth}{" "}
              <span className="pn-384">
                ·
              </span>
              {" "}{prices.ultraYearly}
            </p>
          </div>
        </div>
      </section>
      <section className="pn-385">
        <div className="pn-386" data-reveal="1">
          <div>
            <div className="pn-387">
              <span className="pn-388">
                1
              </span>
              <span className="pn-389">
                {t("plans.visualize")}
              </span>
              <span className="pn-390" />
            </div>
            <h3 className="pn-391">
              {t("plans.everybodyLovesVisuals")}
            </h3>
            <p className="pn-392">
              {t("plans.getToTheBottom")}
            </p>
            <p className="pn-393">
              <span className="pn-394" />
              {t("plans.ultraOnly")}
            </p>
          </div>
          <div className="pn-395">
            <div className="pn-396">
              <span className="pn-397">
                {t("plans.visualize")}
              </span>
              <span className="pn-398">
                {t("plans.drawingThePassage")}
              </span>
            </div>
            <svg className="pn-399" viewBox="0 0 420 150">
              <g className="pn-400" fill="none" stroke="#d6b26a" strokeWidth="2" strokeLinecap="round" strokeDasharray="320">
                <rect x="12" y="52" width="104" height="48" rx="12" />
                <rect x="158" y="22" width="104" height="48" rx="12" />
                <rect x="158" y="82" width="104" height="48" rx="12" />
                <rect x="304" y="52" width="104" height="48" rx="12" />
                <path d="M116 76h42M158 46h-16v30M158 106h-16V76" />
                <path d="M262 46h26v30h16M262 106h26V76" />
              </g>
              <g className="pn-115 pn-401" fill="#f3e9d2" fontSize="12" fontWeight="600">
                <text x="64" y="81" textAnchor="middle">
                  {t("plans.passage")}
                </text>
                <text x="210" y="51" textAnchor="middle">
                  {t("plans.anchor")}
                </text>
                <text x="210" y="111" textAnchor="middle">
                  {t("plans.derivation")}
                </text>
                <text x="356" y="81" textAnchor="middle">
                  {t("plans.picture")}
                </text>
              </g>
            </svg>
          </div>
        </div>
        <div className="pn-402">
          <Link className="pn-403" href="/billing/order/ultra">
            {t("plans.buyUltra")}
          </Link>
        </div>
      </section>
      <section className="pn-385">
        <div className="pn-386" data-reveal="1">
          <div>
            <div className="pn-387">
              <span className="pn-388">
                2
              </span>
              <span className="pn-389">
                {t("plans.toolConversations")}
              </span>
              <span className="pn-390" />
            </div>
            <h3 className="pn-391">
              {t("plans.keepAsking")}
            </h3>
            <p className="pn-392">
              {t("plans.explainSimplifyAnalyzeVisualize")}
            </p>
            <p className="pn-393">
              <span className="pn-394" />
              {t("plans.ultraOnly")}
            </p>
          </div>
          <div className="pn-395">
            <div className="pn-404">
              <div className="pn-405">
                <span className="pn-406">
                  {t("plans.simplify2")}
                </span>
                <span className="pn-407">
                  {t("plans.explain")}
                </span>
                <span className="pn-407">
                  {t("plans.analyze")}
                </span>
                <span className="pn-407">
                  {t("plans.visualize2")}
                </span>
              </div>
              <div className="pn-408">
                <span className="pn-409">
                  {t("plans.simplified")}
                </span>
                {t("plans.twiceAsFarMeans")}
              </div>
              <div className="pn-410">
                {t("plans.thenWhatHoldsAt")}
              </div>
              <div className="pn-411">
                {t("plans.theFluxThroughThe")}{" "}
                <span className="pn-412">
                  ¶ 5
                </span>
              </div>
              <div className="pn-413">
                <span className="pn-414" />
                <span className="pn-415" />
                <span className="pn-416" />
              </div>
            </div>
          </div>
        </div>
        <div className="pn-402">
          <Link className="pn-403" href="/billing/order/ultra">
            {t("plans.buyUltra")}
          </Link>
        </div>
      </section>
      <section className="pn-417">
        <div className="pn-418">
          <article className="pn-419">
            <div>
              <div className="pn-387">
                <span className="pn-420">
                  3
                </span>
                <span className="pn-389">
                  {t("plans.worksOffline")}
                </span>
                <span className="pn-390" />
              </div>
              <h3 className="pn-421">
                {t("plans.writeOnAPlane")}
              </h3>
              <p className="pn-422">
                {t("plans.everyEditSavesOn")}
              </p>
            </div>
            <div className="pn-423">
              <div className="pn-424">
                <svg className="pn-425" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d6b26a" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-3-6.7" />
                  <path d="M21 4v5h-5" />
                </svg>
                <span className="pn-426">
                  {t("plans.fourChangesQueued")}
                </span>
                <span className="pn-427">
                  {t("plans.synced")}
                </span>
              </div>
              <div className="pn-428">
                <span className="pn-300">
                  <span className="pn-384">
                    ✓
                  </span>
                  {t("plans.aNoteEditedOn")}
                </span>
                <span className="pn-429">
                  <span className="pn-384">
                    ✓
                  </span>
                  {t("plans.aPassageHighlightedOffline")}
                </span>
                <span className="pn-430">
                  <span className="pn-384">
                    ✓
                  </span>
                  {t("plans.aSectionRenamedWaiting")}
                </span>
                <span className="pn-431">
                  <span className="pn-384">
                    ✓
                  </span>
                  {t("plans.anImageDroppedInto")}
                </span>
              </div>
            </div>
          </article>
          <article className="pn-419">
            <div>
              <div className="pn-387">
                <span className="pn-420">
                  4
                </span>
                <span className="pn-389">
                  {t("plans.runsAndAnnotations")}
                </span>
                <span className="pn-390" />
              </div>
              <h3 className="pn-421">
                {t("plans.twiceTheRunsNo")}
              </h3>
              <p className="pn-422">
                {t("plans.n2TheDistillAnd")}
              </p>
            </div>
            <div className="pn-423">
              <div className="pn-432">
                <div>
                  <div className="pn-433">
                    {t("plans.premium")}
                    <span className="pn-434">
                      {t("plans.distillExtract")}
                    </span>
                  </div>
                  <div className="pn-435">
                    <span className="pn-436" />
                    <span className="pn-436" />
                    <span className="pn-436" />
                    <span className="pn-436" />
                    <span className="pn-436" />
                  </div>
                </div>
                <div>
                  <div className="pn-437">
                    {t("plans.ultra")}
                    <span className="pn-438">
                      {t("plans.n2TheRuns")}
                    </span>
                  </div>
                  <div className="pn-435">
                    <span className="pn-439" />
                    <span className="pn-440" />
                    <span className="pn-441" />
                    <span className="pn-442" />
                    <span className="pn-443" />
                    <span className="pn-444" />
                    <span className="pn-445" />
                    <span className="pn-446" />
                    <span className="pn-447" />
                    <span className="pn-448" />
                  </div>
                </div>
                <div className="pn-449">
                  <span className="pn-450">
                    ∞
                  </span>
                  <span className="pn-451">
                    {t("plans.annotationsHighlightsCommentsLinks")}
                  </span>
                </div>
              </div>
            </div>
          </article>
          <article className="pn-419">
            <div>
              <div className="pn-387">
                <span className="pn-420">
                  5
                </span>
                <span className="pn-389">
                  {t("plans.storage")}
                </span>
                <span className="pn-390" />
              </div>
              <h3 className="pn-421">
                {t("plans.fiveTimesTheRoom")}
              </h3>
              <p className="pn-422">
                {t("plans.n5PremiumSSpace")}
              </p>
            </div>
            <div className="pn-423">
              <div className="pn-452">
                <div>
                  <div className="pn-433">
                    {t("plans.premium")}
                    <span className="pn-434">
                      {t("plans.standard")}
                    </span>
                  </div>
                  <div className="pn-453">
                    <span className="pn-454" />
                  </div>
                </div>
                <div>
                  <div className="pn-437">
                    {t("plans.ultra")}
                    <span className="pn-438">
                      {t("plans.n5TheSpace")}
                    </span>
                  </div>
                  <div className="pn-453">
                    <span className="pn-455" />
                  </div>
                </div>
                <div className="pn-456">
                  <span className="pn-457">
                    {t("plans.documents")}
                  </span>
                  <span className="pn-457">
                    {t("plans.images")}
                  </span>
                  <span className="pn-457">
                    {t("plans.video")}
                  </span>
                </div>
              </div>
            </div>
          </article>
        </div>
        <div className="pn-402">
          <Link className="pn-403" href="/billing/order/ultra">
            {t("plans.buyUltra")}
          </Link>
        </div>
      </section>
    </>
  );
}

import { companionsAt, type Companion } from "@/lib/companions";
import { serverT } from "@/lib/i18n/server";

// Companions (SPEC.md §23): the web apps for the steps around dissecting a
// document that Unitos does not do, under Projects on the dashboard. Quiet —
// two groups, before and after, each a row per app. Every one opens in a new
// tab, so the project the reader came back to stays where it was.

function ArrowIcon() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-sand-400 transition-colors group-hover/companion:text-clay"
    >
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

async function CompanionRow({ companion }: { companion: Companion }) {
  const t = await serverT();
  return (
    <li>
      <a
        href={companion.href}
        target="_blank"
        // noreferrer with noopener: the link carries nothing about the reader
        // or the project they came from.
        rel="noopener noreferrer"
        data-track={`companion-${companion.id}`}
        className="group/companion flex items-start gap-2.5 rounded-2xl px-3.5 py-3 transition-colors hover:bg-card"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-sand-800 group-hover/companion:text-clay-800">
              {companion.name}
            </span>
            {/* Paid for, and said so: a sponsored row the reader cannot tell
                from an unpaid one is worth nothing to either of them. */}
            {companion.sponsored && (
              <span className="rounded-full bg-sand-200 px-2 py-0.5 text-[10.5px] font-semibold text-sand-600">
                {t("works.companionSponsored")}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-sand-600">
            {t(companion.lineKey)}
          </span>
        </span>
        <span className="mt-1">
          <ArrowIcon />
        </span>
      </a>
    </li>
  );
}

async function CompanionGroup({ stage }: { stage: "before" | "after" }) {
  const t = await serverT();
  const companions = companionsAt(stage);
  if (companions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="px-3.5 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
        {t(stage === "before" ? "works.companionsBefore" : "works.companionsAfter")}
      </span>
      <ul className="flex flex-col">
        {companions.map((c) => (
          <CompanionRow key={c.id} companion={c} />
        ))}
      </ul>
    </div>
  );
}

export async function Companions() {
  const t = await serverT();
  return (
    <section className="mt-16 border-t border-line pt-10">
      <h2 className="text-[22px]">{t("works.companions")}</h2>
      <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-sand-600">
        {t("works.companionsIntro")}
      </p>
      <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2">
        <CompanionGroup stage="before" />
        <CompanionGroup stage="after" />
      </div>
    </section>
  );
}

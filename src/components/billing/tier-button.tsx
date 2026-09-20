"use client";

import Link from "next/link";
import { useState } from "react";
import { UltraUpgrade } from "@/components/billing/ultra-upgrade";
import { TierChip } from "@/components/tier-mark";
import type { TierState } from "@/lib/tiers";

// The tier button (SPEC.md §24): the tier chip in the dashboard header,
// pressed. A Unitos Ultra account goes to the plans page. A Unitos Premium
// account (on the trial, granted, or expired) opens the upgrade panel:
// what Unitos Ultra adds, and the way to get it. With billing off the chip
// is a chip: there is nothing to open.
export function TierButton({
  state,
  trialEndsAt,
  billing,
}: {
  state: TierState;
  trialEndsAt: string | null;
  billing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chip = <TierChip state={state} trialEndsAt={trialEndsAt} short />;
  if (!billing) return chip;
  if (state === "ultra") {
    return (
      <Link href="/plans" className="flex min-w-0 hover:brightness-110">
        {chip}
      </Link>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 hover:brightness-105">
        {chip}
      </button>
      <UltraUpgrade open={open} onClose={() => setOpen(false)} />
    </>
  );
}

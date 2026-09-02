"use client";

import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// The kind of a notification (SPEC.md §18): a change to Unitos, or a change
// made to the account. Wire values stay "update" | "account"; only the chip
// label translates. The admin page and the dashboard render the same chip.
export const NOTIFICATION_KINDS = ["update", "account"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, TKey> = {
  update: "common.notificationUpdate",
  account: "common.notificationAccount",
};

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export function NotificationKindChip({ kind }: { kind: string }) {
  const t = useT();
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 font-semibold ${
        kind === "account" ? "bg-clay-200 text-clay-800" : "bg-sage-200 text-sage-800"
      }`}
    >
      {isNotificationKind(kind) ? t(NOTIFICATION_KIND_LABEL[kind]) : kind}
    </span>
  );
}

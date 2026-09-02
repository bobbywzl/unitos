"use client";

import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// The kind of a notification (SPEC.md §18): a change to Unitos, a change made
// to the account, or a reply to feedback the account sent. Wire values stay
// "update" | "account" | "feedback"; only the chip label translates. The admin
// pages and the dashboard render the same chip.
export const NOTIFICATION_KINDS = ["update", "account", "feedback"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// The kinds the admin composes on /admin/notifications. "feedback" comes only
// from Reply in the feedback inbox, which fills the recipient itself.
export const COMPOSED_KINDS = ["update", "account"] as const satisfies readonly NotificationKind[];
export type ComposedKind = (typeof COMPOSED_KINDS)[number];

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, TKey> = {
  update: "common.notificationUpdate",
  account: "common.notificationAccount",
  feedback: "common.notificationFeedback",
};

const KIND_CHIP: Record<NotificationKind, string> = {
  update: "bg-sage-200 text-sage-800",
  account: "bg-clay-200 text-clay-800",
  feedback: "bg-sand-200 text-sand-700",
};

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export function NotificationKindChip({ kind }: { kind: string }) {
  const t = useT();
  const known = isNotificationKind(kind) ? kind : null;
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 font-semibold ${known ? KIND_CHIP[known] : KIND_CHIP.feedback}`}
    >
      {known ? t(NOTIFICATION_KIND_LABEL[known]) : kind}
    </span>
  );
}

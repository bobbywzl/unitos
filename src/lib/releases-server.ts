import { db } from "@/lib/db";
import type { Lang } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";
import { RELEASES, releaseKey } from "@/lib/releases";

const DAY_MS = 24 * 3600 * 1000;

// The release notifications (SPEC.md §18, lib/releases.ts): the dashboard
// calls this on every open. For every release whose day ends after the
// account was made, the notification row for the account's language exists (written
// the first time any account in that language opens the dashboard after the
// deploy: kind "update", the title and body from the dictionary), and the
// account is a recipient of it. An account that dismissed it stays dismissed:
// the recipient row is never reset. The local reader, with no account row,
// is told of every release.
export async function ensureReleaseNotifications(userId: string, createdAt: Date, lang: Lang): Promise<void> {
  // A release ships some time on its day: every account made before the
  // end of that day is told, so none made before the deploy is missed.
  const due = RELEASES.filter((r) => new Date(r.date).getTime() + DAY_MS > createdAt.getTime());
  for (const release of due) {
    const key = releaseKey(release, lang);
    const notification = await db.notification.upsert({
      where: { releaseKey: key },
      update: {},
      create: {
        kind: "update",
        title: translate(lang, release.titleKey),
        body: translate(lang, release.bodyKey),
        releaseKey: key,
        // Dated the day it shipped, so the card carries the release's date.
        createdAt: new Date(release.date),
      },
      select: { id: true },
    });
    await db.notificationRecipient.upsert({
      where: { notificationId_userId: { notificationId: notification.id, userId } },
      update: {},
      create: { notificationId: notification.id, userId },
      select: { id: true },
    });
  }
}

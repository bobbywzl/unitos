import { db } from "@/lib/db";
import { LANGS, type Lang } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";
import { RELEASES, releaseKey } from "@/lib/releases";

const DAY_MS = 24 * 3600 * 1000;

// The release notifications (SPEC.md §18, lib/releases.ts): the dashboard
// calls this on every open. For every release whose day ends after the
// account was made, the notification row for the account's language exists (written
// the first time any account in that language opens the dashboard after the
// deploy: kind "update", the title and body from the dictionary), and the
// account is a recipient of it. An account that dismissed it stays dismissed:
// the recipient row is never reset. A release is one notification to the
// reader whatever the language: the dashboard shows the row of the language
// it opens in (releaseKeyFilter), and a release dismissed in one language is
// dismissed in every language the account has a row in. The local reader,
// with no account row, is told of every release.
export async function ensureReleaseNotifications(userId: string, createdAt: Date, lang: Lang): Promise<void> {
  // A release ships some time on its day: every account made before the
  // end of that day is told, so none made before the deploy is missed.
  const due = RELEASES.filter((r) => new Date(r.date).getTime() + DAY_MS > createdAt.getTime());
  if (due.length === 0) return;
  // The account's rows of these releases, in every language.
  const held = await db.notificationRecipient.findMany({
    where: { userId, notification: { releaseKey: { in: due.flatMap((r) => LANGS.map((l) => releaseKey(r, l))) } } },
    select: { id: true, dismissedAt: true, notification: { select: { releaseKey: true } } },
  });
  for (const release of due) {
    const keys = new Set(LANGS.map((l) => releaseKey(release, l)));
    const rows = held.filter((r) => r.notification.releaseKey !== null && keys.has(r.notification.releaseKey));
    const dismissedAt = rows.find((r) => r.dismissedAt)?.dismissedAt ?? null;
    const key = releaseKey(release, lang);
    if (!rows.some((r) => r.notification.releaseKey === key)) {
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
      // Dismissed in another language: this language's row starts dismissed.
      await db.notificationRecipient.upsert({
        where: { notificationId_userId: { notificationId: notification.id, userId } },
        update: {},
        create: { notificationId: notification.id, userId, dismissedAt },
        select: { id: true },
      });
    }
    // Dismissed in one language: dismissed in every language.
    const open = rows.filter((r) => !r.dismissedAt).map((r) => r.id);
    if (dismissedAt && open.length > 0) {
      await db.notificationRecipient.updateMany({ where: { id: { in: open } }, data: { dismissedAt } });
    }
  }
}

/** The dashboard's filter on its notifications: every notification that is
    not a release's, and a release's in the language the dashboard opens in. */
export function releaseKeyFilter(lang: Lang) {
  return { OR: [{ releaseKey: null }, { releaseKey: { endsWith: `:${lang}` } }] };
}

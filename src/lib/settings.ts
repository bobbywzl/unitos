import { db } from "@/lib/db";

// Operator settings (AppSetting): one row per key, set from the admin pages.
// A missing row reads as "". Billing's switch (lib/billing/switch.ts) is the
// first key.

export async function readSetting(key: string): Promise<string> {
  const row = await db.appSetting.findUnique({ where: { key } }).catch(() => null);
  return row?.value ?? "";
}

export async function writeSetting(key: string, value: string): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

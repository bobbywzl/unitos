import { translatorFor, type TKey } from "@/lib/i18n/dictionaries";
import type { Lang } from "@/lib/i18n/config";
import { outboundFetch } from "@/lib/outbound-fetch";

// Outbound email through Resend (https://resend.com): one POST, no SDK.
// EMAIL_FROM must be a sender on a domain verified in Resend, e.g.
// "Unitos <signin@unitosnotebook.com>". With EMAIL_ECHO=1 the message is
// logged instead of sent — the QA harness reads the confirmation link from
// the log.

export async function sendEmail(msg: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  if (process.env.EMAIL_ECHO === "1") {
    console.log(`[email] echo to=${msg.to} subject=${msg.subject}\n${msg.text}`);
    return true;
  }
  const res = await outboundFetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.error("[email] resend send failed:", res.status, await res.text());
    return false;
  }
  return true;
}

// One scaffold for both auth emails: heading, one line, one button, the raw
// link, expiry and ignore notes. Inline styles only — email clients strip the
// rest.
type AuthEmailKeys = { subject: TKey; title: TKey; body: TKey; cta: TKey };

async function sendAuthEmail(
  to: string,
  url: string,
  lang: Lang,
  keys: AuthEmailKeys,
): Promise<boolean> {
  const t = translatorFor(lang);
  const subject = t(keys.subject);
  const text = [
    t(keys.title),
    "",
    t(keys.body),
    url,
    "",
    t("signin.emailExpiry"),
    t("signin.emailIgnore"),
  ].join("\n");
  const html = `<div style="margin:0 auto;max-width:480px;padding:32px 24px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#2b2520">
  <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#2b2520">${t(keys.title)}</p>
  <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4a4238">${t(keys.body)}</p>
  <p style="margin:0 0 20px"><a href="${url}" style="display:inline-block;padding:12px 28px;border-radius:999px;background:#c46a35;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">${t(keys.cta)}</a></p>
  <p style="margin:0 0 20px;font-size:12px;line-height:1.6;color:#8a7f70;word-break:break-all"><a href="${url}" style="color:#c46a35">${url}</a></p>
  <p style="margin:0;font-size:12px;line-height:1.6;color:#8a7f70">${t("signin.emailExpiry")} ${t("signin.emailIgnore")}</p>
</div>`;
  return sendEmail({ to, subject, html, text });
}

export function sendConfirmationEmail(to: string, url: string, lang: Lang): Promise<boolean> {
  return sendAuthEmail(to, url, lang, {
    subject: "signin.emailSubject",
    title: "signin.emailTitle",
    body: "signin.emailBody",
    cta: "signin.emailCta",
  });
}

export function sendResetEmail(to: string, url: string, lang: Lang): Promise<boolean> {
  return sendAuthEmail(to, url, lang, {
    subject: "signin.resetEmailSubject",
    title: "signin.resetEmailTitle",
    body: "signin.resetEmailBody",
    cta: "signin.resetEmailCta",
  });
}

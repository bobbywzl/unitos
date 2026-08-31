import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { serverT } from "@/lib/i18n/server";
import { PRIVACY_SECTIONS } from "@/lib/legal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: `${t("legal.privacyTitle")} — Unitos` };
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="legal.privacyTitle"
      intro="legal.pIntro"
      sections={PRIVACY_SECTIONS}
      otherHref="/terms"
      otherLabel="legal.seeTerms"
    />
  );
}

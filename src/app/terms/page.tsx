import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { serverT } from "@/lib/i18n/server";
import { TERMS_SECTIONS } from "@/lib/legal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: `${t("legal.termsTitle")} — Unitos` };
}

export default function TermsPage() {
  return (
    <LegalPage
      title="legal.termsTitle"
      intro="legal.tIntro"
      sections={TERMS_SECTIONS}
      otherHref="/privacy"
      otherLabel="legal.seePrivacy"
    />
  );
}

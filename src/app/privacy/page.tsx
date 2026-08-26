import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { PRIVACY_SECTIONS } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy — Unitos" };

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

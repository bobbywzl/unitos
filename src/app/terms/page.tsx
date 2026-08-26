import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { TERMS_SECTIONS } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service — Unitos" };

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

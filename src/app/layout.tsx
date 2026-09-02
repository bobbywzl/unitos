import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Caprasimo, Figtree } from "next/font/google";
import "./globals.css";
import { FeedbackButton } from "@/components/feedback-button";
import { LangProvider } from "@/components/lang-provider";
import { TooltipLayer } from "@/components/tooltip";
import { htmlLangOf } from "@/lib/i18n/config";
import { currentLang, serverT } from "@/lib/i18n/server";

// Caprasimo sets every heading; Figtree carries body text and UI.
const caprasimo = Caprasimo({
  variable: "--font-caprasimo",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const figtree = Figtree({
  variable: "--font-figtree",
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: "Unitos",
    description: t("common.appDescription"),
    // Installable to the home screen — the first step toward the iOS app.
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "Unitos", statusBarStyle: "default" },
    icons: { apple: "/icon.png" },
  };
}

// viewportFit cover lets the mobile bottom bar pad into the home-indicator
// area with env(safe-area-inset-bottom).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a1714" },
    { color: "#f5ead8" },
  ],
};

// Applies the stored theme before paint; follows the system while theme is "system".
const themeScript = `(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var t=localStorage.getItem("theme");document.documentElement.classList.toggle("dark",t==="dark"||(t!=="light"&&m.matches));}a();m.addEventListener("change",a);}catch(e){}})();`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await currentLang();
  return (
    <html
      lang={htmlLangOf(lang)}
      suppressHydrationWarning
      className={`${caprasimo.variable} ${figtree.variable} h-full antialiased`}
    >
      <head>
        {/* next/script also runs when a boundary (the 404) client-renders;
            a raw script tag would be skipped there and logs a React error. */}
        <Script id="theme-boot" strategy="beforeInteractive">
          {themeScript}
        </Script>
      </head>
      <body className="min-h-full flex flex-col">
        <LangProvider lang={lang}>
          {children}
          <FeedbackButton />
          <TooltipLayer />
        </LangProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Caprasimo, Figtree } from "next/font/google";
import "./globals.css";
import { FeedbackButton } from "@/components/feedback-button";
import { LangProvider } from "@/components/lang-provider";
import { htmlLangOf } from "@/lib/i18n/config";
import { currentLang } from "@/lib/i18n/server";

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

export const metadata: Metadata = {
  title: "Unitos",
  description: "Notes-centric app for deep reading",
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
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <LangProvider lang={lang}>
          {children}
          <FeedbackButton />
        </LangProvider>
      </body>
    </html>
  );
}

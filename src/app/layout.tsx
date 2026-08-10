import type { Metadata } from "next";
import { Caprasimo, Figtree } from "next/font/google";
import "./globals.css";
import { FeedbackButton } from "@/components/feedback-button";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${caprasimo.variable} ${figtree.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <FeedbackButton />
      </body>
    </html>
  );
}

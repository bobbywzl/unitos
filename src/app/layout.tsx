import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FeedbackButton } from "@/components/feedback-button";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dissect",
  description: "Notes-centric app for deep reading",
};

// Applies the stored theme before paint; follows the system while theme is "system".
const themeScript = `(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var t=localStorage.getItem("theme");document.documentElement.classList.toggle("dark",t==="dark"||(t!=="light"&&m.matches));}a();m.addEventListener("change",a);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LegalBanner, SiteHeader } from "@/components/layout/SiteChrome";
import "./globals.css";

// next/font downloads Geist at build time and serves it from this app, so the
// running demo never calls Google. globals.css maps these onto --font-sans / --font-mono.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Pointer · ADU permit copilot",
  description: "Prototype ADU permit copilot. Not legal advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <LegalBanner />
        <SiteHeader />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}

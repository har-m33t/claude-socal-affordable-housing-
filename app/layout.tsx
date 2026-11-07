import type { Metadata } from "next";
import { LegalBanner, SiteHeader } from "@/components/layout/SiteChrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pointer · ADU permit copilot",
  description: "Prototype ADU permit copilot. Not legal advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <LegalBanner />
        <SiteHeader />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}

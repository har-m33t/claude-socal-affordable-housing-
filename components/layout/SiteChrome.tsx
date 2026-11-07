"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DATA_MODE } from "@/components/pointer/config";

export function LegalBanner() {
  return (
    <div role="note" className="legal-banner">
      <strong className="font-semibold">Prototype. Not legal advice.</strong>{" "}
      Pointer explains forms and flags gaps. It does not file, sign or send anything. Confirm every requirement with your
      city and a licensed professional before you act.
    </div>
  );
}

const NAV = [
  { href: "/", label: "Editor" },
  { href: "/report", label: "Readiness report" },
  { href: "/coverage", label: "Coverage" },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-3">
      <Link href="/" className="flex items-baseline gap-2">
        <span className="font-serif text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Pointer</span>
        <span className="text-sm text-[var(--color-ink-soft)]">ADU permit copilot</span>
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`nav-link ${path === n.href ? "nav-active" : ""}`}>
            {n.label}
          </Link>
        ))}
        {DATA_MODE === "mock" && <span className="mock-tag ml-2">MOCK DATA</span>}
      </nav>
    </header>
  );
}

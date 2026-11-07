"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DATA_MODE } from "@/components/pointer/config";

export function LegalBanner() {
  return (
    <div role="note" className="legal-banner">
      <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="legal-banner-icon" fill="currentColor">
        <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
      </svg>
      <strong className="font-semibold">Prototype. Not legal advice.</strong>{" "}
      Pointer explains forms and flags gaps. It does not file, sign or send anything. Confirm every requirement with your
      city and a licensed professional before you act.
    </div>
  );
}

/** The Pointer mark: the app's own outlined arrow cursor on a dark tile. */
function LogoMark() {
  return (
    <svg aria-hidden width="28" height="28" viewBox="0 0 28 28" className="shrink-0">
      <rect width="28" height="28" rx="7" fill="var(--fg)" />
      <path
        d="M9.5 6.5v13.2l3.5-3.2 2.3 5a.6.6 0 0 0 .8.3l1.5-.7a.6.6 0 0 0 .3-.8l-2.2-4.9 4.8-.2Z"
        fill="var(--bg)"
        stroke="var(--bg)"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 16px Octicons-style glyphs for the underline nav.
const ICONS: Record<string, React.ReactNode> = {
  "/": (
    <path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25H9.5v-9Zm9.25 9h3.25a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H11Z" />
  ),
  "/report": (
    <path d="M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13.274 9.537v-.001l-4.557 4.45a.75.75 0 0 1-1.055-.008l-1.943-1.95a.75.75 0 0 1 1.062-1.058l1.419 1.425 4.026-3.932a.75.75 0 1 1 1.048 1.074ZM4.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM4 7.75A.75.75 0 0 1 4.75 7h2a.75.75 0 0 1 0 1.5h-2A.75.75 0 0 1 4 7.75Z" />
  ),
  "/coverage": (
    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM5.78 8.75a9.64 9.64 0 0 0 1.363 4.177c.255.426.542.832.857 1.215.245-.296.551-.705.857-1.215A9.64 9.64 0 0 0 10.22 8.75Zm4.44-1.5a9.64 9.64 0 0 0-1.363-4.177c-.307-.51-.612-.919-.857-1.215a9.927 9.927 0 0 0-.857 1.215A9.64 9.64 0 0 0 5.78 7.25Zm-5.944 1.5H1.543a6.507 6.507 0 0 0 4.666 5.5c-.123-.181-.24-.365-.352-.552-.715-1.192-1.437-2.874-1.581-4.948Zm-2.733-1.5h2.733c.144-2.074.866-3.756 1.58-4.948.12-.197.237-.381.353-.552a6.507 6.507 0 0 0-4.666 5.5Zm10.181 1.5c-.144 2.074-.866 3.756-1.58 4.948-.12.197-.237.381-.353.552a6.507 6.507 0 0 0 4.666-5.5Zm2.733-1.5a6.507 6.507 0 0 0-4.666-5.5c.123.181.24.365.353.552.714 1.192 1.436 2.874 1.58 4.948Z" />
  ),
};

const NAV = [
  { href: "/", label: "Editor" },
  { href: "/report", label: "Readiness report" },
  { href: "/coverage", label: "Coverage" },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="app-header px-4 md:px-6">
      <div className="flex h-12 items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 rounded-md text-[var(--fg)]">
          <LogoMark />
          <span className="text-base font-semibold tracking-tight">Pointer</span>
          <span aria-hidden className="text-[var(--fg-subtle)]">/</span>
          <span className="text-sm text-[var(--fg-muted)]">ADU permit copilot</span>
        </Link>
        {DATA_MODE !== "live" && <span className="mock-tag">SCRIPTED RUN</span>}
      </div>
      <nav aria-label="Main" className="-mx-2 flex items-center overflow-x-auto">
        {NAV.map((n) => {
          const active = path === n.href;
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={`nav-link ${active ? "nav-active" : ""}`}>
              <span className="nav-link-inner">
                <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  {ICONS[n.href]}
                </svg>
                {n.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

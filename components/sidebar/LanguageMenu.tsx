"use client";
// The reply-language menu in the Ask tab header: a GitHub-style dropdown. Lists only
// the languages this device can translate on-device; a language whose model isn't
// downloaded yet says so, and choosing it starts the (browser's) one-time download.
import { useEffect, useRef, useState } from "react";
import type { LangCode, Language } from "@/lib/i18n/languages";
import type { LanguageOption } from "@/lib/i18n/translator";
import { CheckIcon, ChevronIcon, DownloadIcon, GlobeIcon } from "./icons";
import type { LanguageDownload } from "./use-language";

interface Props {
  language: Language;
  options: LanguageOption[];
  download: LanguageDownload | null;
  onChoose: (code: LangCode) => void;
}

export function LanguageMenu({ language, options, download, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);

  // Opening focuses the chosen language; clicking outside closes.
  useEffect(() => {
    if (!open) return;
    (wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? items.current[0])?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = items.current.filter(Boolean) as HTMLButtonElement[];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      els[(to + els.length) % els.length]?.focus();
    };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(els.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") setOpen(false);
  };

  const pct = download ? Math.round(download.progress * 100) : 0;

  return (
    <div className="sb-lang" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="sb-lang-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Reply language: ${language.english}`}
        onClick={() => setOpen((v) => !v)}
      >
        <GlobeIcon size={14} />
        <span lang={language.code}>{language.native}</span>
        {download && (
          <span className="sb-lang-pct sb-tabular" aria-hidden>
            {pct}%
          </span>
        )}
        <ChevronIcon dir="down" size={12} />
      </button>
      {open && (
        <div className="sb-menu anim-pop" role="menu" aria-label="Reply language" onKeyDown={onMenuKey}>
          <p className="sb-menu-head">Reply language</p>
          {options.map((o, i) => {
            const l = o.language;
            const checked = l.code === language.code;
            const busy = download?.code === l.code;
            return (
              <button
                key={l.code}
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                className="sb-menu-item"
                tabIndex={-1}
                onClick={() => {
                  onChoose(l.code);
                  close();
                }}
              >
                <span className="sb-menu-check">{checked && <CheckIcon size={12} />}</span>
                <span className="sb-menu-label">
                  <span lang={l.code}>{l.native}</span>
                  {l.native !== l.english && <span className="sb-muted"> {l.english}</span>}
                </span>
                {busy ? (
                  <span className="sb-menu-status sb-tabular">{pct}%</span>
                ) : (
                  o.status !== "available" && (
                    <span className="sb-menu-status" title="The browser downloads this language once and keeps it on this device">
                      <DownloadIcon size={12} />
                    </span>
                  )
                )}
              </button>
            );
          })}
          <p className="sb-menu-foot">
            Translated on this device, never sent anywhere. The English is the official text.
            {options.length === 1 && " This browser has no on-device translator, so Pointer replies in English."}
          </p>
        </div>
      )}
    </div>
  );
}

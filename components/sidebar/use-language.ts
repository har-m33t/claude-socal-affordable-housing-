"use client";
// The reply language: which languages this device can translate on-device, the one
// the homeowner chose, and the one-time model download when they choose a new one.
import { useCallback, useEffect, useState } from "react";
import { ENGLISH, languageByCode, type LangCode, type Language } from "@/lib/i18n/languages";
import { OnDeviceTranslation, type LanguageOption } from "@/lib/i18n/translator";

export interface LanguageDownload {
  code: LangCode;
  /** 0..1 */
  progress: number;
}

export function useLanguage() {
  const [service] = useState(() => new OnDeviceTranslation());
  const [options, setOptions] = useState<LanguageOption[]>([{ language: ENGLISH, status: "available" }]);
  const [code, setCode] = useState<LangCode>("en");
  const [download, setDownload] = useState<LanguageDownload | null>(null);
  const [error, setError] = useState<string>();
  /** The chosen language, while its question model (it → English) still needs one more click. */
  const [pending, setPending] = useState<LangCode | null>(null);

  useEffect(() => {
    let live = true;
    service.languages().then((o) => live && setOptions(o), () => {});
    return () => {
      live = false;
    };
  }, [service]);

  /** Call from the click: the browser only starts a model download on a user gesture. */
  const choose = useCallback(
    (next: LangCode) => {
      setError(undefined);
      setPending(null);
      if (next === "en" || service.ready(next)) {
        setDownload(null);
        setCode(next);
        return;
      }
      setDownload({ code: next, progress: 0 });
      service
        .prepare(next, (progress) => setDownload((d) => (d?.code === next ? { code: next, progress } : d)))
        .then((complete) => {
          setDownload((d) => (d?.code === next ? null : d));
          // Replies can be translated now; questions in the language need the other model.
          setCode(next);
          if (complete) setOptions((os) => os.map((o) => (o.language.code === next ? { ...o, status: "available" } : o)));
          else setPending(next);
        })
        .catch(() => {
          setDownload((d) => (d?.code === next ? null : d));
          setError(`Couldn't get ${languageByCode(next)?.english ?? next} ready on this device. Replies stay in ${languageByCode(code)?.english}.`);
        });
    },
    [service, code],
  );

  return {
    language: languageByCode(code) ?? ENGLISH,
    options,
    choose,
    download,
    error,
    pending: pending ? languageByCode(pending) : undefined,
    translation: service,
  };
}

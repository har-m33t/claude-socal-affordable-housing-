// The one place the "this city is not verified" message is written.
//
// It is deliberately NOT an error. A permit tech who lands on it should come away
// knowing three things: Pointer will not advise on this city, the city still has
// real requirements that Pointer simply has not read, and what has to happen for
// that to change. Every word of it comes from `getCityStatus()`, so it can never
// claim a city is further along than the config says.
//
// Server-safe (no hooks, no state), so the editor lane can drop it straight into
// its `!city.verified` branch:
//
//   import { UnverifiedCityNotice } from "@/components/coverage/UnverifiedCityNotice";
//   if (!city?.verified) return <UnverifiedCityNotice city={cityName} />;
import { getCityStatus, type CityStatusReport } from "@/components/pointer/config";
import { isSafeUrl } from "@/components/pointer/contract";

const STATUS_NOTE: Record<CityStatusReport["status"], string> = {
  live: "Live",
  checklist_found: "Checklist found, not yet read",
  not_checked: "Not yet checked",
};

export function UnverifiedCityNotice({
  city,
  compact = false,
  className = "",
}: {
  /** City name. An unknown name is handled too: it gets the same honest answer. */
  city: string;
  /** Drops the heading and outer card, for use inside a row that already has one. */
  compact?: boolean;
  className?: string;
}) {
  const s = getCityStatus(city);

  // A verified city has nothing to explain. Rendering the notice anyway would be
  // a lie in the other direction, so say so plainly and let the caller fix it.
  if (s.verified) {
    return (
      <p className={`text-sm text-[var(--color-ink-soft)] ${className}`}>
        {s.city} is verified. {s.explanation[0]}
      </p>
    );
  }

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`pill cov-${s.status}`}>{STATUS_NOTE[s.status]}</span>
        <span className="pill pill-unknown">No advice for this city</span>
      </div>

      {s.explanation.map((para) => (
        <p key={para.slice(0, 32)} className="mt-3 max-w-prose text-sm leading-relaxed">
          {para}
        </p>
      ))}

      <h3 className="mt-5 font-serif text-base">What is missing</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {s.gaps.map((g) => (
          <li key={g.field} className="rounded border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2">
            <span className="font-medium">{g.label}</span>
            <span className="mt-0.5 block text-[var(--color-ink-soft)]">
              <span className="text-[var(--color-missing)]">Now:</span> {g.found}
            </span>
            <span className="block text-[var(--color-ink-soft)]">
              <span className="text-[var(--color-complete)]">Needs:</span> {g.needed}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 font-serif text-base">What would make {s.city} live</h3>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
        {s.nextSteps.map((step) => (
          <li key={step.slice(0, 32)}>{step}</li>
        ))}
      </ol>

      {s.sources.length > 0 && (
        <>
          <h3 className="mt-5 font-serif text-base">Sources recorded so far</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {s.sources.map((src) => (
              <li key={src.url}>
                {isSafeUrl(src.url) ? (
                  <a
                    className="text-[var(--color-terracotta)] underline underline-offset-2"
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {src.title} ↗
                  </a>
                ) : (
                  src.title
                )}
                {src.checked_date ? (
                  <span className="text-[var(--color-ink-soft)]"> · read {src.checked_date}</span>
                ) : (
                  <span className="text-[var(--color-ink-soft)]"> · not yet read</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
            Links to the city&apos;s own pages. Pointer has not read them, so nothing on this screen is drawn from them.
          </p>
        </>
      )}

      {!s.known && (
        <p className="mt-4 text-sm text-[var(--color-missing)]">
          There is no config file for &ldquo;{s.city}&rdquo; at all. If that is a real Orange County city, it is missing from
          the data set — which is itself a bug worth reporting.
        </p>
      )}
    </>
  );

  if (compact) return <div className={className}>{body}</div>;

  return (
    <section
      aria-labelledby="unverified-city-heading"
      className={`mx-auto w-full max-w-2xl rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)] p-5 ${className}`}
    >
      <h2 id="unverified-city-heading" className="font-serif text-2xl">
        {s.headline}
      </h2>
      {body}
    </section>
  );
}

export default UnverifiedCityNotice;

// Octicon-style 16px line icons, drawn for the side rail. All decorative (aria-hidden);
// the button that holds one carries the accessible name.
import type { StepKind } from "@/components/pointer/plan";

type P = { size?: number; className?: string };

function Svg({ size = 16, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
  </Svg>
);
export const PauseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2" />
  </Svg>
);
export const StepIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 3.5v9l6-4.5z" fill="currentColor" />
    <path d="M12.5 3.5v9" strokeWidth="1.75" />
  </Svg>
);
export const StopIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
  </Svg>
);
export const RestartIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 8a5 5 0 1 0 1.6-3.7" />
    <path d="M3 2.5v2.5h2.5" />
  </Svg>
);
export const ChecklistIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 4l1.25 1.25L6 3M2.5 9.5l1.25 1.25L6 8.5" />
    <path d="M8.5 4.25h5M8.5 9.75h5" />
  </Svg>
);
/** The Ask tab: a speech bubble with a spark. */
export const AskIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 3.75c0-.7.55-1.25 1.25-1.25h8.5c.7 0 1.25.55 1.25 1.25v5.5c0 .7-.55 1.25-1.25 1.25H7l-3 2.5v-2.5h-.25c-.7 0-1.25-.55-1.25-1.25z" />
    <path d="M8 4.5v3M6.5 6h3" />
  </Svg>
);
export const SparkleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.5c.4 3.1 1.9 4.6 5 5-3.1.4-4.6 1.9-5 5-.4-3.1-1.9-4.6-5-5 3.1-.4 4.6-1.9 5-5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const ChevronIcon = ({ dir = "right", ...p }: P & { dir?: "right" | "left" | "down" | "up" }) => (
  <Svg {...p}>
    <path
      d={{ right: "M6 3.5L10.5 8 6 12.5", left: "M10 3.5L5.5 8 10 12.5", down: "M3.5 6L8 10.5 12.5 6", up: "M3.5 10L8 5.5 12.5 10" }[dir]}
    />
  </Svg>
);
export const SidebarExpandIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.75" />
    <path d="M10 2.5v11M5 6.25L6.75 8 5 9.75" />
  </Svg>
);
export const SidebarCollapseIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.75" />
    <path d="M10 2.5v11M6.75 6.25L5 8l1.75 1.75" />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 8.5l3 3 7-7" strokeWidth="1.75" />
  </Svg>
);
export const XIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.75" />
  </Svg>
);
export const ArrowUpIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 13V3.5M3.75 7.5L8 3.25l4.25 4.25" strokeWidth="1.75" />
  </Svg>
);
export const ReturnIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 4L2.5 7.5 6 11" />
    <path d="M2.75 7.5H10a3.5 3.5 0 0 1 3.5 3.5v1" />
  </Svg>
);
export const SpeakerIcon = ({ muted, ...p }: P & { muted?: boolean }) => (
  <Svg {...p}>
    <path d="M2.5 6v4h2.5l3.5 3V3L5 6z" fill="currentColor" strokeWidth="1" />
    {muted ? <path d="M11 6l3 4M14 6l-3 4" /> : <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.75 3.75a6 6 0 0 1 0 8.5" />}
  </Svg>
);
export const MicIcon = (p: P) => (
  <Svg {...p}>
    <rect x="5.75" y="1.75" width="4.5" height="7.5" rx="2.25" />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25" />
  </Svg>
);
/** Language menu: a globe. */
export const GlobeIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c1.6 1.7 2.4 3.7 2.4 6S9.6 12.3 8 14C6.4 12.3 5.6 10.3 5.6 8S6.4 3.7 8 2z" />
  </Svg>
);
export const DownloadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.5v7.5M5 7l3 3 3-3M3 12.5h10" />
  </Svg>
);
export const ExternalIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 2.5h4v4M13.5 2.5L8 8M11.5 9.5v3c0 .55-.45 1-1 1h-7c-.55 0-1-.45-1-1v-7c0-.55.45-1 1-1h3" />
  </Svg>
);
export const PulseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 8h3l1.5-4 3 8 1.5-4h4" />
  </Svg>
);
export const QuoteIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 4.5h10M3 8h10M3 11.5h6" />
  </Svg>
);

const KIND_PATHS: Record<StepKind, React.ReactNode> = {
  organize: <path d="M2 4.5c0-.55.45-1 1-1h3l1.5 1.5H13c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1z" />,
  read: (
    <>
      <path d="M1.75 3.5h4c1.25 0 2.25 1 2.25 2.25v7.25c0-.85-.7-1.5-1.5-1.5h-4.75z" />
      <path d="M14.25 3.5h-4C9 3.5 8 4.5 8 5.75v7.25c0-.85.7-1.5 1.5-1.5h4.75z" />
    </>
  ),
  law: (
    <>
      <path d="M8 2v11.5M4.5 13.5h7M3 4.5h10" />
      <path d="M3 4.5L1.5 8.5a1.6 1.6 0 0 0 3 0zM13 4.5l-1.5 4a1.6 1.6 0 0 0 3 0z" />
    </>
  ),
  form: (
    <>
      <rect x="3" y="1.75" width="10" height="12.5" rx="1.25" />
      <path d="M5.5 5h5M5.5 8h5M5.5 11h3" />
    </>
  ),
  gather: (
    <>
      <path d="M2 5.5h12v7.25c0 .4-.35.75-.75.75H2.75a.75.75 0 0 1-.75-.75z" />
      <path d="M1.5 2.5h13v3h-13zM6.5 8.5h3" />
    </>
  ),
  final: (
    <>
      <path d="M3.5 14V2.5M3.5 3h8.5l-2 2.75 2 2.75H3.5" />
    </>
  ),
};

export function StepKindIcon({ kind, ...p }: P & { kind: StepKind }) {
  return <Svg {...p}>{KIND_PATHS[kind] ?? KIND_PATHS.read}</Svg>;
}

/** A progress ring around an icon, for the collapsed rail. */
export function ProgressRing({ value, size = 32, children }: { value: number; size?: number; children?: React.ReactNode }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="sb-ring" style={{ width: size, height: size }}>
      <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="sb-ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="sb-ring-value"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="sb-ring-icon">{children}</span>
    </span>
  );
}

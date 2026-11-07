"use client";
// The slim side rail: two tabs, Plan (the plan pointer, terse) and Ask (the answer
// pointer and a chat). Collapses to a 56px icon rail with a progress ring. The
// sidebar owns the answer session and reports the answer pointer up to the editor.
// Props are frozen in components/pointer/ui-contract.ts.
import "./sidebar.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { stepLabel } from "@/components/pointer/plan";
import type { SidebarProps } from "@/components/pointer/ui-contract";
import { AskTab } from "./AskTab";
import { IconButton } from "./IconButton";
import {
  AskIcon,
  ChecklistIcon,
  PauseIcon,
  PlayIcon,
  ProgressRing,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  SparkleIcon,
} from "./icons";
import { PlanTab } from "./PlanTab";
import { planView, stepQuestion, suggestedQuestions } from "./plan-view";
import { useAnswerSession } from "./use-answer-session";

type Tab = "plan" | "ask";
const TABS: Tab[] = ["plan", "ask"];
const TAB_NAME: Record<Tab, string> = { plan: "Plan", ask: "Ask" };

export function Sidebar(props: SidebarProps) {
  const { plan, items, log, stepIndex, planTargetId, play, controls } = props;
  const [expanded, setExpanded] = useState(true);
  const [tab, setTab] = useState<Tab>("plan");
  const [draft, setDraft] = useState("");
  /** Where focus goes after the next render: set by tab switches that should move focus. */
  const focusNext = useRef<"plan" | "ask-input" | Tab | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const planPanelRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ plan: null, ask: null });

  const view = useMemo(() => planView(plan, items, stepIndex, planTargetId), [plan, items, stepIndex, planTargetId]);

  const switchTo = useCallback((t: Tab, focus: typeof focusNext.current = null) => {
    setExpanded(true);
    setTab(t);
    focusNext.current = focus;
  }, []);

  const session = useAnswerSession({
    provider: props.provider,
    plan,
    city: props.city,
    projectType: props.projectType,
    planTargetId,
    onAnswerPointer: props.onAnswerPointer,
    backToStepSignal: props.backToStepSignal,
    onDismissed: () => switchTo("plan", "plan"),
  });

  // A reply the homeowner hasn't looked at yet: the Ask icon sparkles until they open Ask.
  const replies = session.state.turns.filter((t) => t.role === "pointer").length;
  const [seenReplies, setSeenReplies] = useState(0);
  const askVisible = expanded && tab === "ask";
  useEffect(() => {
    if (askVisible) setSeenReplies(replies);
  }, [askVisible, replies]);
  const unseen = replies > seenReplies;

  useEffect(() => {
    const f = focusNext.current;
    if (!f) return;
    const el = f === "ask-input" ? inputRef.current : f === "plan" ? planPanelRef.current : tabRefs.current[f];
    // The switch may not have rendered yet (e.g. requested from another effect): retry next render.
    if (!el || el.closest("[hidden]")) return;
    focusNext.current = null;
    el.focus();
  });

  // Sliding underline: measured from the active tab.
  const tabsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    const wrap = tabsRef.current;
    if (!el || !wrap) return;
    wrap.style.setProperty("--indicator-x", `${el.offsetLeft + 8}px`);
    wrap.style.setProperty("--indicator-w", `${el.offsetWidth - 16}px`);
  }, [tab, expanded]);

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next =
      e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length]
      : e.key === "ArrowLeft" ? TABS[(i - 1 + TABS.length) % TABS.length]
      : e.key === "Home" ? TABS[0]
      : e.key === "End" ? TABS[TABS.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    switchTo(next, next);
  };

  const askAboutStep = () => {
    if (view.current) setDraft(stepQuestion(plan, view.current, planTargetId));
    switchTo("ask", "ask-input");
  };

  const playing = play === "playing";
  const progressLabel = view.started ? stepLabel(plan, view.currentIndex) : `${plan.steps.length} steps`;

  if (!expanded) {
    return (
      <aside className="sb sb-collapsed" aria-label="Pointer side rail">
        <IconButton label="Expand side rail" onClick={() => setExpanded(true)} tipSide="left">
          <SidebarExpandIcon />
        </IconButton>
        <span className="sb-rail-sep" />
        <button
          type="button"
          className={`sb-rail-tab ${tab === "plan" ? "sb-rail-tab-active" : ""}`}
          aria-label={`Plan — ${progressLabel}`}
          data-tip={`Plan · ${progressLabel}`}
          data-tip-side="left"
          onClick={() => switchTo("plan", "plan")}
        >
          <ProgressRing value={view.progress}>
            <ChecklistIcon size={14} />
          </ProgressRing>
          <span className="sb-rail-count">
            {view.started ? `${view.currentIndex + 1}/${plan.steps.length}` : `0/${plan.steps.length}`}
          </span>
        </button>
        <button
          type="button"
          className={`sb-rail-tab sb-rail-tab-ask ${tab === "ask" ? "sb-rail-tab-active" : ""}`}
          aria-label={unseen ? "Ask — new answer" : "Ask"}
          data-tip={unseen ? "Ask · new answer" : "Ask"}
          data-tip-side="left"
          onClick={() => switchTo("ask", "ask-input")}
        >
          <span className="sb-rail-ask">
            <AskIcon />
            {unseen && <SparkleIcon size={10} className="sb-rail-spark anim-sparkle" />}
          </span>
        </button>
        <span className="sb-rail-fill" />
        <IconButton
          label={playing ? "Pause" : "Play"}
          onClick={playing ? controls.pause : controls.start}
          disabled={play === "done" || play === "stopped"}
          primary
          tipSide="left"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
      </aside>
    );
  }

  return (
    <aside className="sb sb-expanded anim-slide-in-right" aria-label="Pointer side rail">
      <div className="sb-head">
        <div
          ref={tabsRef}
          className={`underline-tabs sb-tabs sb-tabs-${tab}`}
          role="tablist"
          aria-label="Side rail"
          onKeyDown={onTabKey}
        >
          {TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={`sb-tab-${t}`}
              aria-controls={`sb-panel-${t}`}
              aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1}
              data-active={tab === t}
              className={`underline-tab sb-tab sb-tab-${t}`}
              onClick={() => switchTo(t)}
            >
              {t === "plan" ? <ChecklistIcon size={14} /> : <AskIcon size={14} />}
              {TAB_NAME[t]}
              {t === "plan" && view.started && (
                <span className="sb-count sb-tabular">
                  {view.currentIndex + 1}/{plan.steps.length}
                </span>
              )}
              {t === "ask" && unseen && <SparkleIcon key={replies} size={10} className="sb-answer-ink anim-sparkle" />}
            </button>
          ))}
          <span className="underline-tabs-indicator" aria-hidden />
        </div>
        <IconButton label="Collapse side rail" onClick={() => setExpanded(false)} tipSide="left">
          <SidebarCollapseIcon />
        </IconButton>
      </div>

      <div
        ref={planPanelRef}
        id="sb-panel-plan"
        role="tabpanel"
        aria-labelledby="sb-tab-plan"
        tabIndex={-1}
        hidden={tab !== "plan"}
        className="sb-panel"
      >
        <PlanTab
          plan={plan}
          view={view}
          log={log}
          play={play}
          controls={controls}
          onDecide={props.onDecide}
          onSelectTarget={props.onSelectTarget}
          onAskAboutStep={askAboutStep}
        />
      </div>
      <div
        id="sb-panel-ask"
        role="tabpanel"
        aria-labelledby="sb-tab-ask"
        hidden={tab !== "ask"}
        className="sb-panel sb-panel-ask"
      >
        <AskTab
          turns={session.state.turns}
          phase={session.state.phase}
          latestReplyId={session.state.latestReplyId}
          voice={session.state.voice}
          voiceSupported={session.voiceSupported}
          onVoice={session.setVoice}
          draft={draft}
          onDraft={setDraft}
          onAsk={session.ask}
          suggestions={suggestedQuestions(plan, view.current, planTargetId)}
          onBackToStep={props.onBackToStep}
          inputRef={inputRef}
        />
      </div>
    </aside>
  );
}

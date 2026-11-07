"use client";
// The Ask tab: a small chat. Explanations happen here, and only when asked.
// Each reply quotes the document and cites it; "Back to my step" returns to the plan.
import { useEffect, useRef, type RefObject } from "react";
import type { AnswerPhase, AnswerSource, ChatTurn } from "@/components/pointer/answer";
import { isSafeUrl } from "@/components/pointer/contract";
import { ArrowUpIcon, ExternalIcon, ReturnIcon, SparkleIcon, SpeakerIcon } from "./icons";
import { IconButton } from "./IconButton";

interface Props {
  turns: ChatTurn[];
  phase: AnswerPhase;
  latestReplyId?: string;
  voice: boolean;
  voiceSupported: boolean;
  onVoice: (on: boolean) => void;
  draft: string;
  onDraft: (s: string) => void;
  onAsk: (q: string) => void;
  suggestions: string[];
  onBackToStep: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function AskTab(p: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const thinking = p.phase === "thinking";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [p.turns.length, thinking]);

  const submit = (q: string) => {
    if (!q.trim() || thinking) return;
    p.onAsk(q);
    p.onDraft("");
  };

  return (
    <div className="sb-ask">
      <div className="sb-ask-head">
        <p className="sb-ask-title">Ask about these documents</p>
        {p.voiceSupported && (
          <IconButton
            label={p.voice ? "Voice on — turn off" : "Read answers aloud"}
            pressed={p.voice}
            onClick={() => p.onVoice(!p.voice)}
            tipSide="left"
            className={p.voice ? "sb-voice-on" : ""}
          >
            <SpeakerIcon muted={!p.voice} />
          </IconButton>
        )}
      </div>

      <div className="sb-chat" role="log" aria-live="polite" aria-relevant="additions" aria-label="Answers">
        {p.turns.length === 0 && !thinking && (
          <div className="sb-chat-empty anim-fade-up">
            <SparkleIcon size={16} className="sb-answer-ink" />
            <p>Pointer answers from the documents on screen, and shows you where.</p>
          </div>
        )}
        {p.turns.map((t) =>
          t.role === "user" ? (
            <p key={t.id} className="sb-msg-user anim-fade-up">
              {t.text}
            </p>
          ) : (
            <Reply
              key={t.id}
              turn={t}
              latest={t.id === p.latestReplyId}
              speaking={t.id === p.latestReplyId && p.phase === "answering" && p.voice}
              onBackToStep={p.onBackToStep}
            />
          ),
        )}
        {thinking && (
          <div className="sb-msg-pointer sb-thinking anim-fade-up" aria-label="Pointer is looking">
            <p className="sb-thinking-label">
              <SparkleIcon size={12} className="sb-answer-ink anim-sparkle" />
              <span className="anim-shimmer-text">Looking in the documents…</span>
            </p>
            <span className="sb-skeleton anim-shimmer" />
            <span className="sb-skeleton sb-skeleton-short anim-shimmer" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {p.suggestions.length > 0 && (
        <div className="sb-chips" aria-label="Suggested questions">
          {p.suggestions.map((q) => (
            <button key={q} type="button" className="sb-chip" disabled={thinking} onClick={() => submit(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        className={`sb-input ${thinking ? "gemini-border sb-input-thinking" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit(p.draft);
        }}
      >
        <label htmlFor="sb-question" className="sb-sr">
          Your question
        </label>
        <textarea
          id="sb-question"
          ref={p.inputRef}
          rows={1}
          value={p.draft}
          placeholder="Ask about a line or a step…"
          maxLength={500}
          onChange={(e) => p.onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(p.draft);
            }
          }}
        />
        <button type="submit" className="sb-ask-go" aria-label="Ask" disabled={!p.draft.trim() || thinking}>
          <ArrowUpIcon size={14} />
        </button>
      </form>
    </div>
  );
}

function Reply({
  turn,
  latest,
  speaking,
  onBackToStep,
}: {
  turn: ChatTurn;
  latest: boolean;
  speaking: boolean;
  onBackToStep: () => void;
}) {
  const r = turn.result;
  const [head, ...rest] = turn.text.split("\n");
  return (
    <div className={`sb-msg-pointer anim-fade-up ${r?.kind === "not_found" ? "sb-msg-unknown" : ""}`}>
      <p className="sb-msg-text">
        {speaking && (
          <span className="sb-speaking" aria-label="Speaking">
            <i />
            <i />
            <i />
          </span>
        )}
        {head}
      </p>
      {r?.kind === "found" && r.quote && <blockquote className="sb-quote">{r.quote}</blockquote>}
      {rest.length > 0 && <p className="sb-msg-note">{rest.join(" ")}</p>}
      {r && r.sources.length > 0 && (
        <div className="sb-sources">
          {r.sources.map((s) => (
            <SourceChip key={s.url} s={s} />
          ))}
        </div>
      )}
      {latest && r && (
        <button type="button" className="sb-back" onClick={onBackToStep}>
          <ReturnIcon size={12} />
          Back to my step
        </button>
      )}
    </div>
  );
}

function SourceChip({ s }: { s: AnswerSource }) {
  const label = (
    <>
      <span className="truncate">{s.title}</span>
      {s.checked_date && <span className="sb-muted shrink-0">· checked {s.checked_date}</span>}
    </>
  );
  if (!isSafeUrl(s.url)) {
    return (
      <span className="sb-source sb-source-blocked" title="Link blocked: not an http(s) URL">
        {label}
      </span>
    );
  }
  return (
    <a className="sb-source" href={s.url} target="_blank" rel="noopener noreferrer" title={`Open source: ${s.url}`}>
      {label}
      <ExternalIcon size={12} className="shrink-0" />
    </a>
  );
}

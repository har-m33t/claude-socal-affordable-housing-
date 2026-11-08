"use client";
// The Ask tab: a small chat. Explanations happen here, and only when asked.
// Each reply quotes the document and cites it; "Back to my step" returns to the plan.
// The homeowner can speak the question (mic) and read or hear replies in their own
// language: an on-device machine translation, with the English one tap away.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { AnswerPhase, AnswerSource } from "@/components/pointer/answer";
import { isSafeUrl } from "@/components/pointer/contract";
import { HCD_HANDBOOK_URL, languageByCode, type LangCode, type Language } from "@/lib/i18n/languages";
import type { LanguageOption } from "@/lib/i18n/translator";
import { CLOUD_NOTICE } from "@/lib/voice/recognition";
import type { SessionTurn } from "./answer-session";
import { ArrowUpIcon, DownloadIcon, ExternalIcon, MicIcon, ReturnIcon, SparkleIcon, SpeakerIcon, StopIcon, XIcon } from "./icons";
import { IconButton } from "./IconButton";
import { LanguageMenu } from "./LanguageMenu";
import type { LanguageDownload } from "./use-language";
import type { useVoiceInput } from "./use-voice-input";

interface Props {
  turns: SessionTurn[];
  phase: AnswerPhase;
  latestReplyId?: string;
  voice: boolean;
  voiceSupported: boolean;
  onVoice: (on: boolean) => void;
  draft: string;
  onDraft: (s: string) => void;
  onAsk: (q: string, known?: LangCode) => void;
  suggestions: string[];
  onBackToStep: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  language: Language;
  languageOptions: LanguageOption[];
  languageDownload: LanguageDownload | null;
  languageError?: string;
  /** Replies can be translated to this language, but questions need one more download (one per click). */
  languagePending?: Language;
  onChooseLanguage: (code: LangCode) => void;
  /** Voice is on but this device has no voice for the reply language. */
  noVoiceFor?: Language;
  mic: ReturnType<typeof useVoiceInput>;
}

export function AskTab(p: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const thinking = p.phase === "thinking";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [p.turns.length, thinking]);

  const submit = (q: string, known?: LangCode) => {
    if (!q.trim() || thinking) return;
    p.onAsk(q, known);
    p.onDraft("");
  };

  const listening = p.mic.state.kind === "listening";

  return (
    <div className="sb-ask">
      <div className="sb-ask-head">
        <p className="sb-ask-title">Ask about these documents</p>
        <div className="sb-ask-tools">
          {p.languageOptions.length > 1 && (
            <LanguageMenu language={p.language} options={p.languageOptions} download={p.languageDownload} onChoose={p.onChooseLanguage} />
          )}
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
      </div>
      {p.languageDownload && (
        <p className="sb-ask-note" role="status">
          <span>
            Downloading {languageByCode(p.languageDownload.code)?.english} for on-device translation… {Math.round(p.languageDownload.progress * 100)}%
          </span>
          <span className="sb-meter" aria-hidden>
            <span style={{ width: `${Math.round(p.languageDownload.progress * 100)}%` }} />
          </span>
        </p>
      )}
      {p.languagePending && (
        <div className="sb-ask-note" role="status">
          <span>
            Replies are in {p.languagePending.native} now. One more download (it stays on this device) lets you ask in {p.languagePending.native} too.
          </span>
          <button type="button" className="sb-btn sb-btn-accept sb-self-start" onClick={() => p.onChooseLanguage(p.languagePending!.code)}>
            <DownloadIcon size={12} />
            Download {p.languagePending.english} → English
          </button>
        </div>
      )}
      {p.languageError && (
        <p className="sb-ask-note sb-ask-note-warn" role="status">
          {p.languageError}
        </p>
      )}
      {p.noVoiceFor && (
        <p className="sb-ask-note" role="status">
          No {p.noVoiceFor.english} voice on this device, so replies aren&apos;t read aloud. They still show in {p.noVoiceFor.native}.
        </p>
      )}

      <div className="sb-chat" role="log" aria-live="polite" aria-relevant="additions" aria-label="Answers">
        {p.turns.length === 0 && !thinking && (
          <div className="sb-chat-empty anim-fade-up">
            <SparkleIcon size={16} className="sb-answer-ink" />
            <p>Pointer answers from the documents on screen, and shows you where.</p>
          </div>
        )}
        {p.turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="sb-msg-user anim-fade-up">
              <p>{t.text}</p>
              {t.asked && (
                <p className="sb-msg-asked" title="Pointer searches the English documents with this">
                  In English: {t.asked.english}
                </p>
              )}
            </div>
          ) : (
            <Reply
              key={t.id}
              turn={t}
              latest={t.id === p.latestReplyId}
              speaking={t.id === p.latestReplyId && p.phase === "answering" && p.voice && !p.noVoiceFor}
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

      {/* Chips are English: they're built from the documents' own words, which retrieval matches. */}
      {p.suggestions.length > 0 && (
        <div className="sb-chips" aria-label="Suggested questions" lang="en">
          {p.suggestions.map((q) => (
            <button key={q} type="button" className="sb-chip" disabled={thinking} onClick={() => submit(q, "en")}>
              {q}
            </button>
          ))}
        </div>
      )}

      <MicPanel mic={p.mic} language={p.language} />

      <form
        className={`sb-input ${thinking ? "gemini-border sb-input-thinking" : ""} ${listening ? "sb-input-listening" : ""}`}
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
          placeholder={listening ? "Listening… (Esc to stop)" : "Ask about a line or a step…"}
          lang={p.language.code}
          maxLength={500}
          onChange={(e) => p.onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(p.draft);
            }
          }}
        />
        {p.mic.supported && (
          <button
            type="button"
            className={`sb-mic ${listening ? "sb-mic-on anim-pulse-ring" : ""}`}
            aria-label={listening ? "Stop listening" : `Speak your question (${p.language.english})`}
            aria-pressed={listening}
            data-tip={listening ? "Stop listening · Esc" : "Speak your question"}
            data-tip-side="left"
            disabled={thinking || p.mic.state.kind === "checking" || p.mic.state.kind === "downloading"}
            onClick={listening ? p.mic.stop : p.mic.press}
          >
            {listening ? <StopIcon size={12} /> : <MicIcon size={14} />}
          </button>
        )}
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
  turn: SessionTurn;
  latest: boolean;
  speaking: boolean;
  onBackToStep: () => void;
}) {
  const r = turn.result;
  const tr = turn.translation;
  const [original, setOriginal] = useState(false);
  const showTr = !!tr && !original;
  const text = showTr ? tr.text : turn.text;
  const quote = showTr ? tr.quote : r?.kind === "found" ? r.quote : undefined;
  const lang = showTr ? tr.lang : "en";
  const [head, ...rest] = text.split("\n");
  const trLang = tr && languageByCode(tr.lang);
  return (
    <div className={`sb-msg-pointer anim-fade-up ${r?.kind === "not_found" ? "sb-msg-unknown" : ""}`}>
      {/* key: the reply fades in again when switching between translation and original */}
      <div key={lang} className="sb-msg-body anim-fade-up" lang={lang}>
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
        {quote && <blockquote className="sb-quote">{quote}</blockquote>}
        {rest.length > 0 && <p className="sb-msg-note">{rest.join(" ")}</p>}
      </div>
      {tr && trLang && (
        <div className="sb-mt">
          <p className="sb-mt-label">Machine translation (on-device) — the English is the official text.</p>
          <div className="sb-mt-actions">
            <button type="button" className="sb-link" aria-pressed={original} onClick={() => setOriginal((v) => !v)}>
              {original ? `Show ${trLang.native}` : "Show original"}
            </button>
            {trLang.handbook && (
              <a className="sb-link" href={HCD_HANDBOOK_URL} target="_blank" rel="noopener noreferrer" lang={trLang.code}>
                HCD ADU Handbook in {trLang.native}
                <ExternalIcon size={10} />
              </a>
            )}
          </div>
        </div>
      )}
      {turn.translationFailed && (
        <p className="sb-msg-note">
          Couldn&apos;t translate this reply to {languageByCode(turn.translationFailed)?.english} on this device, so it&apos;s in English.
        </p>
      )}
      {/* Citation chips stay as published: titles, URLs and dates are never translated. */}
      {r && r.sources.length > 0 && (
        <div className="sb-sources" lang="en">
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

/** The mic's one-time questions and problems: download the on-device model, or consent to cloud recognition. */
function MicPanel({ mic, language }: { mic: Props["mic"]; language: Language }) {
  const s = mic.state;
  if (s.kind === "offer-download" || s.kind === "downloading") {
    return (
      <div className="sb-mic-panel anim-fade-up" role="group" aria-label="Voice input">
        <p>
          To understand {language.english} speech without sending your voice anywhere, the browser needs its voice model for
          this device.
        </p>
        <div className="sb-mic-actions">
          <button type="button" className="sb-btn sb-btn-accept" onClick={mic.downloadModel} disabled={s.kind === "downloading"}>
            <DownloadIcon size={12} />
            {s.kind === "downloading" ? "Downloading…" : "Download voice model (stays on this device)"}
          </button>
          <button type="button" className="sb-btn" onClick={mic.dismiss}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  if (s.kind === "ask-consent") {
    return (
      <div className="sb-mic-panel sb-mic-panel-warn anim-fade-up" role="alertdialog" aria-label="Send audio to the browser's speech service?">
        <p>{CLOUD_NOTICE}</p>
        <div className="sb-mic-actions">
          <button type="button" className="sb-btn" onClick={() => mic.consent(true)}>
            Allow for this visit
          </button>
          <button type="button" className="sb-btn sb-btn-accept" onClick={() => mic.consent(false)}>
            I&apos;ll type instead
          </button>
        </div>
      </div>
    );
  }
  if (s.kind === "error") {
    return (
      <div className="sb-mic-panel anim-fade-up" role="status">
        <p>{s.message}</p>
        <IconButton label="Dismiss" onClick={mic.dismiss} tipSide="left">
          <XIcon size={12} />
        </IconButton>
      </div>
    );
  }
  if (s.kind === "listening" && !s.local) {
    return (
      <p className="sb-ask-note sb-ask-note-warn" role="status">
        Listening through the browser&apos;s speech service (audio leaves this device).
      </p>
    );
  }
  return null;
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

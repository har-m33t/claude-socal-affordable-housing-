// @vitest-environment jsdom
// The Ask tab's translation, voice and mic UI, rendered with stubbed state: no browser
// speech or translation APIs are touched here (those are tested in tests/voice and tests/i18n).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionTurn } from "@/components/sidebar/answer-session";
import { AskTab } from "@/components/sidebar/AskTab";
import type { useVoiceInput } from "@/components/sidebar/use-voice-input";
import { ENGLISH, HCD_HANDBOOK_URL, languageByCode } from "@/lib/i18n/languages";
import { micIdle, type MicState } from "@/lib/voice/recognition";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}; // jsdom has no layout
});
afterEach(cleanup);

const es = languageByCode("es")!;
const mic = (state: MicState = micIdle, supported = true): ReturnType<typeof useVoiceInput> => ({
  supported,
  state,
  press: vi.fn(),
  stop: vi.fn(),
  downloadModel: vi.fn(),
  consent: vi.fn(),
  dismiss: vi.fn(),
});

const turns: SessionTurn[] = [
  { id: "q1", role: "user", text: "¿Qué es el informe del medidor?", asked: { original: "¿Qué es el informe del medidor?", english: "What is the meter report?", from: "es" } },
  {
    id: "q1:reply",
    role: "pointer",
    text: "“Meter spot report” — from Checklist, page 1:",
    result: {
      kind: "found",
      targetId: "meter-spot-report",
      text: "“Meter spot report” — from Checklist, page 1:",
      quote: "Complete this step if you are adding a new electric meter.",
      sources: [{ title: "ADU Submittal Checklist", url: "https://www.anaheim.net/z412.pdf", checked_date: "2026-05-01" }],
    },
    translation: { lang: "es", text: "“Informe de medidor” — de la lista, página 1:", quote: "Complete este paso si agrega un medidor eléctrico nuevo." },
  },
];

function renderAsk(over: Partial<Parameters<typeof AskTab>[0]> = {}) {
  return render(
    <AskTab
      turns={turns}
      phase="answering"
      latestReplyId="q1:reply"
      voice={false}
      voiceSupported
      onVoice={vi.fn()}
      draft=""
      onDraft={vi.fn()}
      onAsk={vi.fn()}
      suggestions={[]}
      onBackToStep={vi.fn()}
      inputRef={createRef()}
      language={es}
      languageOptions={[
        { language: ENGLISH, status: "available" },
        { language: es, status: "available" },
        { language: languageByCode("vi")!, status: "downloadable" },
      ]}
      languageDownload={null}
      onChooseLanguage={vi.fn()}
      mic={mic()}
      {...over}
    />,
  );
}

describe("Ask tab: translated replies", () => {
  it("shows the translation, labelled, with the English one tap away and HCD's handbook linked", () => {
    renderAsk();
    expect(screen.getByText(/Informe de medidor/)).toBeTruthy();
    expect(screen.getByText("Machine translation (on-device) — the English is the official text.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /HCD ADU Handbook in Español/ }).getAttribute("href")).toBe(HCD_HANDBOOK_URL);
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(screen.getByText(/Meter spot report/)).toBeTruthy();
    expect(screen.getByText("Complete this step if you are adding a new electric meter.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Español" })).toBeTruthy();
  });

  it("citation chips keep the source's own title and date", () => {
    renderAsk();
    expect(screen.getByRole("link", { name: /ADU Submittal Checklist/ }).textContent).toContain("checked 2026-05-01");
  });

  it("the user's question shows the English that was searched", () => {
    renderAsk();
    expect(screen.getByText("In English: What is the meter report?")).toBeTruthy();
  });

  it("says so when no voice on this device speaks the language", () => {
    renderAsk({ voice: true, noVoiceFor: languageByCode("vi") });
    expect(screen.getByText(/No Vietnamese voice on this device/)).toBeTruthy();
  });
});

describe("Ask tab: language menu", () => {
  it("lists the offered languages as radio items and chooses one", () => {
    const onChooseLanguage = vi.fn();
    renderAsk({ onChooseLanguage });
    fireEvent.click(screen.getByRole("button", { name: "Reply language: Spanish" }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    fireEvent.click(items[2]);
    expect(onChooseLanguage).toHaveBeenCalledWith("vi");
  });

  it("is hidden when only English is available", () => {
    renderAsk({ languageOptions: [{ language: ENGLISH, status: "available" }], language: ENGLISH });
    expect(screen.queryByRole("button", { name: /Reply language/ })).toBeNull();
  });
});

describe("Ask tab: mic", () => {
  it("is hidden where speech recognition is unsupported", () => {
    renderAsk({ mic: mic(micIdle, false) });
    expect(screen.queryByRole("button", { name: /Speak your question/ })).toBeNull();
  });

  it("offers the on-device model download before listening", () => {
    const m = mic({ kind: "offer-download", lang: "es-US" });
    renderAsk({ mic: m });
    fireEvent.click(screen.getByRole("button", { name: "Download voice model (stays on this device)" }));
    expect(m.downloadModel).toHaveBeenCalled();
  });

  it("asks before using the cloud, with the audio notice", () => {
    const m = mic({ kind: "ask-consent", lang: "es-US" });
    renderAsk({ mic: m });
    expect(screen.getByRole("alertdialog").textContent).toMatch(/cannot redact audio/);
    fireEvent.click(screen.getByRole("button", { name: "I'll type instead" }));
    expect(m.consent).toHaveBeenCalledWith(false);
  });

  it("while listening: a stop button with the pulse ring", () => {
    const m = mic({ kind: "listening", lang: "es-US", local: true });
    renderAsk({ mic: m });
    const b = screen.getByRole("button", { name: "Stop listening" });
    expect(b.className).toContain("anim-pulse-ring");
    fireEvent.click(b);
    expect(m.stop).toHaveBeenCalled();
  });
});

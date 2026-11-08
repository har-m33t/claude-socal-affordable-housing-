// Choosing a speech synthesis voice for a language. A reply is only ever read in a
// voice for its own language: when this device has none (Vietnamese on many Macs),
// pickVoice returns undefined and the UI says so instead of reading Vietnamese text
// in an English voice. Only on-device voices (localService) are used: a network
// voice (e.g. Chrome's "Google ..." voices) would send the reply text off the device.
import type { Language } from "@/lib/i18n/languages";

export interface VoiceLike {
  lang: string;
  name: string;
  localService: boolean;
  default: boolean;
}

const norm = (tag: string) => tag.replace(/_/g, "-").toLowerCase();

/**
 * The best on-device voice for `language`: the earliest locale in its preference list
 * wins (a bare language like "es" matches any region), then the platform default.
 * Locales not on the list never match (so a Cantonese zh-HK voice never reads
 * Simplified Chinese), and network voices never do.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], language: Language): V | undefined {
  const prefs = language.voices.map(norm);
  const score = (v: V): number => {
    const lang = norm(v.lang);
    const i = v.localService ? prefs.findIndex((p) => lang === p || lang.startsWith(`${p}-`)) : -1;
    return i < 0 ? -1 : i * 2 + (v.default ? 0 : 1);
  };
  let best: V | undefined;
  let bestScore = Infinity;
  for (const v of voices) {
    const s = score(v);
    if (s >= 0 && s < bestScore) [best, bestScore] = [v, s];
  }
  return best;
}

const SYLLABIC = /[぀-ヿ㐀-鿿가-힯]/g;

/**
 * A generous estimate of how long `text` takes to speak, for the safeguard that fades
 * the answer pointer when an engine never fires onend: ~130 words a minute, and
 * ~4 syllables a second for Chinese characters and Korean syllable blocks (no spaces to count).
 */
export function speakingEstimateMs(text: string): number {
  const syllables = text.match(SYLLABIC)?.length ?? 0;
  const words = text.replace(SYLLABIC, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(4000, words * 460 + syllables * 250 + 2000);
}

// Offline answers: retrieval over the plan's own targets. No model, no network.
//
// The reply for a found answer is built ONLY from the target's label, its
// document's title and page, and a verbatim quote of its text. Nothing is
// paraphrased or invented, so "unknown" stays an honest answer: a question the
// plan's documents don't cover gets not_found, and no answer pointer.
import type { AnswerContext, AnswerProvider, AnswerResult, AnswerSource } from "@/components/pointer/answer";
import { documentById, targetById, type Plan, type PlanTarget } from "@/components/pointer/plan";
import { isDeictic, questionConcepts, tokenize, verbatimQuote } from "./text";

/** Weight of a question word found in a target's label vs. in its verbatim text. */
const LABEL_WEIGHT = 3;
const TEXT_WEIGHT = 1;
/**
 * Minimum score, and minimum share of the question's *information* that must match.
 * Coverage is weighted by inverse document frequency over the plan's targets, so a
 * distinctive word the documents never use ("tax") outweighs a common one they do
 * ("property"): "property tax" is honestly not_found instead of pointing at "Property Owner".
 */
const MIN_SCORE = 3;
const MIN_COVERAGE = 0.5;

function inverseDocumentFrequency(plan: Plan): (w: string) => number {
  const df = new Map<string, number>();
  for (const t of plan.targets) {
    for (const w of new Set([...tokenize(t.label), ...tokenize(t.text)])) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const n = plan.targets.length;
  return (w) => Math.log((n + 1) / ((df.get(w) ?? 0) + 1)) + 1;
}

interface Scored {
  target: PlanTarget;
  score: number;
}

function scoreTargets(plan: Plan, question: string, currentTargetId?: string): Scored[] {
  const concepts = questionConcepts(question);
  if (concepts.length === 0) return [];
  const currentStep = plan.steps.find((s) => currentTargetId && s.targets.includes(currentTargetId));
  const idf = inverseDocumentFrequency(plan);
  // A concept carries the information of its most common member (a synonym the documents use).
  const conceptInfo = concepts.map((g) => Math.min(...g.map(idf)));
  const information = conceptInfo.reduce((a, b) => a + b, 0);
  const scored: Scored[] = [];
  for (const target of plan.targets) {
    const label = new Set(tokenize(target.label));
    const text = new Set(tokenize(target.text));
    let score = 0;
    let covered = 0;
    concepts.forEach((group, i) => {
      const inLabel = group.some((w) => label.has(w));
      const inText = group.some((w) => text.has(w));
      if (inLabel) score += LABEL_WEIGHT;
      if (inText) score += TEXT_WEIGHT;
      if (inLabel || inText) covered += conceptInfo[i];
    });
    if (score < MIN_SCORE || covered / information < MIN_COVERAGE) continue;
    // Prefer the city's documents over the homeowner's made-up files, then the current step.
    if (documentById(plan, target.doc)?.made_up) score *= 0.8;
    if (currentStep?.targets.includes(target.id)) score += 0.5;
    scored.push({ target, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/** Where a target's words come from, as a citable source. Empty for made-up files. */
export function targetSources(plan: Plan, target: PlanTarget): AnswerSource[] {
  const doc = documentById(plan, target.doc);
  const url = target.source_url ?? doc?.source_url;
  if (!url || doc?.made_up) return [];
  return [{ title: doc?.title ?? url, url, checked_date: doc?.checked_date ?? plan.checked_date }];
}

/** The city's own pages, from the plan's sources: where to ask when the plan has no answer. */
export function citySources(plan: Plan): AnswerSource[] {
  const seen = new Set<string>();
  const out: AnswerSource[] = [];
  for (const d of plan.documents) {
    if (!d.source_url || d.made_up || seen.has(d.source_url)) continue;
    seen.add(d.source_url);
    out.push({ title: d.title, url: d.source_url, checked_date: d.checked_date ?? plan.checked_date });
  }
  return out;
}

/** A found answer for one target: header line + verbatim quote + its source. */
export function answerFromTarget(plan: Plan, target: PlanTarget): AnswerResult {
  const doc = documentById(plan, target.doc);
  const where = `${doc?.title ?? "the documents"}${target.page ? `, page ${target.page}` : ""}`;
  return {
    kind: "found",
    targetId: target.id,
    text: `“${target.label}” — from ${where}:`,
    quote: verbatimQuote(target.text),
    sources: targetSources(plan, target),
  };
}

export function notFound(ctx: AnswerContext): AnswerResult {
  return {
    kind: "not_found",
    text: `That isn't on this checklist. The City of ${ctx.city} can answer it — start from their page below.`,
    sources: citySources(ctx.plan),
  };
}

/** Synchronous core, exported for the live provider's fallback and for tests. */
export function answerLocally(question: string, ctx: AnswerContext): AnswerResult {
  const current = targetById(ctx.plan, ctx.currentTargetId);
  if (current && isDeictic(question)) return answerFromTarget(ctx.plan, current);
  const [best] = scoreTargets(ctx.plan, question, ctx.currentTargetId);
  return best ? answerFromTarget(ctx.plan, best.target) : notFound(ctx);
}

export function createLocalProvider(): AnswerProvider {
  return {
    name: "local",
    async ask(question, ctx, signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return answerLocally(question, ctx);
    },
  };
}

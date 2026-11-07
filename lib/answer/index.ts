// STUB (lead scaffold). Owned by the sidebar lane: local retrieval and live (/api/agent)
// answer providers. The contract is AnswerProvider in components/pointer/answer.ts.
import type { AnswerProvider } from "@/components/pointer/answer";

export function getAnswerProvider(): AnswerProvider {
  return {
    name: "local",
    async ask() {
      return { kind: "not_found", text: "Answers are not wired up yet.", sources: [] };
    },
  };
}

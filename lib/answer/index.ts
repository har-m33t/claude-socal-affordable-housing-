// Where answers come from. Local retrieval over the plan's own text is the default
// and works offline; set NEXT_PUBLIC_POINTER_ANSWERS=live to ask /api/agent
// (which itself falls back to local when the agent can't answer).
import type { AnswerProvider } from "@/components/pointer/answer";
import { createLiveProvider } from "./live";
import { createLocalProvider } from "./local";

export function getAnswerProvider(): AnswerProvider {
  return process.env.NEXT_PUBLIC_POINTER_ANSWERS === "live" ? createLiveProvider() : createLocalProvider();
}

export { createLiveProvider, createLocalProvider };

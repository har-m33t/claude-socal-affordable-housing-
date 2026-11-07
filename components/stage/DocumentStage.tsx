"use client";
// STUB (lead scaffold). Owned by the stage lane: the active document (PDF or file
// board), document tabs, and both pointers. Props are frozen in ui-contract.ts.
import type { DocumentStageProps } from "@/components/pointer/ui-contract";

export default function DocumentStage({ plan, activeDocId }: DocumentStageProps) {
  const doc = plan.documents.find((d) => d.id === activeDocId);
  return <div className="p-6 text-sm">Stage stub: {doc?.title ?? activeDocId}</div>;
}

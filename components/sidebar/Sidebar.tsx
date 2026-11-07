"use client";
// STUB (lead scaffold). Owned by the sidebar lane: the slim side rail with Plan and
// Ask tabs, the chat, and the answer session. Props are frozen in ui-contract.ts.
import type { SidebarProps } from "@/components/pointer/ui-contract";

export function Sidebar({ plan, stepIndex, controls }: SidebarProps) {
  return (
    <aside className="w-[360px] border-l p-4 text-sm">
      <p>Sidebar stub: step {stepIndex + 1} of {plan.steps.length}</p>
      <button type="button" className="btn btn-primary mt-2" onClick={controls.start}>
        Play
      </button>
    </aside>
  );
}

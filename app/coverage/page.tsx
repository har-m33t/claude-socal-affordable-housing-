import type { Metadata } from "next";
import { CoverageTable } from "@/components/coverage/CoverageTable";

export const metadata: Metadata = { title: "Coverage · Pointer" };

export default function CoveragePage() {
  return <CoverageTable />;
}

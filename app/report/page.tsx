import type { Metadata } from "next";
import { ReadinessReport } from "@/components/report/ReadinessReport";

export const metadata: Metadata = { title: "Readiness report · Pointer" };

export default function ReportPage() {
  return <ReadinessReport />;
}

import type { Metadata } from "next";
import DocketDashboard from "./docket-dashboard";

export const metadata: Metadata = {
  title: "Workbench",
  description:
    "Evidence-first operations for human and AI engineering teams.",
};

export default function Home() {
  return <DocketDashboard />;
}

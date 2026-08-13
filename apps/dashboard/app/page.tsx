import type { Metadata } from "next";
import AosDashboard from "./aos-dashboard";

export const metadata: Metadata = {
  title: "Workbench",
  description:
    "Evidence-first operations for human and AI engineering teams.",
};

export default function Home() {
  return <AosDashboard />;
}

import type { Metadata } from "next";
import { ReportsClient } from "./reports-client";

export const metadata: Metadata = { title: "Reportes — Admin MediFlow" };

export default function ReportsPage() {
  return <ReportsClient />;
}

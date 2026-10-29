import type { Metadata } from "next";
import { ReportsClient } from "./reports-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

export const metadata: Metadata = { title: "Reportes — Admin DaleControl" };

export default async function ReportsPage() {
  await requireAdminPage();
  return <ReportsClient />;
}

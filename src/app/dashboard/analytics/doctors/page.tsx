export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { DoctorsClient } from "./doctors-client";

export const metadata: Metadata = { title: "Doctores — Analytics" };

export default async function DoctorsAnalyticsPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>Solo admin.</div>;
  }
  return <DoctorsClient />;
}

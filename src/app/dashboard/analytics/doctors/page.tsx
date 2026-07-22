export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { DoctorsClient } from "./doctors-client";

export const metadata: Metadata = { title: "Doctores — Analytics" };

export default async function DoctorsAnalyticsPage() {
  const { t } = await getServerT();
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>{t("analytics.doctorsPage.adminOnly")}</div>;
  }
  return <DoctorsClient key={user.clinicId} />;
}

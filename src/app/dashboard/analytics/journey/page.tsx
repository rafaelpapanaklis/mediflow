export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { JourneyClient } from "./journey-client";

export const metadata: Metadata = { title: "Patient Journey — Analytics" };

export default async function JourneyAnalyticsPage() {
  const { t } = await getServerT();
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>{t("analytics.journeyPage.adminOnly")}</div>;
  }
  return <JourneyClient />;
}

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { CostsClient } from "./costs-client";

export const metadata: Metadata = { title: "Costos & Margen — Analytics" };

export default async function CostsAnalyticsPage() {
  const user = await getCurrentUser();
  const { t } = await getServerT();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>{t("analytics.costs.adminOnly")}</div>;
  }
  return <CostsClient />;
}

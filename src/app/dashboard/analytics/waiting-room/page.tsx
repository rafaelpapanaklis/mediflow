export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { WaitingRoomClient } from "./waiting-room-client";

export const metadata: Metadata = { title: "Sala de espera — Analytics" };

export default async function WaitingRoomAnalyticsPage() {
  const { t } = await getServerT();
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>{t("analytics.waitingRoomPage.adminOnly")}</div>;
  }
  return <WaitingRoomClient key={user.clinicId} />;
}

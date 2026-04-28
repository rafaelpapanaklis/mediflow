export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { WaitingRoomClient } from "./waiting-room-client";

export const metadata: Metadata = { title: "Sala de espera — Analytics" };

export default async function WaitingRoomAnalyticsPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>Solo admin.</div>;
  }
  return <WaitingRoomClient />;
}

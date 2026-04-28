export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { NoShowsClient } from "./no-shows-client";

export const metadata: Metadata = { title: "No-shows — Analytics" };

export default async function NoShowsPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>Solo admin.</div>;
  }
  return <NoShowsClient />;
}

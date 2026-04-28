export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { TvModesClient } from "./tv-modes-client";

export const metadata: Metadata = { title: "Pantallas TV — MediFlow" };

export default async function TvModesPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>Solo admin.</div>;
  }
  return <TvModesClient />;
}

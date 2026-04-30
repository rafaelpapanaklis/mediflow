export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { TvModesClient } from "./tv-modes-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";

export const metadata: Metadata = { title: "Pantallas TV — MediFlow" };

export default async function TvModesPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "tvModes.view");
  return <TvModesClient />;
}

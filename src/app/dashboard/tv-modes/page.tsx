export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { TvModesClient } from "./tv-modes-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getActiveClinicModuleKeys } from "@/lib/clinical-shared/get-active-clinic-modules";
import { ModuleLocked } from "@/components/dashboard/module-locked";

export const metadata: Metadata = { title: "Pantallas TV — DaleControl" };

export default async function TvModesPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "tvModes.view");

  // Gating por PLAN (no solo por rol): si el plan no incluye Pantallas TV,
  // no se puede abrir por URL. Mismo criterio que el sidebar.
  const activeModules = await getActiveClinicModuleKeys(user.clinicId);
  if (!activeModules.includes("tv-modes")) return <ModuleLocked name="Pantallas TV" />;

  return <TvModesClient />;
}

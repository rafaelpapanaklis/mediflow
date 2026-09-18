export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { TvModesClient } from "./tv-modes-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getActiveClinicModuleKeys } from "@/lib/clinical-shared/get-active-clinic-modules";
import { ModuleLocked } from "@/components/dashboard/module-locked";
import { ModuloFueraDelPlan } from "@/components/dashboard/marketplace-oculto/modulo-fuera-del-plan";
import { seOcultaMarketplace } from "@/components/dashboard/marketplace-oculto/destino";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";

export const metadata: Metadata = { title: "Pantallas TV — DaleControl" };

export default async function TvModesPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "tvModes.view");

  // Gating por PLAN (no solo por rol): si el plan no incluye Pantallas TV,
  // no se puede abrir por URL. Mismo criterio que el sidebar.
  // REDISEÑO (ws1-t6) — el MISMO interruptor por clínica que enciende el menú de
  // dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio. Falla cerrado (→ false = la pantalla de hoy, tal cual). No añade un
  // viaje a la base: la respuesta vive 60 s en memoria por clínica y el layout
  // ya la pidió en esta misma carga.
  const [activeModules, rediseno] = await Promise.all([
    getActiveClinicModuleKeys(user.clinicId),
    menuDosNivelesEncendido(user.clinicId),
  ]);
  if (!activeModules.includes("tv-modes")) {
    // Marketplace oculto por ahora (ws1-t6): en el camino nuevo «Ver planes»
    // lleva al plan de la clínica. Con la bandera apagada, el ModuleLocked de siempre.
    if (seOcultaMarketplace(rediseno)) return <ModuloFueraDelPlan name="Pantallas TV" />;
    return <ModuleLocked name="Pantallas TV" />;
  }

  return <TvModesClient key={user.clinicId} rediseno={rediseno} />;
}

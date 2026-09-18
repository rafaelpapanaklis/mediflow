import { getCurrentUser } from "@/lib/auth";
import { getActiveClinicModuleKeys } from "@/lib/clinical-shared/get-active-clinic-modules";
import { ModuleLocked } from "@/components/dashboard/module-locked";
import { ModuloFueraDelPlan } from "@/components/dashboard/marketplace-oculto/modulo-fuera-del-plan";
import { marketplaceOcultoPara } from "@/components/dashboard/marketplace-oculto/servidor";

// Gating por PLAN para TODO /dashboard/analytics (overview + sub-rutas:
// costs/crm/doctors/journey/no-shows/occupancy/procedures/waiting-room). Al
// vivir en el layout del segmento, cierra por URL todas las páginas de una
// sola vez. Mismo criterio que el sidebar y que la página overview
// (getActiveClinicModuleKeys): fail-open en trial / error, oculta en BASIC.
export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const activeModules = await getActiveClinicModuleKeys(user.clinicId);
  if (!activeModules.includes("analytics")) {
    // Marketplace oculto por ahora (ws1-t6): en el camino nuevo «Ver planes»
    // lleva al plan de la clínica. Con la bandera apagada, el ModuleLocked de siempre.
    if (await marketplaceOcultoPara(user.clinicId)) return <ModuloFueraDelPlan name="Analytics" />;
    return <ModuleLocked name="Analytics" />;
  }
  return <>{children}</>;
}

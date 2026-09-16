export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { AvisoFinanzas, RaizFinanzas } from "@/components/dashboard/finanzas-rediseno/raiz";
import { FinanzasRediseno } from "@/components/dashboard/finanzas-rediseno/finanzas-rediseno";
import { FinanzasClient } from "./finanzas-client";

export const metadata: Metadata = { title: "Finanzas — DaleControl" };

// Finanzas = el pulso financiero de la clínica (ingresos, gastos, utilidad,
// saldos). Gate idéntico al de /dashboard/analytics: permiso + solo
// admin/owner. Los datos se cargan client-side desde /api/finanzas y
// /api/gastos según el periodo elegido.
// TODO: gating por plan (módulo Finanzas) — pendiente
export default async function FinanzasPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "analytics.view");

  // REDISEÑO DE FINANZAS — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`),
  // no uno propio: Rafael prueba «el diseño nuevo» como una sola cosa. Falla
  // cerrado (sin tabla, sin fila o con error → false = la pantalla de hoy, tal
  // cual). No añade un viaje a la base: el layout del panel ya la consultó en
  // esta misma petición y la respuesta vive 60 s en memoria por clínica.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);

  // Solo admin/owner ven Finanzas (mismo criterio que analytics/page.tsx).
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    if (rediseno) {
      return (
        <RaizFinanzas>
          <AvisoFinanzas>Solo los administradores pueden ver Finanzas.</AvisoFinanzas>
        </RaizFinanzas>
      );
    }
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
        Solo los administradores pueden ver Finanzas.
      </div>
    );
  }

  if (rediseno) {
    return (
      <RaizFinanzas>
        <FinanzasRediseno key={user.clinicId} />
      </RaizFinanzas>
    );
  }

  return <FinanzasClient key={user.clinicId} />;
}

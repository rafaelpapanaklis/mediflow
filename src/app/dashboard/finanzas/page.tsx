export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
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

  // Solo admin/owner ven Finanzas (mismo criterio que analytics/page.tsx).
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
        Solo los administradores pueden ver Finanzas.
      </div>
    );
  }

  return <FinanzasClient />;
}

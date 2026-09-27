// GET /api/anticipos/por-revisar — el aviso a recepción (ws1-t3 fase 1):
// anticipos pedidos desde el panel que quedaron marcados para revisar (pago
// tardío con el hueco ya perdido, factura cancelada o ya saldada, segundo
// pago…). "billing.view", no "settings.edit": lo tiene que ver recepción, no
// solo quien administra la configuración.

import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { anticiposPorRevisar } from "@/lib/anticipos/avisos-recepcion.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  return NextResponse.json({ items: await anticiposPorRevisar(ctx.clinicId) });
}

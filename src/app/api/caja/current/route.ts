import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { getCajaState } from "@/lib/caja";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Caja OPEN de la clínica + totales derivados en vivo (efectivo, tarjeta
// débito/crédito, otros) + lista del turno (con descuento por fila) + resumen
// del día natural MX: suggestedOpening, billedToday, pendingToday, overdueToday.
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const state = await getCajaState(ctx.clinicId);
  return NextResponse.json(state);
}

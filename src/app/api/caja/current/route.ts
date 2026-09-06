import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { getCajaState } from "@/lib/caja";
import { canUseCaja } from "@/lib/caja-pin";

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
  // Gate de Caja por usuario (CONTRATO CAJA v2), igual que open/close/
  // withdrawal/pin y que la página /dashboard/caja: el turno trae paciente,
  // concepto, monto, método, descuento y doctor por fila. Leerlo es entrar a
  // la Caja, así que exige lo mismo que operarla.
  if (!canUseCaja(ctx.user)) {
    return NextResponse.json({ error: "No tienes permiso para operar la Caja. Pide a un administrador que te habilite el acceso.", code: "CAJA_NO_ACCESS" }, { status: 403 });
  }

  const state = await getCajaState(ctx.clinicId);
  return NextResponse.json(state);
}

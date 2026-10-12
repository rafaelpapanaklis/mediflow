import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { movimientosDelCorte } from "@/lib/caja";
import { canUseCaja } from "@/lib/caja-pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Detalle de UN corte cerrado (tercera auditoría de uso, F3): lo que su foto no
// guarda —reembolsos, traspasos a saldo a favor, saldo aplicado y bajas—,
// calculado de los cobros de su turno. Solo lectura; mismo gate que /history.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  if (!canUseCaja(ctx.user)) {
    return NextResponse.json({ error: "No tienes permiso para operar la Caja. Pide a un administrador que te habilite el acceso.", code: "CAJA_NO_ACCESS" }, { status: 403 });
  }
  if (!ctx.clinicId || !params?.id) return NextResponse.json({ error: "Corte no encontrado" }, { status: 404 });
  const mov = await movimientosDelCorte(ctx.clinicId, params.id);
  if (!mov) return NextResponse.json({ error: "Corte no encontrado" }, { status: 404 });
  return NextResponse.json(mov);
}

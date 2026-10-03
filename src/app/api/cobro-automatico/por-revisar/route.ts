// GET/POST /api/cobro-automatico/por-revisar — el aviso a recepción (ws1-t6):
// cobros automáticos con tarjeta que Mercado Pago rechazó, y suscripciones que MP
// canceló por su lado. La mensualidad queda pendiente para cobro manual.
// «billing.view»: lo tiene que ver recepción. POST marca uno como revisado.

import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { esIdDeLaBase } from "@/lib/validation/id";
import { marcarRevisado, porRevisar } from "@/lib/cobro-automatico/servicio.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  return NextResponse.json({ items: await porRevisar(ctx.clinicId) });
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!esIdDeLaBase(body?.id)) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
  const ok = await marcarRevisado({ clinicId: ctx.clinicId, id: body.id, userId: ctx.userId });
  return NextResponse.json({ ok });
}

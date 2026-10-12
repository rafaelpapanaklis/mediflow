// GET /api/cobro-automatico/factura/[id]/aviso?monto=2000 — ws1-t6 (F1, cobro doble).
//
// Lo que el modal de cobro le dice a recepción ANTES de cobrar a mano en una
// factura con cobro automático con tarjeta: si ese cargo de Mercado Pago se
// pausará (y cuándo vuelve), si la factura queda pagada (se cancela), o si MP YA
// cobró la mensualidad de este ciclo (entonces el cobro necesita confirmarse
// como adelanto; el POST de la factura lo frena igual). Solo lee.
// `{ aviso: null }` = nada que decir (sin cobro automático, sin SQL…).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase } from "@/lib/validation/id";
import { avisoParaCobro } from "@/lib/cobro-automatico/servicio.server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.charge");
  if (denied) return denied;
  if (!esIdDeLaBase(params.id)) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
  const monto = Math.round(Number(new URL(req.url).searchParams.get("monto")) * 100) / 100;
  if (!Number.isFinite(monto) || monto <= 0) return NextResponse.json({ aviso: null });
  const inv = await prisma.invoice.findFirst({ where: { id: params.id, clinicId: ctx.clinicId }, select: { patientId: true } });
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.patientId) {
    const oculto = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (oculto) return oculto;
  }
  return NextResponse.json({ aviso: await avisoParaCobro({ clinicId: ctx.clinicId, invoiceId: params.id, monto }) });
}

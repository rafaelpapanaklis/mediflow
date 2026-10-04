// POST /api/caja/asignar — { paymentId } (ws1-t5, F7): pasa a la caja ABIERTA
// un cobro en efectivo que ningún corte recoge (cobrado sin caja abierta o con
// fecha anterior a la apertura). Desde ese momento cuenta en el efectivo
// esperado de esa caja y se cierra con ella. Mismas puertas que operar Caja.
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";
import { canUseCaja } from "@/lib/caja-pin";
import { computeCobrosFueraDeCorte, getOpenRegister } from "@/lib/caja";
import { asignarCobroACaja } from "@/lib/dinero/ajustes.server";
import { montoParaTexto } from "@/lib/movimientos-paciente/textos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.charge");
  if (denied) return denied;
  if (!canUseCaja(ctx.user)) return NextResponse.json({ error: "No tienes permiso para operar la Caja.", code: "CAJA_NO_ACCESS" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const paymentId = typeof body?.paymentId === "string" ? body.paymentId : "";
  if (!paymentId) return NextResponse.json({ error: "Falta el cobro" }, { status: 400 });

  const reg = await getOpenRegister(ctx.clinicId);
  if (!reg) return NextResponse.json({ error: "Abre la caja para poder pasarle el cobro." }, { status: 409 });
  // Solo un cobro que HOY está fuera de todo corte (y es de esta clínica): la
  // misma regla que pinta la lista, sin volver a escribirla.
  const fuera = await computeCobrosFueraDeCorte(ctx.clinicId, new Date());
  const cobro = fuera.find((c) => c.paymentId === paymentId);
  if (!cobro) return NextResponse.json({ error: "Ese cobro ya está en un corte (o no es de esta clínica)." }, { status: 409 });

  const ok = await asignarCobroACaja({ clinicId: ctx.clinicId, paymentId, cashRegisterId: reg.id, userId: ctx.userId });
  if (!ok) return NextResponse.json({ error: "Falta pegar sql/ws1-t5-dinero-caja.sql.", code: "SQL_PENDIENTE" }, { status: 503 });

  const pago = await prisma.payment.findFirst({ where: { id: paymentId, invoice: { clinicId: ctx.clinicId } }, select: { invoiceId: true } });
  await logMutation({
    req, clinicId: ctx.clinicId, userId: ctx.userId, entityType: "cash-register", entityId: reg.id, action: "update",
    before: { cobroFueraDeCorte: null },
    after: { cobroFueraDeCorte: { paymentId, invoiceId: pago?.invoiceId ?? null, amount: cobro.amount, paidAt: cobro.at } },
    texto: `Pasó a la caja abierta un cobro en efectivo de ${montoParaTexto(cobro.amount)} que estaba fuera de corte`,
  });
  revalidatePath("/dashboard/caja");
  return NextResponse.json({ ok: true });
}

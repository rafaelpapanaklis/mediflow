// /api/invoices/[id]/anticipo/anular — anular un anticipo registrado por
// error (H7 de la revisión final, ws1-t4). Las reglas, en
// src/lib/anticipos/anular-core.ts.
//
//   GET  → los anticipos recibidos de la factura que se pueden anular.
//   POST → { depositId, motivo } → lo anula: el pago queda en $0 con nota,
//          el anticipo pasa a anulado y la factura vuelve a como estaba.
//
// Permiso: "billing.refund" (reembolsar / cancelar) — auditoría de uso C-04
// (4-oct-2026, decisión de Rafael por defecto): anular un anticipo YA RECIBIDO
// saca ese dinero del sistema igual que un reembolso, así que pide lo mismo
// (dueño / administración). Antes bastaba «billing.charge» y recepción podía
// dejar en $0 un cobro con solo escribir un motivo. Queda en Movimientos.
// Multi-tenant: clinicId y quien anula, de la sesión; visibilidad por
// paciente antes de tocar nada.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { anticiposAnulables, anularAnticipoRecibido } from "@/lib/anticipos/anular.server";
import { montoParaTexto } from "@/lib/movimientos-paciente/textos";

export const dynamic = "force-dynamic";

async function comprobar(ctx: { clinicId: string; userId: string; role: any }, invoiceId: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, clinicId: ctx.clinicId }, select: { patientId: true } });
  if (!inv) return { error: NextResponse.json({ error: "Factura no encontrada" }, { status: 404 }) } as const;
  if (inv.patientId) {
    const denied = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return { error: denied } as const;
  }
  return { patientId: inv.patientId } as const;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // Sin permiso de reembolso no hay nada que ofrecer: lista vacía, sin error.
  if (denyIfMissingPermission(ctx, "billing.refund")) return NextResponse.json({ anulables: [] });
  const chk = await comprobar(ctx, params.id);
  if ("error" in chk) return chk.error;
  return NextResponse.json({ anulables: await anticiposAnulables(ctx.clinicId, params.id) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const limited = rateLimit(req, 10);
  if (limited) return limited;
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.refund");
  if (denied) return denied;
  const chk = await comprobar(ctx, params.id);
  if ("error" in chk) return chk.error;

  const body = await req.json().catch(() => null);
  const depositId = typeof body?.depositId === "string" ? body.depositId : "";
  const motivo = typeof body?.motivo === "string" ? body.motivo : "";

  const usuario = await prisma.user.findFirst({
    where: { id: ctx.userId, clinicId: ctx.clinicId },
    select: { firstName: true, lastName: true, email: true },
  });
  const quien = usuario ? `${usuario.firstName ?? ""} ${usuario.lastName ?? ""}`.trim() || usuario.email : ctx.userId;

  const r = await anularAnticipoRecibido({ clinicId: ctx.clinicId, invoiceId: params.id, depositId, userId: ctx.userId, quien, motivo });
  if (!r.ok || !r.anulado) {
    const status = r.error === "no_encontrada" ? 404 : r.error === "motivo" ? 400 : 409;
    return NextResponse.json({ error: r.motivo ?? "No se pudo anular el anticipo.", code: r.error }, { status });
  }

  await logMutation({
      // C-18: con el paciente, para que salga en sus Movimientos.
      patientId: chk.patientId ?? undefined,
      texto: `Anuló un anticipo de ${montoParaTexto(r.anulado.monto)}${motivo.trim() ? ` (motivo: ${motivo.trim()})` : ""}`,
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: params.id,
    action: "update",
    before: { ...r.anulado.antes, anticipo: { depositId, monto: r.anulado.monto, method: r.anulado.method } },
    after: { ...r.anulado.despues, anticipoAnulado: { depositId, motivo: motivo.trim(), quien } },
  });

  // El saldo cambió: un link de pago de la factura completa pedía el viejo.
  await cerrarLinksDeFactura({ clinicId: ctx.clinicId, invoiceId: params.id }).catch(() => {});
  revalidateAfter("invoices");
  if (chk.patientId) revalidatePath(`/dashboard/patients/${chk.patientId}`);

  return NextResponse.json({
    anulado: r.anulado,
    aviso: r.anulado.porMercadoPago
      ? "Anulado en el panel. Ese dinero sí llegó por Mercado Pago: el reembolso al paciente se hace en tu cuenta de Mercado Pago."
      : null,
  });
}

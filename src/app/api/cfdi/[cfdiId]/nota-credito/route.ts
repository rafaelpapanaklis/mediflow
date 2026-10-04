import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { textoSoloDuenoTimbra } from "@/lib/cfdi/mensajes";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { montoParaTexto } from "@/lib/movimientos-paciente/textos";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { cerrarAnticiposDePanel } from "@/lib/anticipos/panel.server";
import { emitirNotaDeCredito } from "@/lib/invoices/cfdi-cancelacion.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cfdi/[cfdiId]/nota-credito
//   body { monto, razon, devolverDinero: boolean, formaPago: "01"|"03"|…, metodoDevolucion? }
//
// Nota de crédito (CFDI de egreso, relación 01) sobre un CFDI de ingreso
// vigente (ws1-t3, F-16 parte egreso). Con `devolverDinero` registra además el
// reembolso interno (Payment «refund») ligado a la nota, y la factura baja su
// total: un CFDI de $1,600 con devolución de $500 deja la factura en $1,100
// pagados y saldo $0. Solo dueño/administrador (como timbrar) y, si devuelve
// dinero, además el permiso de reembolsar.
export async function POST(req: NextRequest, { params }: { params: { cfdiId: string } }) {
  const rl = rateLimit(req, 20, 60 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  // C-57: sin «Solo administradores» (decisión 13: solo dueño/admin, como hoy).
  if (err) return ctx ? NextResponse.json({ error: textoSoloDuenoTimbra(), code: "CFDI_SOLO_DUENO" }, { status: 403 }) : err;
  const { clinicId, userId } = ctx!;

  const body = await req.json().catch(() => ({}));
  const devolverDinero = body?.devolverDinero !== false;
  if (devolverDinero) {
    const denied = denyIfMissingPermission(ctx!, "billing.refund");
    if (denied) return denied;
  }

  const rec = await prisma.cfdiRecord.findFirst({ where: { id: params.cfdiId, clinicId }, select: { invoiceId: true } });
  if (!rec?.invoiceId) return NextResponse.json({ error: "CFDI no encontrado." }, { status: 404 });
  const inv = await prisma.invoice.findFirst({ where: { id: rec.invoiceId, clinicId }, select: { patientId: true } });
  if (inv?.patientId) {
    const denied = await assertPatientVisible(inv.patientId, { userId, role: ctx!.role, clinicId });
    if (denied) return denied;
  }

  const r = await emitirNotaDeCredito({
    clinicId, userId, cfdiId: params.cfdiId,
    monto: body?.monto, razon: body?.razon, devolverDinero,
    formaPago: body?.formaPago, metodoDevolucion: body?.metodoDevolucion,
  });
  if (r.status !== 200) return NextResponse.json(r.body, { status: r.status });

  const b = r.body as any;
  await logMutation({
    req, clinicId, userId, patientId: b.patientId,
    texto: `Emitió una nota de crédito por ${montoParaTexto(b.monto)} sobre el CFDI de la factura ${b.invoiceNumber ?? ""}${b.devolverDinero ? " y registró la devolución" : ""}`,
    entityType: "invoice", entityId: b.invoiceId, action: "update",
    before: { notaDeCredito: null },
    after: {
      notaDeCredito: {
        uuid: b.uuid, monto: b.monto, motivo: b.razon, relacion: "01",
        cfdiOriginal: b.cfdiOriginalUuid, devolverDinero: b.devolverDinero, refundPaymentId: b.refundPaymentId,
      },
    },
  });

  // Igual que el reembolso de siempre: el saldo cambió, los links de pago y los
  // anticipos pendientes piden un monto viejo. Nunca lanzan.
  await cerrarLinksDeFactura({ clinicId, invoiceId: b.invoiceId });
  await cerrarAnticiposDePanel({ clinicId, invoiceId: b.invoiceId });
  revalidateAfter("invoices");
  if (b.patientId) revalidatePath(`/dashboard/patients/${b.patientId}`);

  return NextResponse.json({
    ok: true, notaId: b.notaId, uuid: b.uuid, total: b.total, refundPaymentId: b.refundPaymentId,
    ...(b.warning ? { warning: b.warning } : {}),
  });
}

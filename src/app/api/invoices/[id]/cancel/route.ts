import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { denyIfCfdiVigente, cfdiVigenteResponse } from "@/lib/invoices/cfdi-vigente";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";

// Multi-tenant: clinicId siempre desde la sesión, nunca del body. Mismo
// patrón que /api/invoices/[id]/route.ts.
// Contexto vía el helper CENTRAL: misma resolución cookie→clínica que la
// copia local que había aquí, pero aplicando el gate de plan vencido
// (isPlanExpired) que las copias locales se saltaban.
async function getCtx() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role, permissionsOverride: ctx.permissionsOverride };
}

// POST /api/invoices/[id]/cancel — body { reason?: string }
// Marca la factura como CANCELLED. Solo si paid == 0 (las que tienen pagos
// requieren un reembolso primero).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Cancelar es una operación financiera sensible — la key billing.refund
  // (description "Reembolsar / cancelar") cubre ambos casos por diseño.
  const denied = denyIfMissingPermission(ctx, "billing.refund");
  if (denied) return denied;
  const { clinicId } = ctx;

  const { reason } = await req.json().catch(() => ({ reason: undefined }));

  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  // Visibilidad por paciente (barrido Ola 3): cancelar la factura de un
  // paciente restringido exige poder verlo.
  if (invoice.patientId) {
    const visDenied = await assertPatientVisible(invoice.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId,
    });
    if (visDenied) return visDenied;
  }
  if (invoice.status === "CANCELLED") return NextResponse.json({ error: "La factura ya está cancelada" }, { status: 400 });
  // Con CFDI, cancelar aquí lo dejaría vigente ante el SAT (N3).
  const cfdiDenied = denyIfCfdiVigente(invoice.cfdiUuid, "cancelar");
  if (cfdiDenied) return cfdiDenied;
  if (invoice.status === "PAID") return NextResponse.json({ error: "No se puede cancelar una factura pagada — usa Reembolsar" }, { status: 400 });
  if (invoice.paid > 0) return NextResponse.json({ error: "Esta factura tiene pagos registrados — usa Reembolsar primero" }, { status: 400 });

  // Append razón a notes si se provee, así queda registro humano-legible
  // sin necesidad de schema migration. El audit log también la guarda.
  const reasonText = (reason ?? "").trim();
  const newNotes = reasonText
    ? `${invoice.notes ? invoice.notes + "\n" : ""}[CANCELADA: ${reasonText}]`
    : invoice.notes;

  // `cfdiUuid` igual al leído: si alguien la timbró desde la lectura, no se cancela.
  const { count } = await prisma.invoice.updateMany({
    where: { id: params.id, clinicId, cfdiUuid: invoice.cfdiUuid },
    data:  { status: "CANCELLED", notes: newNotes },
  });
  if (count === 0) return cfdiVigenteResponse(null, "cancelar");

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { status: invoice.status, notes: invoice.notes },
    after:  { status: "CANCELLED", reason: reasonText || undefined },
  });

  // Mercado Pago (ws1-t1): el saldo cambió por aquí; los links pendientes piden
  // un monto viejo y se cierran. Nunca lanza.
  await cerrarLinksDeFactura({ clinicId, invoiceId: params.id });
  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}

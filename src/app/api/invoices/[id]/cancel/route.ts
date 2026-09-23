import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { denyIfCfdiVigente, cfdiVigenteResponse } from "@/lib/invoices/cfdi-vigente";
import { devolverAnticipoAlCancelar } from "@/lib/patient-credit-aplicar";
import { METODO_ANTICIPO } from "@/lib/patient-credit-core";
import { round2 } from "@/lib/invoice-totals";

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
// requieren un reembolso primero)… salvo que lo pagado sea SOLO el saldo a
// favor aplicado al emitirla (anticipo): entonces se cancela y ese dinero
// vuelve a estar a favor del paciente (patient-credit-aplicar.ts).
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

  // Append razón a notes si se provee, así queda registro humano-legible
  // sin necesidad de schema migration. El audit log también la guarda.
  const reasonText = (reason ?? "").trim();
  const notasCon = (notes: string | null) => reasonText
    ? `${notes ? notes + "\n" : ""}[CANCELADA: ${reasonText}]`
    : notes;

  // Sin nada pagado: el camino de siempre (una sola escritura, mismas respuestas).
  if (!(invoice.paid > 0)) {
    if (invoice.status === "PAID") return NextResponse.json({ error: "No se puede cancelar una factura pagada — usa Reembolsar" }, { status: 400 });
    const newNotes = notasCon(invoice.notes);
    // `cfdiUuid` igual al leído: si alguien la timbró desde la lectura, no se
    // cancela. `paid ≤ 0` igual al leído: si desde la lectura entró un cobro o
    // se le aplicó el saldo a favor, tampoco (se cancelaría con dinero dentro).
    const { count } = await prisma.invoice.updateMany({
      where: { id: params.id, clinicId, cfdiUuid: invoice.cfdiUuid, paid: { lte: 0 } },
      data:  { status: "CANCELLED", notes: newNotes },
    });
    if (count === 0) {
      const ahora = await prisma.invoice.findFirst({ where: { id: params.id, clinicId }, select: { cfdiUuid: true } });
      if (ahora?.cfdiUuid) return cfdiVigenteResponse(null, "cancelar");
      return NextResponse.json({ error: "La factura cambió mientras la cancelabas (entró un pago). Vuelve a abrirla." }, { status: 409 });
    }

    await logMutation({
      req, clinicId, userId: ctx.userId,
      entityType: "invoice", entityId: params.id, action: "update",
      before: { status: invoice.status, notes: invoice.notes },
      after:  { status: "CANCELLED", reason: reasonText || undefined },
    });

    revalidateAfter("invoices");
    revalidatePath(`/dashboard/patients/${invoice.patientId}`);
    return NextResponse.json({ success: true });
  }

  // Con algo pagado: solo si TODO es anticipo aplicado. Lectura + escrituras en
  // UNA transacción con el candado de la factura (el mismo FOR UPDATE que el
  // cobro, el reembolso y la aplicación del saldo a favor).
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${params.id} FOR UPDATE`;
    const fresca = await tx.invoice.findFirst({ where: { id: params.id, clinicId } });
    if (!fresca) return { error: "Factura no encontrada", status: 404 };
    if (fresca.status === "CANCELLED") return { error: "La factura ya está cancelada", status: 400 };
    const cfdiDentro = denyIfCfdiVigente(fresca.cfdiUuid, "cancelar");
    if (cfdiDentro) return { denied: cfdiDentro };

    // ¿Hay anticipo? Se mira primero en los Payment (tabla de siempre): sin
    // ninguno la respuesta es la de antes y no se consulta nada nuevo.
    const conAnticipo = await tx.payment.count({ where: { invoiceId: params.id, method: METODO_ANTICIPO } });
    if (conAnticipo === 0) {
      return fresca.status === "PAID"
        ? { error: "No se puede cancelar una factura pagada — usa Reembolsar", status: 400 }
        : { error: "Esta factura tiene pagos registrados — usa Reembolsar primero", status: 400 };
    }

    const dev = await devolverAnticipoAlCancelar(tx, {
      clinicId,
      invoice: { id: fresca.id, patientId: fresca.patientId, invoiceNumber: fresca.invoiceNumber, paid: fresca.paid },
      userId: ctx.userId,
    });
    if (dev.error) return { error: dev.error, status: 400 };

    const newPaid = round2(Math.max(0, fresca.paid - dev.devuelto));
    await tx.invoice.updateMany({
      where: { id: params.id, clinicId },
      data: {
        status: "CANCELLED",
        notes: notasCon(fresca.notes),
        paid: newPaid,
        balance: round2(Math.max(0, fresca.total - newPaid)),
        paidAt: null,
      },
    });
    return { fresca, devuelto: dev.devuelto, newPaid };
  });
  if ("denied" in result) return result.denied;
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { status: result.fresca.status, notes: result.fresca.notes, paid: result.fresca.paid },
    after:  {
      status: "CANCELLED", reason: reasonText || undefined, paid: result.newPaid,
      anticipoDevueltoAFavor: result.devuelto,
    },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true, anticipoDevuelto: result.devuelto });
}

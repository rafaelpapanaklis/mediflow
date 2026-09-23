import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { aplicarSaldoAFavor } from "@/lib/patient-credit-aplicar";

// Contexto vía el helper CENTRAL: misma resolución cookie→clínica que la
// copia local que había aquí, pero aplicando el gate de plan vencido
// (isPlanExpired) que las copias locales se saltaban.
async function getCtx() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role, permissionsOverride: ctx.permissionsOverride };
}

// POST /api/invoices/[id]/confirm
// Flip DRAFT → PENDING. Las facturas creadas vía autoInvoice / from-appointment
// nacen como DRAFT para permitir ajustes antes de "emitirlas". Una vez
// confirmada, ya acepta pagos vía /api/invoices/[id] (POST) y /mark-paid.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Confirmar (DRAFT → PENDING) es parte del ciclo de creación/emisión de
  // la factura — mismo permiso que crear. RECEPTIONIST lo tiene por default.
  const denied = denyIfMissingPermission(ctx, "billing.create");
  if (denied) return denied;
  const { clinicId } = ctx;

  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  // Visibilidad por paciente (barrido Ola 3): confirmar la factura de un
  // paciente restringido exige poder verlo.
  if (invoice.patientId) {
    const visDenied = await assertPatientVisible(invoice.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId,
    });
    if (visDenied) return visDenied;
  }
  if (invoice.status !== "DRAFT") {
    return NextResponse.json({ error: "Solo se pueden confirmar borradores" }, { status: 400 });
  }

  // `status: DRAFT` en el mismo UPDATE: si entre la lectura y aquí se borró,
  // se canceló o ya lo confirmó otra persona, no revive ni recibe el saldo a favor.
  const { count } = await prisma.invoice.updateMany({
    where: { id: params.id, clinicId, status: "DRAFT" },
    data:  { status: "PENDING" },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Solo se pueden confirmar borradores" }, { status: 409 });
  }

  // Un borrador que se confirma es una factura que se emite: recibe el saldo a
  // favor del paciente igual que una recién creada. Los borradores que nacieron
  // ANTES del cambio no (APLICAR_SALDO_DESDE en patient-credit-core.ts): las
  // facturas que ya existían se quedan como estaban. Propia transacción, no lanza.
  const saldo = await aplicarSaldoAFavor({ clinicId, invoiceId: params.id, userId: ctx.userId, origen: "confirmada" });

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { status: "DRAFT" },
    after:  {
      status: saldo.factura?.status ?? "PENDING",
      ...(saldo.aplicado > 0 ? { paid: saldo.factura?.paid, anticipoAplicado: saldo.aplicado } : {}),
    },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  // La pantalla necesita saberlo: si se aplicó saldo a favor, lo que queda por
  // cobrar ya no es el total del borrador.
  return NextResponse.json({
    success: true,
    anticipoAplicado: saldo.aplicado,
    ...(saldo.factura ? { balance: saldo.factura.balance, status: saldo.factura.status } : {}),
  });
}

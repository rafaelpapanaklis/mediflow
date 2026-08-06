import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter } from "@/lib/cache/revalidate";

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

  await prisma.invoice.updateMany({
    where: { id: params.id, clinicId },
    data:  { status: "PENDING" },
  });

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { status: "DRAFT" },
    after:  { status: "PENDING" },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

// Contexto vía el helper CENTRAL: misma resolución cookie→clínica que la
// copia local que había aquí, pero aplicando el gate de plan vencido
// (isPlanExpired) que las copias locales se saltaban.
async function getCtx() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role, permissionsOverride: ctx.permissionsOverride };
}

// GET /api/invoices/by-appointment/[appointmentId]
// Devuelve la factura vinculada a una cita (Invoice.appointmentId @unique),
// con sus pagos, para abrir el cobro inline desde la agenda sin navegar al
// perfil. Multi-tenant: scope por clinicId desde la sesión (la cita y la
// factura deben pertenecer a la clínica activa). 404 si la cita no tiene
// factura todavía — el caller muestra el aviso de "genera la factura desde
// el expediente".
export async function GET(_req: NextRequest, { params }: { params: { appointmentId: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Mismo gate que la pestaña Facturación de la ficha y que Caja: leer la
  // factura de una cita (folio, montos e identidad fiscal) exige "billing.view".
  const deniedPerm = denyIfMissingPermission(ctx, "billing.view");
  if (deniedPerm) return deniedPerm;
  const { clinicId } = ctx;

  // La cita debe ser de esta clínica (evita fuga cross-tenant del invoiceId).
  const appt = await prisma.appointment.findFirst({
    where: { id: params.appointmentId, clinicId },
    select: { id: true },
  });
  if (!appt) return NextResponse.json({ error: "appointment_not_found" }, { status: 404 });

  const invoice = await prisma.invoice.findFirst({
    where: { appointmentId: params.appointmentId, clinicId },
    include: {
      payments: { orderBy: { paidAt: "asc" } },
      patient:  { select: { rfcPaciente: true, razonSocialPac: true, regimenFiscalPac: true, cpPaciente: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });

  // Visibilidad: la factura trae la identidad fiscal del paciente (RFC, razón
  // social, régimen, CP). Si este usuario no puede ver al paciente, 404 — no
  // servir sus datos fiscales desde la agenda.
  if (invoice.patientId) {
    const denied = await assertPatientVisible(invoice.patientId, { userId: ctx.userId, role: ctx.role, clinicId });
    if (denied) return denied;
  }

  return NextResponse.json({ invoice });
}

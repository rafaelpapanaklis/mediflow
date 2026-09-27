// GET /api/invoices/[id]/anticipo/solicitud-pdf — descarga el PDF «Solicitud
// de anticipo» (ws1-t3 fase 2) del anticipo por TRANSFERENCIA pendiente de
// esta factura. Existe para «desde otro teléfono»: cuando no se puede mandar
// por WhatsApp (fuera de ventana, o compartirlo por otro canal), recepción lo
// descarga aquí y lo manda a mano.
//
// Mismo molde que print/route.tsx: auth, permiso, visibilidad por paciente
// ANTES de generar nada. Multi-tenant por clinicId de la sesión.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { estadoAnticipoDeFactura } from "@/lib/anticipos/panel.server";
import { leerDatosBancarios } from "@/lib/anticipos/datos-bancarios.server";
import { buildSolicitudAnticipoPdf } from "@/lib/anticipos/solicitud-pdf";
import { formatDateHuman, formatTimeHuman, toISODate } from "@/lib/whatsapp/bot/booking-parse";

export const runtime = "nodejs"; // @react-pdf/renderer no corre en edge
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 20);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: {
      patientId: true,
      patient: { select: { firstName: true, lastName: true } },
      appointment: { select: { startsAt: true } },
      clinic: { select: { timezone: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (invoice.patientId) {
    const deniedPatient = await assertPatientVisible(invoice.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (deniedPatient) return deniedPatient;
  }

  const [estado, banco] = await Promise.all([
    estadoAnticipoDeFactura(ctx.clinicId, params.id),
    leerDatosBancarios(ctx.clinicId),
  ]);
  if (!estado.pendiente || estado.pendiente.metodo !== "transferencia") {
    return NextResponse.json({ error: "Esta factura no tiene un anticipo por transferencia pendiente." }, { status: 404 });
  }
  if (!banco) {
    return NextResponse.json({ error: "Esta clínica no tiene datos bancarios cargados." }, { status: 409 });
  }

  const tz = invoice.clinic?.timezone || "America/Mexico_City";
  const cita = invoice.appointment;
  const paciente = invoice.patient ? `${invoice.patient.firstName} ${invoice.patient.lastName ?? ""}`.trim() : "Paciente";

  try {
    const pdf = await buildSolicitudAnticipoPdf({
      clinicId: ctx.clinicId,
      paciente,
      monto: estado.pendiente.amount,
      vence: new Date(estado.pendiente.expiresAt),
      banco: banco.banco,
      beneficiario: banco.beneficiario,
      clabe: banco.clabe,
      referencia: banco.referencia,
      fechaHumana: cita ? formatDateHuman(toISODate(cita.startsAt, tz), tz) : null,
      hora: cita ? formatTimeHuman(cita.startsAt, tz) : null,
    });
    if (!pdf) return NextResponse.json({ error: "No se pudo generar el PDF" }, { status: 500 });
    return new NextResponse(new Uint8Array(pdf.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdf.fileName}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[anticipo/solicitud-pdf] error generando el PDF:", err);
    return NextResponse.json({ error: "Error generando el PDF" }, { status: 500 });
  }
}

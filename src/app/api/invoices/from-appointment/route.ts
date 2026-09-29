import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { crearFacturaDesdeCita } from "@/lib/invoices/crear-desde-cita.server";
import { facturaOcupaLaCita } from "@/lib/invoices/cita-factura-cancelada";

export const dynamic = "force-dynamic";

const LineItemSchema = z
  .object({
    code: z.string().optional(),
    // El cliente actual (treatments-modal) manda `name`; se acepta también
    // `description` para cualquier llamador nuevo. Al PERSISTIR se normaliza
    // siempre a `description` — es el campo que lee el mapeo de conceptos del
    // CFDI, y sin él todo se timbraba como "Servicio médico".
    name: z.string().optional(),
    description: z.string().optional(),
    toothNumber: z.number().int().optional(),
    surface: z.string().optional().nullable(),
    unitPrice: z.number().nonnegative(),
    quantity: z.number().int().positive().default(1),
  })
  .refine((li) => String(li.description ?? li.name ?? "").trim().length > 0, {
    message: "Cada concepto necesita nombre o descripción",
    path: ["description"],
  });

const Schema = z.object({
  appointmentId: z.string().min(1),
  lineItems: z.array(LineItemSchema).min(1),
  discount: z.number().nonnegative().optional().default(0),
  notes: z.string().optional(),
});

/**
 * POST /api/invoices/from-appointment
 * Crea una Invoice (status PENDING) vinculada a la cita con los line items
 * confirmados por el usuario tras la consulta.
 */
export async function POST(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  // Permiso granular: loadClinicSession comprueba sesión y clínica, NO rol ni
  // permisos. Esta ruta crea una Invoice con folio propio igual que
  // POST /api/invoices, que exige "billing.create" — sin esta línea la misma
  // acción tenía una puerta con llave y otra sin ella. session.user trae
  // permissionsOverride justamente para esto.
  const deniedPerm = denyIfMissingPermission(session.user, "billing.create");
  if (deniedPerm) return deniedPerm;

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const appt = await prisma.appointment.findFirst({
    where: { id: parsed.data.appointmentId, clinicId: session.clinic.id },
    select: { id: true, patientId: true },
  });
  if (!appt) {
    return NextResponse.json({ error: "appointment_not_found" }, { status: 404 });
  }

  // Visibilidad por paciente (Ola 3 / P1-5): sus hermanas by-appointment (GET)
  // y quotes/from-appointment ya validan — sin esto, un rol con scope=clinic
  // facturaba al paciente restringido (y el 409 de abajo le filtraba
  // folio/total/saldo). 404 ANTES del 409 para no revelar nada.
  if (appt.patientId) {
    const visDenied = await assertPatientVisible(appt.patientId, {
      userId: session.user.id,
      role: session.user.role,
      clinicId: session.clinic.id,
    });
    if (visDenied) return visDenied;
  }

  // Si ya hay invoice vinculada, devolverla en lugar de duplicar.
  const existing = await prisma.invoice.findUnique({
    where: { appointmentId: appt.id },
    select: { id: true, invoiceNumber: true, total: true, balance: true, status: true },
  });
  // H1 (revisión final, ws1-t4): una factura CANCELADA no ocupa la cita —
  // `crearFacturaDesdeCita` le quita el vínculo y crea la nueva.
  if (existing && facturaOcupaLaCita(existing)) {
    return NextResponse.json(
      { error: "invoice_already_exists", invoice: existing },
      { status: 409 },
    );
  }

  // Conceptos como se PERSISTEN: `description` + importe de línea. El code /
  // diente / cara son datos clínicos útiles y viajan tal cual (el CFDI los
  // ignora, pero la ficha y el comprobante los muestran).
  const lineItems = parsed.data.lineItems.map((li) => ({
    ...(li.code ? { code: li.code } : {}),
    description: String(li.description ?? li.name ?? "").trim(),
    ...(li.toothNumber != null ? { toothNumber: li.toothNumber } : {}),
    ...(li.surface ? { surface: li.surface } : {}),
    unitPrice: li.unitPrice,
    quantity: li.quantity,
  }));

  // Misma aritmética canónica que POST /api/invoices y que la guarda del
  // timbrado (invoice-totals): subtotal = Σ round2(qty × unitPrice), NO
  // round2(Σ qty × unitPrice) — ver crearFacturaDesdeCita. Compartida con el
  // endpoint de «Pedir anticipo» (ws1-t3 fase 1), que crea la factura de la
  // cita por el mismo camino cuando todavía no existe.
  const resultado = await crearFacturaDesdeCita({
    clinicId: session.clinic.id,
    appointmentId: appt.id,
    patientId: appt.patientId,
    lineItems,
    discount: parsed.data.discount,
    notes: parsed.data.notes,
    userId: session.user.id,
  });

  if (!resultado.ok) {
    if (resultado.error === "invoice_already_exists") {
      return NextResponse.json({ error: resultado.error, invoice: resultado.existente }, { status: 409 });
    }
    if (resultado.error === "discount_exceeds_subtotal") {
      return NextResponse.json({ error: "El descuento excede el subtotal" }, { status: 400 });
    }
    if (resultado.error === "invoice_number_conflict") {
      return NextResponse.json({ error: resultado.error }, { status: 409 });
    }
    console.error("[/api/invoices/from-appointment]", resultado.reason);
    return NextResponse.json({ error: "internal_error", reason: resultado.reason }, { status: 500 });
  }

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${appt.patientId}`);
  return NextResponse.json(
    { invoice: resultado.invoice, anticipoAplicado: resultado.anticipoAplicado },
    { status: 201 },
  );
}

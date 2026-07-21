import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logAudit } from "@/lib/audit";
import { createQuoteWithFolio } from "@/lib/quotes/service";
import { serializeQuote } from "@/lib/quotes/serialize";
import type { QuoteItemInput } from "@/lib/quotes/types";

export const dynamic = "force-dynamic";

interface LineItem {
  code?: string;
  name?: string;
  toothNumber?: number | null;
  surface?: string | null;
  unitPrice?: number;
  quantity?: number;
  procedureCatalogId?: string | null;
}

/**
 * POST /api/quotes/from-appointment — crea un presupuesto DRAFT a partir de las
 * sugerencias del odontograma (mismo lineItems que /api/invoices/from-appointment).
 * Resuelve el paciente desde la cita (scoped a la clínica), así el modal no
 * necesita conocer el patientId.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { appointmentId?: string; lineItems?: LineItem[]; discount?: number; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId : "";
  if (!appointmentId) return NextResponse.json({ error: "appointmentId requerido" }, { status: 400 });

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId: ctx.clinicId },
    select: { id: true, patientId: true },
  });
  if (!appt || !appt.patientId) {
    return NextResponse.json({ error: "Cita o paciente no encontrado" }, { status: 404 });
  }

  // Visibilidad: la respuesta (serializeQuote) echa el nombre del paciente
  // resuelto desde la cita. Sin assert, un excluido lo obtiene creando el
  // presupuesto desde la cita.
  const denied = await assertPatientVisible(appt.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
  const items: QuoteItemInput[] = lineItems
    .filter((li) => li && typeof li.name === "string" && li.name.trim().length > 0)
    .map((li) => ({
      procedureId: li.procedureCatalogId ?? null,
      name: String(li.name).trim(),
      toothFdi: li.toothNumber != null ? String(li.toothNumber) : null,
      quantity: Number(li.quantity) || 1,
      unitPrice: Number(li.unitPrice) || 0,
      discount: 0,
      phase: null,
      notes: li.surface ? `Superficie ${li.surface}` : null,
    }));

  if (items.length === 0) {
    return NextResponse.json({ error: "Sin conceptos para cotizar" }, { status: 400 });
  }

  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const quote = await createQuoteWithFolio({
    clinicId: ctx.clinicId,
    patientId: appt.patientId,
    createdById: ctx.userId,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 160) : "Presupuesto",
    items,
    discountAmount: body.discount == null ? null : Number(body.discount),
    validUntil,
    notes: null,
  });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: quote.id,
    action: "create",
    changes: { fromAppointment: { before: null, after: appointmentId } },
  });

  return NextResponse.json(serializeQuote(quote), { status: 201 });
}

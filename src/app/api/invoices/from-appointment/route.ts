import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";

export const dynamic = "force-dynamic";

const LineItemSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  toothNumber: z.number().int().optional(),
  surface: z.string().optional().nullable(),
  unitPrice: z.number().nonnegative(),
  quantity: z.number().int().positive().default(1),
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

  // Si ya hay invoice vinculada, devolverla en lugar de duplicar.
  const existing = await prisma.invoice.findUnique({
    where: { appointmentId: appt.id },
    select: { id: true, invoiceNumber: true, total: true, balance: true, status: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "invoice_already_exists", invoice: existing },
      { status: 409 },
    );
  }

  const subtotal = parsed.data.lineItems.reduce(
    (s, li) => s + li.unitPrice * li.quantity,
    0,
  );
  const discount = parsed.data.discount;
  const total = Math.max(0, subtotal - discount);

  // Generación simple de invoiceNumber: INV-YYYY-#### (count + 1 en clínica).
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count({
    where: { clinicId: session.clinic.id, createdAt: { gte: new Date(year, 0, 1) } },
  });
  const invoiceNumber = `INV-${year}-${String(count + 1).padStart(4, "0")}`;

  try {
    const invoice = await prisma.invoice.create({
      data: {
        clinicId: session.clinic.id,
        patientId: appt.patientId,
        appointmentId: appt.id,
        invoiceNumber,
        items: parsed.data.lineItems as unknown as Prisma.InputJsonValue,
        subtotal,
        discount,
        total,
        balance: total,
        status: "PENDING",
        notes: parsed.data.notes ?? null,
      },
      select: {
        id: true,
        invoiceNumber: true,
        subtotal: true,
        discount: true,
        total: true,
        balance: true,
        status: true,
        appointmentId: true,
        items: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (err) {
    // Race condition: otra request creó la invoice primero (P2002 sobre
    // appointmentId @unique o invoiceNumber).
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json(
        { error: "invoice_already_exists" },
        { status: 409 },
      );
    }
    console.error("[/api/invoices/from-appointment]", err);
    return NextResponse.json(
      { error: "internal_error", reason: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

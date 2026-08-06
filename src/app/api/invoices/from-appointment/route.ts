import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { revalidateAfter } from "@/lib/cache/revalidate";
import {
  sumInvoiceItems,
  computeInvoiceTotal,
  itemLineTotal,
  clinicInvoiceTaxDefaults,
  round2,
} from "@/lib/invoice-totals";
import {
  InvoiceNumberExhaustedError,
  nextInvoiceNumber,
  withInvoiceNumberRetry,
} from "@/lib/invoices/next-invoice-number";

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

  // Conceptos como se PERSISTEN: `description` + importe de línea. El code /
  // diente / cara son datos clínicos útiles y viajan tal cual (el CFDI los
  // ignora, pero la ficha y el comprobante los muestran).
  const items = parsed.data.lineItems.map((li) => {
    const quantity = li.quantity;
    const unitPrice = round2(li.unitPrice);
    return {
      ...(li.code ? { code: li.code } : {}),
      description: String(li.description ?? li.name ?? "").trim(),
      ...(li.toothNumber != null ? { toothNumber: li.toothNumber } : {}),
      ...(li.surface ? { surface: li.surface } : {}),
      quantity,
      unitPrice,
      total: itemLineTotal({ quantity, unitPrice }),
    };
  });

  // Misma aritmética canónica que POST /api/invoices y que la guarda del
  // timbrado (invoice-totals): subtotal = Σ round2(qty × unitPrice), NO
  // round2(Σ qty × unitPrice). Con precios sub-centavo y varias líneas los dos
  // difieren en centavos y la factura nacía con un total que POST /api/cfdi
  // rechaza con 409 CFDI_TOTAL_MISMATCH.
  const subtotal = sumInvoiceItems(items);
  const discount = round2(Math.max(0, parsed.data.discount ?? 0));
  if (discount > subtotal) {
    return NextResponse.json({ error: "El descuento excede el subtotal" }, { status: 400 });
  }

  // Impuestos con los que NACE la factura, según la preferencia fiscal de la
  // clínica. Sin esto caían al default de la columna (16%, incluido) y en una
  // clínica exenta el desglose interno contradecía al CFDI. Solo la columna
  // que se necesita: la fila entera de Clinic lleva secretos.
  const clinicTax = await prisma.clinic.findUnique({
    where: { id: session.clinic.id },
    select: { cfdiTaxMode: true },
  });
  const { taxRate, taxIncluded } = clinicInvoiceTaxDefaults(clinicTax?.cfdiTaxMode);
  const { total } = computeInvoiceTotal(subtotal, discount, taxRate, taxIncluded);

  try {
    // Folio por MÁXIMO emitido con reintento ante carrera (P0-2). La serie
    // INV-YYYY-#### que emitía esta ruta se retira: era la 2ª serie paralela
    // sobre la misma columna única y su count+1 anual chocaba con la serie
    // MF-#### del resto de generadores. El folio se recalcula DENTRO de cada
    // intento; el P2002 de appointmentId NO se reintenta (cae al catch).
    const invoice = await withInvoiceNumberRetry(async () =>
      prisma.invoice.create({
        data: {
          clinicId: session.clinic.id,
          patientId: appt.patientId,
          appointmentId: appt.id,
          invoiceNumber: await nextInvoiceNumber(session.clinic.id),
          items: items as unknown as Prisma.InputJsonValue,
          subtotal,
          discount,
          total,
          balance: total,
          status: "PENDING",
          notes: parsed.data.notes ?? null,
          taxRate,
          taxIncluded,
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
      }),
    );
    revalidateAfter("invoices");
    revalidatePath(`/dashboard/patients/${appt.patientId}`);
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (err) {
    // Carrera de folio agotada (ya reintentó recalculando el máximo).
    if (err instanceof InvoiceNumberExhaustedError) {
      return NextResponse.json({ error: "invoice_number_conflict" }, { status: 409 });
    }
    // Race condition: otra request creó la invoice primero. Aquí solo llega el
    // P2002 de appointmentId @unique (el de invoiceNumber lo distingue y
    // reintenta withInvoiceNumberRetry por meta.target), así que el mensaje
    // "invoice_already_exists" por fin es verdad siempre.
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

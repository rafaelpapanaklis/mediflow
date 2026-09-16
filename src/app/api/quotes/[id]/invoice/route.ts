import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { createInvoiceFromQuote, InvoiceFolioError } from "@/lib/quotes/create-invoice-from-quote";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * POST /api/quotes/[id]/invoice — factura un presupuesto ACEPTADO. La factura
 * nace PENDIENTE, como la de POST /api/invoices: cobrable en el acto, sin
 * «confirmar» de por medio. Idempotente: si ya se generó (y sigue existiendo),
 * devuelve la misma factura sin duplicar ni cambiarle el estado. La lógica de
 * creación vive en createInvoiceFromQuote.
 *
 * Además de { invoiceId, invoiceNumber, already } devuelve `invoice` (la
 * factura serializada) para que la ficha la pinte en Facturación sin recargar.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: esta ruta EMITE una factura de verdad — createInvoiceFromQuote
  // le asigna folio de la serie de la clínica y nextInvoiceNumber va por MÁXIMO
  // emitido, no recicla ni anulando. Es exactamente lo que hace POST /api/invoices
  // por la otra puerta, y esa exige "billing.create": misma acción, misma key.
  // Cierra la tercera puerta que el PR #190 dejó señalada y sin tapar.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.create");
  if (deniedPerm) return deniedPerm;

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  // Visibilidad por paciente, la misma que exigen POST /api/invoices y
  // /confirm. Antes esta ruta no la miraba (N14) y el hueco quedaba medio
  // tapado porque su borrador había que confirmarlo por /confirm, que sí la
  // mira. Ahora emite la factura PENDIENTE directo y devuelve sus conceptos:
  // quien no puede ver al paciente no le genera deuda ni la lee.
  const denied = await assertPatientVisible(quote.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  if (quote.status !== "ACCEPTED") {
    return NextResponse.json(
      { error: "Solo se factura un presupuesto aceptado" },
      { status: 409 },
    );
  }

  try {
    const { invoice, already } = await createInvoiceFromQuote(quote, ctx);
    if (!already) {
      // Nace cobrable: entra a Facturas, Caja «por cobrar» y la ficha, igual
      // que tras POST /api/invoices.
      revalidateAfter("invoices");
      revalidatePath(`/dashboard/patients/${invoice.patientId}`);
    }
    return NextResponse.json(
      { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, already, invoice },
      { status: already ? 200 : 201 },
    );
  } catch (e) {
    if (e instanceof InvoiceFolioError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    throw e;
  }
}

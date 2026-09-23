import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";
import {
  esPagoStripe,
  filaDeRecarga,
  filaDeSpeiEnRevision,
  ordenarPorFecha,
  recibosPorPago,
  unirSuscripcion,
  whereRecargasDelSaldo,
  type BillingInvoiceRow,
  type CargoStripe,
  type FacturaStripe,
} from "@/lib/billing/historial-facturas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BillingInvoicesResponse {
  invoices: BillingInvoiceRow[];
  stripeUnavailable: boolean;
}

/**
 * GET /api/billing/invoices
 *
 * «Historial de facturas» de la clínica del usuario activo: un pago, un
 * renglón. Junta (reglas en `src/lib/billing/historial-facturas.ts`):
 *  1. Las últimas 24 facturas de Stripe (`customer = clinic.stripeCustomerId`).
 *  2. Las `subscription_invoices` locales, cruzadas con esas 24 por
 *     `reference`: cuando coinciden sale UN renglón, el de Stripe (trae el
 *     PDF), salvo que la local diga «pagada» y Stripe no.
 *  3. Las recargas de saldo IA: lo que entró al monedero según su libro mayor
 *     (pasarela o abono a mano) y las SPEI con comprobante en revisión.
 *
 * Si Stripe no está configurado (o la clínica no tiene customer), devuelve
 * locales + recargas con `stripeUnavailable: !stripe`. Si Stripe no contesta,
 * lo mismo: nunca arroja 500 por Stripe.
 *
 * Multi-tenant: clinicId de la sesión, todas las queries scoped.
 */
export async function GET() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;
  // `clinicId: undefined` no filtra nada en Prisma: sin clínica, no se consulta.
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [clinic, localRows, movimientos, speiEnRevision] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { stripeCustomerId: true },
    }),
    prisma.subscriptionInvoice.findMany({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.aiWalletTransaction.findMany({
      where: whereRecargasDelSaldo(clinicId),
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, amountCents: true, source: true, reference: true, createdAt: true },
    }),
    prisma.aiTopup.findMany({
      where: { clinicId, method: "SPEI", status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, amountCents: true, createdAt: true },
    }),
  ]);

  const stripe = getStripeSafe();
  const customerId = clinic?.stripeCustomerId ?? null;

  let facturasStripe: FacturaStripe[] = [];
  let recibos = new Map<string, string>();
  if (stripe && customerId) {
    // Los recibos solo se piden si hay alguna recarga pagada con tarjeta.
    const hayPagosConTarjeta = movimientos.some((m) => esPagoStripe(m.reference));
    const [facturas, cargos] = await Promise.allSettled([
      stripe.invoices.list({ customer: customerId, limit: 24 }),
      hayPagosConTarjeta
        ? stripe.charges.list({ customer: customerId, limit: 100 })
        : Promise.resolve(null),
    ]);
    if (facturas.status === "fulfilled") {
      facturasStripe = facturas.value.data as FacturaStripe[];
    } else {
      // Fallback silencioso a solo locales — no es razón para reventar.
      console.error("[billing/invoices] stripe list error:", facturas.reason);
    }
    if (cargos.status === "fulfilled") {
      if (cargos.value) recibos = recibosPorPago(cargos.value.data as CargoStripe[]);
    } else {
      // Sin recibos: la recarga sale igual, solo que sin botón.
      console.error("[billing/invoices] stripe charges error:", cargos.reason);
    }
  }

  const recargas: BillingInvoiceRow[] = [];
  for (const m of movimientos) {
    const fila = filaDeRecarga(m, recibos);
    if (fila) recargas.push(fila);
  }
  for (const t of speiEnRevision) recargas.push(filaDeSpeiEnRevision(t));

  const invoices = ordenarPorFecha([...unirSuscripcion(facturasStripe, localRows), ...recargas]);

  const response: BillingInvoicesResponse = {
    invoices,
    stripeUnavailable: !stripe,
  };
  return NextResponse.json(response);
}

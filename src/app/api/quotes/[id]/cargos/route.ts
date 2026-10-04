import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { aceptacionEncendida } from "@/lib/quotes/aceptacion-db";
import { InvoiceFolioError } from "@/lib/quotes/create-invoice-from-quote";
import {
  cargarDesdePresupuesto,
  cobrosDePresupuestos,
  leerEstado,
  PresupuestoError,
} from "@/lib/quotes/cargos.server";
import { leerCondiciones } from "@/lib/quotes/condiciones-pago-db";
import { calcularCalendario, esMetodoPago, hayCondiciones, METODOS_PAGO } from "@/lib/quotes/condiciones-pago";
import { CASH_METHOD } from "@/lib/caja";
import { METODO_MERCADO_PAGO } from "@/lib/factura-mp/core";
import { METODO_ANTICIPO } from "@/lib/patient-credit-core";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * Cargos de un presupuesto ACEPTADO (ws1-t6, «Se cobrará hoy»).
 *
 * GET  — lo que necesita la revisión: qué aceptó (con su precio), qué ya se
 *        cargó y en qué factura, cuánto queda, y las sugerencias de abono del
 *        plan pactado (enganche, una cuota). Lectura fresca, no la de la lista.
 * POST — { itemIds?: string[], abono?: number, abonoA?: string, metodo?, referencia?, fecha? }
 *        crea UNA factura PENDIENTE con esos conceptos. El abono (decisión de
 *        Rafael, 4-oct-2026) es un PAGO real a la factura del concepto `abonoA`
 *        (si no tiene, se crea a precio completo): pide método y, en
 *        transferencia, referencia — como «Registrar pago». Nunca carga un
 *        concepto dos veces ni pasa del total aceptado (lib/quotes/aceptacion.ts).
 *
 * Sin el SQL (sql/presupuesto-aceptacion-parcial.sql) responde 404
 * `{ apagada: true }`: la pantalla no ofrece el botón y sigue «Generar factura».
 */
async function cargar(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, id: string) {
  const quote = await prisma.quote.findFirst({
    where: { id, clinicId: ctx.clinicId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quote) return { error: NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 }) };
  const denied = await assertPatientVisible(quote.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return { error: denied };
  if (!(await aceptacionEncendida())) {
    return { error: NextResponse.json({ error: "Función no disponible", apagada: true }, { status: 404 }) };
  }
  if (quote.status !== "ACCEPTED") {
    return { error: NextResponse.json({ error: "Solo se carga un presupuesto aceptado" }, { status: 409 }) };
  }
  return { quote };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deniedPerm = denyIfMissingPermission(ctx, "billing.view");
  if (deniedPerm) return deniedPerm;

  const r = await cargar(ctx, params.id);
  if (r.error) return r.error;
  const quote = r.quote;

  const cobro = (await cobrosDePresupuestos(ctx.clinicId, [quote])).get(quote.id);
  if (!cobro) {
    return NextResponse.json({ error: "No se pudo leer qué se ha cargado. Intenta de nuevo." }, { status: 503 });
  }

  // Sugerencias del plan pactado. Solo si se aceptó TODO: el plan se calculó
  // sobre el total del presupuesto y con una aceptación parcial ya no cuadra.
  const sugerencias: Array<{ clave: "enganche" | "cuota"; monto: number }> = [];
  const { condiciones } = await leerCondiciones(prisma, quote.id);
  if (cobro.alcance === "total" && hayCondiciones(condiciones) && condiciones?.modo === "plazos") {
    const cal = calcularCalendario(cobro.totalAceptado, condiciones);
    const enganche = cal.pagos.find((p) => p.esEnganche);
    const cuota = cal.pagos.find((p) => !p.esEnganche);
    if (enganche && enganche.monto > 0 && cobro.cargos.length === 0) {
      sugerencias.push({ clave: "enganche", monto: enganche.monto });
    }
    if (cuota && cuota.monto > 0) sugerencias.push({ clave: "cuota", monto: cuota.monto });
  }

  // Renglones y cargos vivos tal cual: la pantalla corre con ellos la MISMA
  // planearCargo que el POST, así la vista previa es exactamente lo que se crea.
  let estado;
  try {
    estado = await leerEstado(prisma, ctx.clinicId, quote);
  } catch (e) {
    if (e instanceof PresupuestoError) return NextResponse.json({ error: e.message }, { status: e.http });
    throw e;
  }

  return NextResponse.json({
    renglones: estado.renglones,
    vivos: estado.vivos,
    folio: quote.folio,
    total: Number(quote.total) || 0,
    cobro,
    sugerencias: sugerencias.filter((s) => s.monto <= cobro.porCargar),
    // Lo que pinta la revisión por concepto (en el orden del presupuesto).
    conceptos: quote.items.map((it) => ({
      id: it.id,
      name: it.name,
      toothFdi: it.toothFdi,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice) || 0,
    })),
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Emite una factura con folio: la misma llave que POST /api/invoices y
  // «Generar factura» (POST /api/quotes/[id]/invoice).
  const deniedPerm = denyIfMissingPermission(ctx, "billing.create");
  if (deniedPerm) return deniedPerm;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const r = await cargar(ctx, params.id);
  if (r.error) return r.error;

  // El abono es dinero que entra HOY: las puertas de «Registrar pago».
  const abonoNum = Number(body.abono ?? 0);
  let pago: { method: string; reference: string | null; paidAt: Date; avisoDeCaja: string | null } | null = null;
  if (Number.isFinite(abonoNum) && abonoNum > 0) {
    const denegado = denyIfMissingPermission(ctx, "billing.charge");
    if (denegado) return denegado;
    const method = body.metodo;
    if (method === METODO_MERCADO_PAGO || method === METODO_ANTICIPO || !esMetodoPago(method)) {
      return NextResponse.json({ error: `Di con qué pagó el abono: ${METODOS_PAGO.join(", ")}` }, { status: 400 });
    }
    const referencia = typeof body.referencia === "string" ? body.referencia.trim() : "";
    if (method === "transfer" && !referencia) {
      return NextResponse.json({ error: "Para transferencia, escribe la referencia del depósito (clave de rastreo o folio)." }, { status: 400 });
    }
    const fecha = typeof body.fecha === "string" && body.fecha ? new Date(body.fecha) : new Date();
    const paidAt = isNaN(fecha.getTime()) ? new Date() : fecha;
    if (paidAt.getTime() > Date.now() + 60_000) return NextResponse.json({ error: "La fecha de pago no puede ser futura" }, { status: 400 });
    let avisoDeCaja: string | null = null;
    if (method === CASH_METHOD) {
      const abierta = await prisma.cashRegister.findFirst({ where: { clinicId: ctx.clinicId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true } });
      if (!abierta) avisoDeCaja = "Efectivo cobrado sin caja abierta — no entra en ningún corte";
    }
    pago = { method, reference: referencia || null, paidAt, avisoDeCaja };
  }

  try {
    const { invoice, plan, abono } = await cargarDesdePresupuesto({
      quote: r.quote,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      itemIds: body.itemIds,
      abono: body.abono,
      abonoA: body.abonoA,
      pago,
    });
    revalidateAfter("invoices");
    revalidatePath(`/dashboard/patients/${invoice.patientId}`);
    return NextResponse.json(
      { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, invoice, total: plan.total, quedaPorCargar: plan.quedaPorCargar, abono, ...(pago?.avisoDeCaja ? { warning: pago.avisoDeCaja } : {}) },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof PresupuestoError) return NextResponse.json({ error: e.message }, { status: e.http });
    if (e instanceof InvoiceFolioError) return NextResponse.json({ error: e.message }, { status: 500 });
    throw e;
  }
}

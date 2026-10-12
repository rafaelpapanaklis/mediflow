// /api/invoices/[id]/abonar — «Abonar a otra factura» (decisión de Rafael, 4-oct-2026).
//
//   GET  → las demás facturas del paciente con saldo (folio, concepto, saldo) y su
//          saldo a favor: lo que pinta la lista «Abonar a…» y si el botón se ofrece.
//   POST {amount, method, paidAt, reference, notes, destino, confirmarCobroAutomatico}
//        → cobro de dinero real sobre ESTA factura: salda su saldo, lo de más va a
//          `destino` (otra factura del paciente) y lo que todavía sobre (o todo lo
//          de más si `destino` es null) queda a favor del paciente.
//   POST {origen: "saldo", destino, amount, paidVisto}
//        → abona a `destino` desde el saldo a favor del paciente (aplicarSaldoAFavor,
//          el camino de siempre: no es dinero nuevo).
//
// Mismas puertas que el cobro de siempre (POST /api/invoices/[id]): sesión
// (clinicId de la sesión, nunca del cliente), `billing.charge` para cobrar
// (`billing.view` para leer), visibilidad por paciente, solo los métodos de pago
// válidos, ni Mercado Pago ni «anticipo» tecleado, fecha nunca futura y el freno
// del cobro doble con tarjeta.
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { round2 } from "@/lib/invoice-totals";
import { CASH_METHOD } from "@/lib/caja";
import { esMetodoPago, METODOS_PAGO } from "@/lib/quotes/condiciones-pago";
import { METODO_MERCADO_PAGO } from "@/lib/factura-mp/core";
import { METODO_ANTICIPO } from "@/lib/patient-credit-core";
import { getPatientCreditBalance } from "@/lib/patient-credit";
import { aplicarSaldoAFavor } from "@/lib/patient-credit-aplicar";
import { montoParaTexto } from "@/lib/movimientos-paciente/textos";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { cerrarAnticiposDePanel } from "@/lib/anticipos/panel.server";
import { CODIGO_YA_COBRADO, frenoCobroDoble } from "@/lib/cobro-automatico/servicio.server";
import { abonablesDelPaciente, cobrarConAbono } from "@/lib/dinero/abono.server";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

async function contexto(invoiceId: string, permiso: "billing.view" | "billing.charge") {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const denied = denyIfMissingPermission(ctx, permiso);
  if (denied) return { error: denied };
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, clinicId: ctx.clinicId },
    select: { id: true, patientId: true, invoiceNumber: true },
  });
  if (!inv) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (inv.patientId) {
    const oculto = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (oculto) return { error: oculto };
  }
  return { ctx: { clinicId: ctx.clinicId as string, userId: ctx.userId as string }, inv };
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const c = await contexto(params.id, "billing.view");
  if ("error" in c) return c.error;
  if (!c.inv.patientId) return NextResponse.json({ abonables: [], saldoAFavor: 0 }, { headers: SIN_CACHE });
  const [abonables, saldo] = await Promise.all([
    abonablesDelPaciente(c.ctx.clinicId, c.inv.patientId, params.id),
    getPatientCreditBalance(c.ctx.clinicId, c.inv.patientId),
  ]);
  return NextResponse.json({ abonables, saldoAFavor: round2(Math.max(0, saldo)) }, { headers: SIN_CACHE });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const c = await contexto(params.id, "billing.charge");
  if ("error" in c) return c.error;
  const { clinicId, userId } = c.ctx;
  const body = await req.json().catch(() => ({}));
  const destinoId = typeof body?.destino === "string" && body.destino.trim() ? body.destino.trim() : null;

  // ── Desde el saldo a favor ─────────────────────────────────────────────
  if (body?.origen === "saldo") {
    if (!destinoId) return NextResponse.json({ error: "Elige la factura a la que se abona" }, { status: 400 });
    const tope = round2(Number(body.amount));
    if (!(Number.isFinite(tope) && tope > 0)) return NextResponse.json({ error: "El monto a abonar debe ser mayor a 0" }, { status: 400 });
    const paidVisto = body.paidVisto;
    if (typeof paidVisto !== "number" || !Number.isFinite(paidVisto) || paidVisto < 0) {
      return NextResponse.json({ error: "Vuelve a abrir la factura para abonar desde el saldo a favor." }, { status: 400 });
    }
    const destino = await prisma.invoice.findFirst({ where: { id: destinoId, clinicId }, select: { id: true, patientId: true, invoiceNumber: true } });
    if (!destino || destino.patientId !== c.inv.patientId) {
      return NextResponse.json({ error: "Solo se abona a otra factura del MISMO paciente" }, { status: 400 });
    }
    const r = await aplicarSaldoAFavor({ clinicId, invoiceId: destino.id, userId, origen: "cobro", tope, paidVisto });
    if (!(r.aplicado > 0)) {
      return NextResponse.json({ error: `No se abonó: ${r.motivo ?? "no hay saldo a favor que aplicar"}.`, motivo: r.motivo }, { status: 409 });
    }
    await logMutation({
      patientId: destino.patientId,
      texto: `Abonó ${montoParaTexto(r.aplicado)} de saldo a favor a la factura ${destino.invoiceNumber}`,
      req, clinicId, userId,
      entityType: "invoice", entityId: destino.id, action: "update",
      before: { saldoAFavor: r.restanteAFavor !== null ? round2(r.restanteAFavor + r.aplicado) : null },
      after: { saldoAFavor: r.restanteAFavor, anticipoAplicado: r.aplicado, ...(r.factura ?? {}) },
    });
    await cerrarLinksDeFactura({ clinicId, invoiceId: destino.id });
    await cerrarAnticiposDePanel({ clinicId, invoiceId: destino.id });
    revalidateAfter("invoices");
    if (destino.patientId) revalidatePath(`/dashboard/patients/${destino.patientId}`);
    return NextResponse.json({ ok: true, aplicado: r.aplicado, restanteAFavor: r.restanteAFavor }, { headers: SIN_CACHE });
  }

  // ── Cobro de dinero real con abono ─────────────────────────────────────
  const { amount: rawAmount, method, reference, notes, paidAt, confirmarCobroAutomatico } = body ?? {};
  if (method === METODO_MERCADO_PAGO) {
    return NextResponse.json({ error: "Los pagos de Mercado Pago se registran solos al acreditarse. Comparte el link de pago de la factura." }, { status: 400 });
  }
  if (method === METODO_ANTICIPO) {
    return NextResponse.json({ error: "El saldo a favor se abona con «Desde su saldo a favor»; registra el pago con su método real" }, { status: 400 });
  }
  if (!esMetodoPago(method)) {
    return NextResponse.json({ error: `Método de pago inválido. Usa uno de: ${METODOS_PAGO.join(", ")}` }, { status: 400 });
  }
  const amount = round2(Number(rawAmount));
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El monto debe ser mayor a 0" }, { status: 400 });
  // Transferencia sin referencia no (C-15: la regla del cobro y del anticipo).
  if (method === "transfer" && !(typeof reference === "string" && reference.trim())) {
    return NextResponse.json({ error: "Para transferencia, escribe la referencia del depósito (clave de rastreo o folio)." }, { status: 400 });
  }
  const fecha = paidAt ? new Date(paidAt) : null;
  const paidAtValido = fecha && !isNaN(fecha.getTime()) ? fecha : new Date();
  if (paidAtValido.getTime() > Date.now() + 60_000) {
    return NextResponse.json({ error: "La fecha de pago no puede ser futura" }, { status: 400 });
  }
  // El freno del cobro doble con tarjeta, como el cobro de siempre (sobre esta factura).
  const frenoMp = await frenoCobroDoble({ clinicId, invoiceId: params.id, monto: amount, confirmado: confirmarCobroAutomatico === true });
  if (frenoMp.bloquear) return NextResponse.json({ error: frenoMp.texto, code: CODIGO_YA_COBRADO }, { status: 409 });

  let avisoDeCaja: string | null = null;
  if (method === CASH_METHOD) {
    const abierta = await prisma.cashRegister.findFirst({ where: { clinicId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true } });
    if (!abierta) avisoDeCaja = "Efectivo cobrado sin caja abierta — no entra en ningún corte";
  }

  const r = await cobrarConAbono({
    clinicId,
    userId,
    invoiceId: params.id,
    destinoId,
    amount,
    method,
    paidAt: paidAtValido,
    reference: typeof reference === "string" && reference.trim() ? reference.trim() : null,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    avisoDeCaja,
  });
  // `in`, no `!r.ok`: con strict:false TypeScript no estrecha la unión por el booleano.
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  for (const f of r.facturas) {
    const esLaCobrada = f.invoiceId === params.id;
    await logMutation({
      patientId: r.patientId,
      texto: esLaCobrada
        ? `Registró un pago de ${montoParaTexto(f.monto)} en la factura ${f.invoiceNumber}` +
          (r.reparto.excedente > 0 ? ` (cobro de ${montoParaTexto(amount)}; lo de más, abonado o a favor)` : "")
        : `Abonó ${montoParaTexto(f.monto)} a la factura ${f.invoiceNumber} (parte del cobro de ${montoParaTexto(amount)} en la factura ${r.folioCobrada})`,
      req, clinicId, userId,
      entityType: "invoice", entityId: f.invoiceId, action: "update",
      before: f.antes,
      after: { ...f.despues, payment: { amount: f.monto, method, cobro: r.cobroId }, ...(avisoDeCaja ? { cashWarning: avisoDeCaja } : {}) },
    });
  }
  if (r.reparto.aFavor > 0) {
    await logMutation({
      patientId: r.patientId,
      texto: `Quedaron ${montoParaTexto(r.reparto.aFavor)} a favor del paciente (pagó de más en la factura ${r.folioCobrada})`,
      req, clinicId, userId,
      entityType: "invoice", entityId: params.id, action: "update",
      before: { saldoAFavorGenerado: 0 },
      after: { saldoAFavorGenerado: r.reparto.aFavor, cobro: r.cobroId },
    });
  }
  for (const f of r.facturas) {
    await cerrarLinksDeFactura({ clinicId, invoiceId: f.invoiceId });
    await cerrarAnticiposDePanel({ clinicId, invoiceId: f.invoiceId });
  }
  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${r.patientId}`);
  return NextResponse.json(
    { ok: true, cobro: r.cobroId, reparto: r.reparto, folioDestino: r.folioDestino, ...(avisoDeCaja ? { warning: avisoDeCaja } : {}) },
    { headers: SIN_CACHE },
  );
}

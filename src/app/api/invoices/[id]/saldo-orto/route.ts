// /api/invoices/[id]/saldo-orto — saldo a favor en el cobro de ORTODONCIA (ws1-t4).
//
//   GET  → ¿la factura es de un caso de ortodoncia? saldo a favor del paciente
//          (la cifra de su resumen), si se puede usar aquí y las demás
//          facturas del caso por cobrar (a dónde iría un adelanto). Fuera de
//          ortodoncia `caso: null` y la ventana de cobro no cambia.
//   POST {accion:"usar-saldo", tope}      → «Usar saldo a favor» (el camino de
//          siempre: aplicarSaldoAFavor, origen «cobro»). No es un cobro nuevo.
//   POST {accion:"adelanto", amount, method, paidAt, reference, notes} → cobro
//          por MÁS que el saldo de la factura: lo de más a las siguientes
//          facturas del caso por vencimiento y lo que sobre, a favor.
//
// Mismas puertas que POST /api/invoices/[id]: sesión (clinicId de la sesión,
// nunca del cliente), `billing.charge` para escribir (`billing.view` para
// leer), visibilidad por paciente, métodos de pago válidos, nada de Mercado
// Pago ni «anticipo» tecleado, fecha nunca futura.
//
// Lógica: src/lib/orthodontics/saldo-a-favor/.
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
import { montoParaTexto } from "@/lib/movimientos-paciente/textos";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { cerrarAnticiposDePanel } from "@/lib/anticipos/panel.server";
import {
  casoDeLaFactura,
  cobrarConAdelanto,
  facturasPorCobrarDelCaso,
  infoDeSaldoOrto,
  usarSaldoAFavorAlCobrar,
} from "@/lib/orthodontics/saldo-a-favor/saldo-orto.server";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

async function contexto(req: NextRequest, invoiceId: string, permiso: "billing.view" | "billing.charge") {
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

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await contexto(req, params.id, "billing.view");
  if ("error" in c) return c.error;
  const info = await infoDeSaldoOrto(c.ctx.clinicId, params.id);
  return NextResponse.json(info, { headers: SIN_CACHE });
}

function faltaSql(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022";
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await contexto(req, params.id, "billing.charge");
  if ("error" in c) return c.error;
  const { clinicId, userId } = c.ctx;
  const body = await req.json().catch(() => ({}));

  // ── «Usar saldo a favor» ────────────────────────────────────────────────
  if (body?.accion === "usar-saldo") {
    const tope = body.tope === undefined || body.tope === null ? null : round2(Number(body.tope));
    if (tope !== null && !(Number.isFinite(tope) && tope > 0)) {
      return NextResponse.json({ error: "El monto a cubrir con saldo a favor debe ser mayor a 0" }, { status: 400 });
    }
    // Lo pagado que veía la pantalla: sin él no se aplica (un reintento a ciegas podría gastar dos veces).
    const paidVisto = body.paidVisto;
    if (typeof paidVisto !== "number" || !Number.isFinite(paidVisto) || paidVisto < 0) {
      return NextResponse.json({ error: "Vuelve a abrir la factura para usar el saldo a favor." }, { status: 400 });
    }
    const r = await usarSaldoAFavorAlCobrar({ clinicId, invoiceId: params.id, userId, tope, paidVisto });
    if (!(r.aplicado > 0)) {
      return NextResponse.json({ error: `No se aplicó saldo a favor: ${r.motivo ?? "nada que aplicar"}.`, motivo: r.motivo }, { status: 409 });
    }
    await logMutation({
      patientId: c.inv.patientId,
      texto: `Usó ${montoParaTexto(r.aplicado)} de saldo a favor en la factura ${c.inv.invoiceNumber}`,
      req,
      clinicId,
      userId,
      entityType: "invoice",
      entityId: params.id,
      action: "update",
      before: { saldoAFavor: r.restanteAFavor !== null ? round2(r.restanteAFavor + r.aplicado) : null },
      after: { saldoAFavor: r.restanteAFavor, anticipoAplicado: r.aplicado, ...(r.factura ?? {}) },
    });
    await cerrarLinksDeFactura({ clinicId, invoiceId: params.id });
    await cerrarAnticiposDePanel({ clinicId, invoiceId: params.id });
    revalidateAfter("invoices");
    if (c.inv.patientId) revalidatePath(`/dashboard/patients/${c.inv.patientId}`);
    return NextResponse.json({ ok: true, aplicado: r.aplicado, restanteAFavor: r.restanteAFavor, factura: r.factura }, { headers: SIN_CACHE });
  }

  // ── Cobro con adelanto ──────────────────────────────────────────────────
  if (body?.accion === "adelanto") {
    const { amount: rawAmount, method, reference, notes, paidAt } = body;
    if (method === METODO_MERCADO_PAGO) {
      return NextResponse.json({ error: "Los pagos de Mercado Pago se registran solos al acreditarse. Comparte el link de pago de la factura." }, { status: 400 });
    }
    if (method === METODO_ANTICIPO) {
      return NextResponse.json({ error: "El saldo a favor se usa con «Usar saldo a favor»; registra el pago con su método real" }, { status: 400 });
    }
    if (!esMetodoPago(method)) {
      return NextResponse.json({ error: `Método de pago inválido. Usa uno de: ${METODOS_PAGO.join(", ")}` }, { status: 400 });
    }
    const amount = round2(Number(rawAmount));
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El monto debe ser mayor a 0" }, { status: 400 });
    const fecha = paidAt ? new Date(paidAt) : null;
    const paidAtValido = fecha && !isNaN(fecha.getTime()) ? fecha : new Date();
    if (paidAtValido.getTime() > Date.now() + 60_000) {
      return NextResponse.json({ error: "La fecha de pago no puede ser futura" }, { status: 400 });
    }

    const caso = await casoDeLaFactura(clinicId, params.id);
    if (!caso) {
      // Fuera de ortodoncia no hay adelanto: el cobro de siempre (que no deja pagar de más).
      return NextResponse.json({ error: "El monto excede el saldo pendiente" }, { status: 400 });
    }
    const otras = (await facturasPorCobrarDelCaso(clinicId, caso)).filter((f) => f.invoiceId !== params.id);
    let avisoDeCaja: string | null = null;
    if (method === CASH_METHOD) {
      const abierta = await prisma.cashRegister.findFirst({ where: { clinicId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true } });
      if (!abierta) avisoDeCaja = "Efectivo cobrado sin caja abierta — no entra en ningún corte";
    }

    let r;
    try {
      r = await cobrarConAdelanto({
        clinicId,
        userId,
        invoiceId: params.id,
        patientId: caso.patientId,
        otras,
        amount,
        method,
        paidAt: paidAtValido,
        reference: typeof reference === "string" && reference.trim() ? reference.trim() : null,
        notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
        avisoDeCaja,
      });
    } catch (e) {
      if (faltaSql(e)) {
        return NextResponse.json({ error: "Falta aplicar sql/anticipo-aplicado-a-factura.sql: no se registró nada." }, { status: 409 });
      }
      throw e;
    }
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

    for (const f of r.facturas) {
      await logMutation({
        patientId: caso.patientId,
        texto:
          f.invoiceId === params.id
            ? `Registró un pago de ${montoParaTexto(amount)} en la factura ${f.invoiceNumber}` +
              (r.reparto.excedente > 0 ? ` (${montoParaTexto(r.reparto.excedente)} de adelanto)` : "")
            : `Abonó ${montoParaTexto(f.monto)} de adelanto a la factura ${f.invoiceNumber}`,
        req,
        clinicId,
        userId,
        entityType: "invoice",
        entityId: f.invoiceId,
        action: "update",
        before: f.antes,
        after: { ...f.despues, payment: { amount: f.monto, method }, ...(avisoDeCaja ? { cashWarning: avisoDeCaja } : {}) },
      });
    }
    if (r.aFavor > 0) {
      await logMutation({
        patientId: caso.patientId,
        texto: `Quedaron ${montoParaTexto(r.aFavor)} a favor del paciente (pagó de más en ortodoncia)`,
        req,
        clinicId,
        userId,
        entityType: "invoice",
        entityId: params.id,
        action: "update",
        before: { saldoAFavorGenerado: 0 },
        after: { saldoAFavorGenerado: r.aFavor },
      });
    }
    for (const f of r.facturas) {
      await cerrarLinksDeFactura({ clinicId, invoiceId: f.invoiceId });
      await cerrarAnticiposDePanel({ clinicId, invoiceId: f.invoiceId });
    }
    revalidateAfter("invoices");
    revalidatePath(`/dashboard/patients/${caso.patientId}`);
    return NextResponse.json(
      {
        ok: true,
        partes: r.reparto.partes,
        aFavor: r.aFavor,
        ...(avisoDeCaja ? { warning: avisoDeCaja } : {}),
      },
      { headers: SIN_CACHE },
    );
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}

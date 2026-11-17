// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — LO QUE LA BARBERÍA LE PAGA A DALECONTROL, para su
// ficha en /admin/barberias/[id] (ws6-t1, 16-nov-2026).
//
// Rafael: «en admin en cada barbería debo poder ver cuántos clientes tiene,
// facturas pagadas, dinero etc. así como en dental». El dental lo enseña en
// la pestaña «Facturación» de la clínica: «Total cobrado», «Pagos
// registrados», «Último pago» (subscription_invoices con estado «paid»).
// Aquí es lo mismo, con el registro de cobros de barber
// (sql/barber_cobros.sql): una fila por factura de Stripe de la suscripción,
// pagada o rechazada, y los términos que Stripe cobra HOY.
//
// Puro: sin prisma ni "server-only" (se prueba con tsx). La lectura vive en
// admin-pagos.ts. El dinero viaja como string decimal ("749.00"), igual que
// el resto de /admin/barberias: solo shared.ts → formatMoney lo pinta.
// ═══════════════════════════════════════════════════════════════════════
import {
  mensualDesdeCentavos,
  pesosDesdeCentavos,
  type BarberCobroInterval,
} from "@/lib/barber/cobros-core";

/** Cuántos pagos se listan en la ficha (el total y los conteos son de TODOS). */
export const PAGOS_EN_FICHA = 24;

/** Una fila de barber_subscription_payments tal cual llega de la base. */
export interface FilaPago {
  stripe_invoice_id: string;
  status: string;
  amount_cents: number | bigint;
  currency: string | null;
  plan_id: string | null;
  billing_interval: string | null;
  period_start: Date | null;
  period_end: Date | null;
  paid_at: Date | null;
  failure_code: string | null;
  created_at: Date;
}

/** Conteos de TODOS los cobros de la matriz (no solo los listados). */
export interface FilaTotales {
  pagados: number | bigint;
  fallidos: number | bigint;
  total_cents: number | bigint | null;
  pagado_hasta: Date | null;
  ultimo_pago_at: Date | null;
  ultimo_pago_cents: number | bigint | null;
  // barber_subscriptions (lo que Stripe cobra HOY); null = sin fila.
  price_cents: number | null;
  sub_interval: string | null;
  stripe_status: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean | null;
  manual_access_at: Date | null;
  tiene_terminos: boolean;
}

export interface PagoDTO {
  /** in_… de Stripe: con él se abre el recibo (GET …/recibo?factura=). */
  invoiceId: string;
  estado: "paid" | "failed";
  /** Lo cobrado (pagado) o lo que se intentó cobrar (rechazado), en pesos. */
  monto: string;
  moneda: string;
  /** Cuándo se pagó; en un rechazo, cuándo se registró. */
  fecha: string;
  periodoDesde: string | null;
  periodoHasta: string | null;
  plan: string | null;
  ciclo: BarberCobroInterval | null;
  motivo: string | null;
}

export interface TerminosDTO {
  /** Lo que cobra Stripe por ciclo, en pesos. */
  importe: string | null;
  /** Lo mismo llevado al mes (anual ÷ 12). */
  mensual: string | null;
  ciclo: BarberCobroInterval | null;
  estadoStripe: string | null;
  cancelaAlFinal: boolean;
  /** Reactivada a mano desde /admin (cortesía hasta el siguiente cobro). */
  cortesiaDesde: string | null;
}

export interface PagosBarberiaDTO {
  /** false = sql/barber_cobros.sql sin pegar: la ficha lo dice y no inventa ceros. */
  disponible: boolean;
  /** La matriz, que es quien paga (una sucursal no tiene cobros propios). */
  pagaId: string;
  esSucursal: boolean;
  terminos: TerminosDTO | null;
  /** Fin del periodo vigente según Stripe; sin términos, el «pagado hasta» de los cobros. */
  proximaRenovacion: string | null;
  totalCobrado: string;
  pagados: number;
  fallidos: number;
  ultimoPago: { fecha: string; monto: string } | null;
  pagos: PagoDTO[];
  /** Hay más cobros que los listados. */
  hayMas: boolean;
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const n = (v: number | bigint | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const ciclo = (v: string | null | undefined): BarberCobroInterval | null =>
  v === "year" ? "year" : v === "month" ? "month" : null;

/** Sin tablas: todo «sin dato», nunca $0 inventado como si se hubiera medido. */
export function pagosNoDisponibles(pagaId: string, esSucursal: boolean): PagosBarberiaDTO {
  return {
    disponible: false,
    pagaId,
    esSucursal,
    terminos: null,
    proximaRenovacion: null,
    totalCobrado: "0.00",
    pagados: 0,
    fallidos: 0,
    ultimoPago: null,
    pagos: [],
    hayMas: false,
  };
}

/** Filas de la base → lo que pinta la ficha. */
export function resumirPagos(args: {
  pagaId: string;
  esSucursal: boolean;
  filas: FilaPago[];
  totales: FilaTotales | null;
  limite?: number;
}): PagosBarberiaDTO {
  const limite = args.limite ?? PAGOS_EN_FICHA;
  const t = args.totales;
  const pagos: PagoDTO[] = args.filas.slice(0, limite).map((f) => ({
    invoiceId: f.stripe_invoice_id,
    estado: f.status === "paid" ? "paid" : "failed",
    monto: pesosDesdeCentavos(f.amount_cents).toFixed(2),
    moneda: (f.currency || "mxn").toUpperCase(),
    fecha: (iso(f.paid_at) ?? iso(f.created_at)) as string,
    periodoDesde: iso(f.period_start),
    periodoHasta: iso(f.period_end),
    plan: f.plan_id,
    ciclo: ciclo(f.billing_interval),
    motivo: f.status === "paid" ? null : f.failure_code,
  }));

  const conTerminos = Boolean(t?.tiene_terminos);
  const intervalo = ciclo(t?.sub_interval);
  const terminos: TerminosDTO | null = conTerminos
    ? {
        importe: t!.price_cents === null ? null : pesosDesdeCentavos(t!.price_cents).toFixed(2),
        mensual: t!.price_cents === null ? null : mensualDesdeCentavos(Number(t!.price_cents), intervalo).toFixed(2),
        ciclo: intervalo,
        estadoStripe: t!.stripe_status,
        cancelaAlFinal: Boolean(t!.cancel_at_period_end),
        cortesiaDesde: iso(t!.manual_access_at),
      }
    : null;

  const pagados = n(t?.pagados);
  return {
    disponible: true,
    pagaId: args.pagaId,
    esSucursal: args.esSucursal,
    terminos,
    proximaRenovacion: iso(t?.current_period_end) ?? iso(t?.pagado_hasta),
    totalCobrado: pesosDesdeCentavos(BigInt(n(t?.total_cents))).toFixed(2),
    pagados,
    fallidos: n(t?.fallidos),
    ultimoPago:
      t?.ultimo_pago_at && t.ultimo_pago_cents !== null
        ? { fecha: iso(t.ultimo_pago_at) as string, monto: pesosDesdeCentavos(t.ultimo_pago_cents).toFixed(2) }
        : null,
    pagos,
    hayMas: pagados + n(t?.fallidos) > pagos.length,
  };
}

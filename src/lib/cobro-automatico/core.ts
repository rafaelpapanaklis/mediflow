// ═══════════════════════════════════════════════════════════════════════════
// COBRO AUTOMÁTICO CON TARJETA (ws1-t6, mejora 9 de la auditoría BEVADENT) —
// la parte PURA: sin Prisma, sin red, sin `Date.now()` implícito.
//
// Qué es: una SUSCRIPCIÓN de Mercado Pago (`/preapproval`, «suscripción sin
// plan asociado, con pago pendiente») en la cuenta de la CLÍNICA, por la
// mensualidad de una factura a plazos. El paciente registra su tarjeta EN
// Mercado Pago (el link `init_point`); nosotros nunca vemos ni guardamos la
// tarjeta. Cada cobro que MP hace es un «authorized payment» (`/authorized_payments`).
//
// Decisión de Rafael: por defecto TODO es manual. Esto existe solo si la clínica
// enciende su interruptor y alguien pulsa «Activar cobro automático» en un caso.
//
// El dinero sigue viviendo donde siempre (decisión 1 de ortodoncia): en la
// factura a plazos y sus `payments`. La mensualidad «que corresponde» a un cobro
// la decide la cascada de `estadoDelPlan` (lib/invoices/plan-de-pagos.ts), como
// cualquier otro abono: aquí no se guarda «cuota 7 pagada» en ningún sitio.
//
// Campos de Mercado Pago (doc oficial MX, «Suscripciones sin plan asociado →
// Con pago pendiente», y `src/clients/preApproval` + `src/clients/invoice` de
// mercadopago/sdk-nodejs): `reason`, `external_reference`, `payer_email`
// (REQUERIDO), `auto_recurring.{frequency, frequency_type, start_date,
// end_date, transaction_amount, currency_id}`, `back_url`, `status: "pending"`.
// Al actualizar solo se pueden cambiar `auto_recurring.{transaction_amount,
// currency_id}` y `status` (`authorized` · `paused` · `cancelled`).
// ═══════════════════════════════════════════════════════════════════════════

import { aCentavos, aPesos, type CondicionesPago, type FrecuenciaPago } from "@/lib/quotes/condiciones-pago";
import { calendarioDeCuotas, esPlanAPlazos, estadoDelPlan, type CuotaConEstado } from "@/lib/invoices/plan-de-pagos";

/** Menos que esto no se cobra en línea (el mismo mínimo que el link de factura). */
export const MINIMO_COBRO_MXN = 10;

/** Método con el que se registra el Payment: el mismo de todo lo que entra por Mercado Pago. */
export const METODO_MERCADO_PAGO = "mercadopago";

/** `external_reference` de la suscripción: así se reconoce en MP y en el webhook. */
export function refDeCobro(cobroId: string): string {
  return `cobroauto:${cobroId}`;
}

export function cobroDeRef(ref: string | null | undefined): string | null {
  const m = /^cobroauto:([A-Za-z0-9_-]{1,64})$/.exec((ref ?? "").trim());
  return m ? m[1] : null;
}

/* ── Estados ──────────────────────────────────────────────────────────── */

/**
 * Los de Mercado Pago, tal cual (`pending` · `authorized` · `paused` ·
 * `cancelled`), más `creating`: la fila existe pero MP todavía no contestó (si
 * MP falla, la fila se borra en la misma transacción y nunca se ve).
 */
export type EstadoCobro = "creating" | "pending" | "authorized" | "paused" | "cancelled";

export const ESTADOS_VIVOS: readonly EstadoCobro[] = ["creating", "pending", "authorized", "paused"];

export function normalizarEstado(v: unknown): EstadoCobro {
  return v === "creating" || v === "pending" || v === "authorized" || v === "paused" || v === "cancelled" ? v : "pending";
}

export function estaVivo(e: EstadoCobro): boolean {
  return ESTADOS_VIVOS.includes(e);
}

/* ── Frecuencia ───────────────────────────────────────────────────────── */

/**
 * La frecuencia del plan en el idioma de MP. Exacta: el calendario de la factura
 * suma 7 días (semanal), 14 (catorcenal) o un mes de calendario
 * (`sumarPeriodos` de condiciones-pago.ts), y MP admite `days` y `months`.
 */
export function frecuenciaMp(f: FrecuenciaPago): { frequency: number; frequency_type: "days" | "months" } {
  if (f === "WEEKLY") return { frequency: 7, frequency_type: "days" };
  if (f === "BIWEEKLY") return { frequency: 14, frequency_type: "days" };
  return { frequency: 1, frequency_type: "months" };
}

/* ── El plan a cobrar ─────────────────────────────────────────────────── */

export type MotivoSinCobro =
  | "no_a_plazos"
  | "sin_fechas"
  | "sin_cuotas_futuras"
  | "saldada"
  | "cancelada"
  | "bajo_minimo";

export interface PlanDeCobro {
  /** Lo que MP cobra cada periodo, en pesos (centavos exactos). */
  monto: number;
  /** Día del primer cobro, "YYYY-MM-DD" (la fecha de la siguiente mensualidad). */
  inicio: string;
  /** Día de la última mensualidad del plan, "YYYY-MM-DD". */
  fin: string;
  frecuencia: FrecuenciaPago;
  /** La cuota con la que arranca: «mensualidad 7 de 24». */
  cuotaInicial: number;
  totalCuotas: number;
  /** Lo que falta del plan entero, en pesos. */
  pendiente: number;
}

export interface EntradaPlan {
  condiciones: CondicionesPago | null;
  total: number;
  pagado: number;
  estadoFactura: string;
  /** "YYYY-MM-DD" en la zona de la clínica. */
  hoy: string;
}

/**
 * Qué se le pediría a Mercado Pago HOY para esta factura, o por qué no.
 *
 * · Monto = el importe de la siguiente mensualidad del calendario (la que vence
 *   después de hoy y todavía debe algo), nunca más de lo que falta del plan.
 *   Es el número que el paciente firmó en su convenio.
 * · Inicio = la fecha de esa mensualidad. Estrictamente DESPUÉS de hoy: lo
 *   vencido no se cobra solo, se queda para cobro manual (lo conservador).
 * · Fin = la fecha de la última mensualidad.
 */
export function planDeCobro(e: EntradaPlan): { plan: PlanDeCobro | null; motivo: MotivoSinCobro | null } {
  if (e.estadoFactura === "CANCELLED") return { plan: null, motivo: "cancelada" };
  if (!esPlanAPlazos(e.condiciones)) return { plan: null, motivo: "no_a_plazos" };
  const cuotas = calendarioDeCuotas(e.condiciones, e.total);
  const regulares = cuotas.filter((q) => !q.esEnganche);
  if (regulares.length === 0) return { plan: null, motivo: "no_a_plazos" };
  if (regulares.some((q) => !q.vencimiento)) return { plan: null, motivo: "sin_fechas" };

  const estado = estadoDelPlan(cuotas, [{ importe: e.pagado }], e.hoy);
  const pendienteC = aCentavos(estado.pendiente);
  if (pendienteC <= 0) return { plan: null, motivo: "saldada" };

  const conEstado = estado.cuotas.filter((q) => !q.esEnganche);
  const siguiente = conEstado.find((q) => (q.vencimiento as string) > e.hoy && aCentavos(q.falta) > 0) ?? null;
  if (!siguiente) return { plan: null, motivo: "sin_cuotas_futuras" };

  const montoC = Math.min(aCentavos(siguiente.importe), pendienteC);
  if (montoC < aCentavos(MINIMO_COBRO_MXN)) return { plan: null, motivo: "bajo_minimo" };

  return {
    plan: {
      monto: aPesos(montoC),
      inicio: siguiente.vencimiento as string,
      fin: regulares[regulares.length - 1].vencimiento as string,
      frecuencia: (e.condiciones as CondicionesPago).frecuencia,
      cuotaInicial: siguiente.numero,
      totalCuotas: regulares.length,
      pendiente: aPesos(pendienteC),
    },
    motivo: null,
  };
}

/**
 * La cuota a la que la cascada le acaba de abonar un cobro: la más vieja que
 * todavía debía algo ANTES del cobro. Solo para el texto («mensualidad 7 de 24»).
 */
export function cuotaQueCubre(
  condiciones: CondicionesPago | null,
  total: number,
  pagadoAntes: number,
  hoy: string,
): { numero: number; de: number } | null {
  const cuotas = calendarioDeCuotas(condiciones, total);
  if (cuotas.length === 0) return null;
  const estado = estadoDelPlan(cuotas, [{ importe: pagadoAntes }], hoy);
  const actual: CuotaConEstado | null = estado.cuotaActual;
  if (!actual || actual.esEnganche) return null;
  return { numero: actual.numero, de: estado.totalCuotas };
}

/* ── Qué hacer con una suscripción viva cuando cambia la factura ─────── */

export type Ajuste =
  | { accion: "nada" }
  | { accion: "monto"; monto: number }
  | { accion: "cancelar"; motivo: string };

/** Por qué se cancela sola, en palabras para el equipo. */
export const TEXTO_CANCELACION: Record<MotivoSinCobro | "caso_cerrado", string> = {
  saldada: "La factura quedó pagada.",
  cancelada: "La factura se canceló.",
  no_a_plazos: "La factura dejó de ser a plazos.",
  sin_fechas: "El plan de pago ya no tiene fechas.",
  sin_cuotas_futuras: "Ya no quedan mensualidades por venir.",
  bajo_minimo: `Lo que falta es menor al mínimo para cobrar en línea ($${MINIMO_COBRO_MXN} MXN).`,
  caso_cerrado: "El caso se terminó o se dio de baja.",
};

/**
 * Compara lo que MP cobra con lo que la factura dice hoy.
 *
 * · Factura saldada, cancelada, sin mensualidades por venir, o caso cerrado →
 *   cancelar (que MP no cobre ni un peso más).
 * · Monto distinto (descuento, cambio de plan, últimas mensualidades) → monto.
 * · Una suscripción en `creating` o ya cancelada no se toca.
 */
export function ajusteNecesario(a: {
  estado: EstadoCobro;
  montoActual: number;
  plan: { plan: PlanDeCobro | null; motivo: MotivoSinCobro | null };
  casoCerrado: boolean;
}): Ajuste {
  if (a.estado === "creating" || a.estado === "cancelled") return { accion: "nada" };
  if (a.casoCerrado) return { accion: "cancelar", motivo: TEXTO_CANCELACION.caso_cerrado };
  if (!a.plan.plan) return { accion: "cancelar", motivo: TEXTO_CANCELACION[a.plan.motivo ?? "saldada"] };
  if (aCentavos(a.plan.plan.monto) !== aCentavos(a.montoActual)) return { accion: "monto", monto: a.plan.plan.monto };
  return { accion: "nada" };
}

/** Estados del caso de ortodoncia con los que ya no se cobra solo. */
export function casoCerrado(status: string | null | undefined): boolean {
  return status === "COMPLETED" || status === "DROPPED_OUT";
}

/* ── Un cobro de MP (authorized payment) ─────────────────────────────── */

/** Lo que nos importa de `GET /authorized_payments/{id}` (InvoiceResponse del SDK). */
export interface CobroMp {
  id: string;
  preapprovalId: string | null;
  /** scheduled · processed · recycling · cancelled (doc «con pago autorizado»). */
  status: string | null;
  /** El pago que intentó: approved · rejected · in_process… */
  paymentId: string | null;
  paymentStatus: string | null;
  paymentStatusDetail: string | null;
  transactionAmount: number | null;
  currencyId: string | null;
  debitDate: string | null;
  retryAttempt: number | null;
}

export type DecisionCobro =
  | { accion: "registrar"; paymentId: string }
  | { accion: "rechazado"; definitivo: boolean; detalle: string | null }
  | { accion: "esperar"; motivo: string }
  | { accion: "ignorar"; motivo: string };

/**
 * Qué hacer con un cobro que MP reporta, para la suscripción `preapprovalId`.
 * El dinero solo se registra con el PAGO consultado aparte (`/v1/payments`):
 * aquí solo se decide si vale la pena consultarlo.
 */
export function decidirCobro(c: CobroMp, preapprovalId: string): DecisionCobro {
  if (!c.preapprovalId || c.preapprovalId !== preapprovalId) return { accion: "ignorar", motivo: "el cobro es de otra suscripción" };
  if (c.currencyId && c.currencyId !== "MXN") return { accion: "ignorar", motivo: `moneda ${c.currencyId}` };
  if (c.paymentStatus === "approved" && c.paymentId) return { accion: "registrar", paymentId: c.paymentId };
  if (c.paymentStatus === "rejected") {
    // `recycling` = MP lo reintentará (hasta 4 veces en ~10 días); `processed`
    // con el pago rechazado = se rindió.
    return { accion: "rechazado", definitivo: c.status !== "recycling", detalle: c.paymentStatusDetail };
  }
  return { accion: "esperar", motivo: `cobro ${c.status ?? "?"} · pago ${c.paymentStatus ?? "sin intentar"}` };
}

/* ── Fechas para MP ───────────────────────────────────────────────────── */

/** Desfase de una zona IANA en un día dado, como "-06:00". */
export function desfaseDeZona(dia: string, tz: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const instante = new Date(Date.UTC(a, m - 1, d, 18, 0, 0));
  try {
    const nombre = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(instante)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
    const r = /GMT([+-]\d{2}):?(\d{2})?/.exec(nombre);
    if (r) return `${r[1]}:${r[2] ?? "00"}`;
    if (nombre === "GMT") return "+00:00";
  } catch {
    // zona inválida: cae a la de la Ciudad de México
  }
  return "-06:00";
}

/** "YYYY-MM-DD" + hora local de la clínica → ISO 8601 con desfase, como lo pide MP. */
export function isoEnZona(dia: string, hora: string, tz: string): string {
  return `${dia}T${hora}.000${desfaseDeZona(dia, tz)}`;
}

/**
 * El `init_point` tal cual lo da MP. Solo se aceptan URLs https de dominios de
 * Mercado Pago: es el link que se le manda al paciente.
 */
export function linkSeguro(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (!/(^|\.)mercadopago\.com(\.[a-z]{2})?$|(^|\.)mercadolibre\.com(\.[a-z]{2})?$/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Correo con forma de correo (MP lo exige; no se manda basura). */
export function correoValido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254 ? s : null;
}

export function formatoPesos(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

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

/* ── El ciclo: no cobrar dos veces lo que ya se pagó a mano (F1) ─────── */
//
// Mercado Pago cobra en las fechas del plan y NO deja mover la fecha del
// siguiente cargo (el PUT solo cambia monto y estado). Si recepción cobra a mano
// (caja, link, saldo a favor) la mensualidad que MP iba a cobrar, MP la cobraría
// igual: el paciente pagaría dos veces ese mes. Decisión de Rafael (3-oct-2026):
// PAUSAR la suscripción solo para ese cargo y reanudarla sola para el siguiente,
// sin cambiar el monto.
//
// La cuenta es la de siempre: la cascada de `estadoDelPlan` reparte lo pagado de
// la cuota más vieja a la más nueva. Un cargo de MP está «cubierto» cuando su
// mensualidad (la del calendario con esa fecha) ya no debe nada.

/** "YYYY-MM-DD" + n días, en calendario (sin zona). */
export function sumarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d) + n * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}

/** Días que MP puede seguir reintentando un cargo rechazado (doc: ventana de 10 días) + 1 de margen. */
export const DIAS_DE_REINTENTO = 11;

/**
 * Lo que MP ya hizo con el cargo de una fecha, según sus cobros (authorized payments):
 *   · "aprobado"   — cobró;
 *   · "en_proceso" — está cobrando (esperando al banco);
 *   · "reintenta"  — lo rechazó y lo volverá a intentar (`recycling`);
 *   · "rechazado"  — lo rechazó y se rindió.
 * Un cobro `scheduled` (programado, aún sin intentar) NO cuenta como hecho: MP
 * todavía lo va a cobrar.
 */
export type HechoDeCargo = "aprobado" | "en_proceso" | "reintenta" | "rechazado";

export function hechoDeCobro(c: { status: string | null; paymentStatus: string | null }): HechoDeCargo | null {
  if (c.paymentStatus === "approved") return "aprobado";
  if (c.paymentStatus === "rejected") return c.status === "recycling" ? "reintenta" : "rechazado";
  if (c.paymentStatus === "in_process" || c.paymentStatus === "pending" || c.paymentStatus === "authorized") return "en_proceso";
  return null;
}

export interface CargoHecho {
  /** Fecha del cobro de MP ("YYYY-MM-DD" o ISO; se toma el día). */
  fecha: string;
  hecho: HechoDeCargo;
}

export interface EntradaCiclo {
  condiciones: CondicionesPago | null;
  total: number;
  pagado: number;
  /** "YYYY-MM-DD" en la zona de la clínica. */
  hoy: string;
  /** Primer cargo de la suscripción (`startDate`). null = desde el principio del plan. */
  inicio: string | null;
  /** Lo que MP ya hizo, cargo por cargo. */
  hechos: CargoHecho[];
}

export interface DecisionCiclo {
  /** Lo que la suscripción debería estar HOY. */
  estado: "authorized" | "paused";
  /** Cargos que MP cobraría de más (su mensualidad ya está pagada): se saltan. */
  saltados: string[];
  /** Hasta cuándo un reintento de MP cobraría una mensualidad ya pagada. */
  reintentoHasta: string | null;
  /** Día en que se reanuda sola (null = no se pausa). */
  reanudarEl: string | null;
  /** El siguiente cargo que MP SÍ debe hacer (el primero cuya mensualidad debe algo). */
  proximoCargo: string | null;
  /** El cargo de MP más reciente (≤ hoy) que ya se cobró, con el plan al corriente: el ciclo de hoy está pagado. */
  cicloCobrado: string | null;
}

interface CargoDelPlan {
  fecha: string;
  numero: number;
  importe: number;
  falta: number;
}

function cargosDelPlan(e: Pick<EntradaCiclo, "condiciones" | "total" | "pagado" | "hoy" | "inicio">): {
  cargos: CargoDelPlan[];
  alCorriente: boolean;
} {
  const cuotas = calendarioDeCuotas(e.condiciones, e.total);
  const estado = estadoDelPlan(cuotas, [{ importe: e.pagado }], e.hoy);
  const cargos = estado.cuotas
    .filter((q) => !q.esEnganche && q.vencimiento && (!e.inicio || (q.vencimiento as string) >= e.inicio))
    .map((q) => ({ fecha: q.vencimiento as string, numero: q.numero, importe: q.importe, falta: q.falta }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  return { cargos, alCorriente: aCentavos(estado.importeVencido) === 0 };
}

/** A qué cargo del plan pertenece un cobro de MP: el último con fecha ≤ la del cobro (los reintentos caen días después). */
function cargoDeUnCobro(cargos: CargoDelPlan[], fecha: string): string | null {
  const dia = fecha.slice(0, 10);
  let suyo: string | null = null;
  for (const c of cargos) if (c.fecha <= dia) suyo = c.fecha;
  return suyo;
}

/**
 * ¿Cómo debe estar la suscripción hoy para no cobrar dos veces?
 *
 *   · Los cargos que siguen (el de hoy cuenta si MP aún no lo hizo), en orden:
 *     mientras su mensualidad ya esté pagada, MP no debe cobrarlos → se saltan.
 *     Se reanuda el día siguiente al último saltado, a tiempo para el primero que
 *     sí debe algo (que se cobra con el monto de siempre).
 *   · Un cargo ya rechazado que MP sigue reintentando, cuya mensualidad se pagó
 *     a mano después: un reintento la cobraría otra vez → pausa hasta que se
 *     cierre la ventana de reintento, sin pasar del siguiente cargo debido.
 *   · Un pago parcial no salta nada: la mensualidad sigue debiendo algo y MP la
 *     cobra con su monto (lo de más se abona a la siguiente).
 */
export function decisionDeCiclo(e: EntradaCiclo): DecisionCiclo {
  const { cargos, alCorriente } = cargosDelPlan(e);
  const hechoPorCargo = new Map<string, HechoDeCargo>();
  for (const h of e.hechos) {
    const c = cargoDeUnCobro(cargos, h.fecha);
    if (!c) continue;
    const previo = hechoPorCargo.get(c);
    // Aprobado gana a todo; un rechazo final no pisa un reintento posterior que entró.
    if (previo === "aprobado") continue;
    hechoPorCargo.set(c, h.hecho);
  }
  const falta = new Map(cargos.map((c) => [c.fecha, aCentavos(c.falta)]));

  // Lo que MP todavía va a cobrar: de hoy en adelante y sin cobro suyo (un cargo
  // que ya hizo, aunque fuera antes de su fecha, no se vuelve a «saltar»).
  const pendientes = cargos.filter((c) => c.fecha >= e.hoy && !hechoPorCargo.has(c.fecha));
  const saltados: string[] = [];
  for (const c of pendientes) {
    if ((falta.get(c.fecha) ?? 0) > 0) break;
    saltados.push(c.fecha);
  }
  const proximoCargo = pendientes[saltados.length]?.fecha ?? null;

  let reintentoHasta: string | null = null;
  for (const c of cargos) {
    if (c.fecha > e.hoy || hechoPorCargo.get(c.fecha) !== "reintenta" || (falta.get(c.fecha) ?? 0) > 0) continue;
    const hasta = sumarDias(c.fecha, DIAS_DE_REINTENTO);
    if (hasta > e.hoy && (!reintentoHasta || hasta > reintentoHasta)) reintentoHasta = hasta;
  }

  let reanudarEl: string | null = null;
  if (saltados.length > 0) reanudarEl = sumarDias(saltados[saltados.length - 1], 1);
  if (reintentoHasta && (!reanudarEl || reintentoHasta > reanudarEl)) reanudarEl = reintentoHasta;
  // Nunca pausado el día de un cargo que sí se debe: ese día se reanuda.
  if (reanudarEl && proximoCargo && reanudarEl > proximoCargo) reanudarEl = proximoCargo;

  const pasados = cargos.filter((c) => c.fecha <= e.hoy);
  const ultimo = pasados[pasados.length - 1];
  const cicloCobrado =
    ultimo && hechoPorCargo.get(ultimo.fecha) === "aprobado" && (falta.get(ultimo.fecha) ?? 0) === 0 && alCorriente ? ultimo.fecha : null;

  return { estado: reanudarEl ? "paused" : "authorized", saltados, reintentoHasta, reanudarEl, proximoCargo, cicloCobrado };
}

/**
 * Lo que se le dice a recepción ANTES de cobrar `monto` a mano en una factura
 * con cobro automático vivo, y si hace falta confirmar.
 *
 *   · "liquida"    — con este cobro la factura queda pagada: se cancela.
 *   · "ya_cobrado" — MP ya cobró la mensualidad de este ciclo y el plan va al
 *                    corriente: lo de ahora sería un ADELANTO. No se deja sin
 *                    confirmar (el caso inverso del cobro doble).
 *   · "pausa"      — este cobro paga la mensualidad que MP iba a cobrar: esos
 *                    cargos se pausan y se reanuda para `reanudaPara`.
 *   · "reintento"  — MP está reintentando un cargo rechazado de una mensualidad
 *                    que este cobro paga: se pausa hasta `reintentoHasta`.
 *   · "sigue"      — este cobro no cubre la mensualidad del siguiente cargo: MP
 *                    cobra igual ese día (lo de más pasa a la siguiente).
 */
export type TipoAvisoCobro = "liquida" | "ya_cobrado" | "pausa" | "reintento" | "sigue";

export interface AvisoCobro {
  tipo: TipoAvisoCobro;
  requiereConfirmar: boolean;
  /** Cargos que se pausarían con este cobro. */
  saltados: string[];
  /** El siguiente cargo que MP sí haría después del cobro. */
  reanudaPara: string | null;
  reintentoHasta: string | null;
  /** El ciclo que MP ya cobró (solo en "ya_cobrado"). */
  cicloCobrado: string | null;
  /** Lo que MP cobra por cargo. */
  montoCargo: number;
}

export function avisoDeCobroManual(e: Omit<EntradaCiclo, "pagado"> & {
  pagado: number;
  monto: number;
  montoCargo: number;
  /** Solo una suscripción que cobra (authorized) o pausada por el ciclo avisa. */
  estado: EstadoCobro;
  pausaManual: boolean;
}): AvisoCobro | null {
  if (!(e.monto > 0)) return null;
  if (!(e.estado === "authorized" || (e.estado === "paused" && !e.pausaManual))) return null;
  const base = { saltados: [] as string[], reanudaPara: null, reintentoHasta: null, cicloCobrado: null, montoCargo: e.montoCargo };
  const despuesC = aCentavos(e.pagado) + aCentavos(e.monto);
  if (despuesC >= aCentavos(e.total)) return { ...base, tipo: "liquida", requiereConfirmar: false };

  const antes = decisionDeCiclo(e);
  const despues = decisionDeCiclo({ ...e, pagado: aPesos(despuesC) });
  const nuevosSaltados = despues.saltados.length > antes.saltados.length;
  const comun = {
    saltados: despues.saltados,
    reanudaPara: despues.proximoCargo,
    reintentoHasta: despues.reintentoHasta,
    cicloCobrado: antes.cicloCobrado,
    montoCargo: e.montoCargo,
  };
  if (antes.cicloCobrado) return { ...comun, tipo: "ya_cobrado", requiereConfirmar: true };
  if (nuevosSaltados) return { ...comun, tipo: "pausa", requiereConfirmar: false };
  if (despues.reintentoHasta && despues.reintentoHasta !== antes.reintentoHasta) return { ...comun, tipo: "reintento", requiereConfirmar: false };
  if (despues.proximoCargo) return { ...comun, tipo: "sigue", requiereConfirmar: false };
  return null;
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

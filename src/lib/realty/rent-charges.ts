// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — el calendario de la renta y el semáforo de la
// cobranza. Módulo PURO y client-safe: sin prisma, sin "server-only", sin
// decimal.js. Lo importan las pantallas ("use client"), las APIs y el cron.
//
// 🔴 DINERO EN CENTAVOS ENTEROS. Los importes viven como Decimal(14,2) en
// Postgres y viajan al navegador como `number` (así lo fija el contrato:
// "Decimals de Prisma como number"). Sumarlos con `+` acumula error
// binario: 4000 + 4000 + 4000 no siempre da 12000 exacto en cuanto hay
// centavos de por medio. Aquí TODO se convierte a centavos enteros, se
// suma en enteros y se divide UNA sola vez al presentar. El redondeo es
// del final, nunca del cálculo.
//
// Este archivo no importa nada de barber ni del dental: los verticales no
// se cruzan (toCents es cuatro líneas, un import cruzado es una deuda).
//
// 🔴 SIN FACTURACIÓN. Aquí se habla de CARGO, PAGO y RECIBO. Ni CFDI, ni
// timbrado, ni SAT: este vertical no factura.
// ═══════════════════════════════════════════════════════════════════════
import type {
  RealtyChargeStatus,
  RealtyCurrency,
} from "@/lib/realty/types";

// ── Dinero ──────────────────────────────────────────────────────────────

/** Lo que puede llegar como importe: number, string, Prisma.Decimal o nada. */
export type MoneyLike = number | string | { toString(): string } | null | undefined;

/**
 * Importe → centavos ENTEROS. Acepta el Decimal de Prisma por su toString
 * (que nunca pierde precisión) y la basura la manda a 0, igual que hacía el
 * `Number(x) || 0` que se escribe por reflejo.
 *
 * 🔴 SE TRABAJA SOBRE EL TEXTO, no sobre el `number`. El atajo obvio
 * —`Math.round(n * 100 + 1e-9)`— está mal y falla en silencio: ese epsilon
 * está en CENTAVOS, pero el error de `n * 100` crece con la magnitud
 * (≈ n · 2.2e-14). Funciona con 2.675 y deja de funcionar arriba de unos
 * $45 000: `toCents(9999999.995)` daba 999 999 999 en vez de
 * 1 000 000 000 — un centavo perdido justo en los importes grandes, que en
 * este vertical son un edificio o un local, no un caso de laboratorio.
 *
 * Partiendo el texto en parte entera y decimales, los dos lados caben
 * holgadamente en un entero y el redondeo es exacto en TODO el rango de
 * Decimal(14,2). Solo se cae al camino numérico con notación científica
 * ("1e3"), que ningún importe capturado a mano produce.
 */
export function toCents(value: MoneyLike): number {
  if (value === null || value === undefined) return 0;
  const trimmed = String(value).trim();
  if (!trimmed) return 0;

  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (m && (m[2] || m[3])) {
    const sign = m[1] === "-" ? -1 : 1;
    const entero = m[2] || "0";
    const dec = m[3] || "";
    const centavos = (dec + "00").slice(0, 2);
    // El tercer decimal decide el redondeo, medio hacia arriba en valor
    // absoluto (2.675 → 268, -2.675 → -268: simétrico).
    const resto = dec.length > 2 ? dec.slice(2) : "";
    const sube = resto !== "" && resto[0] >= "5" ? 1 : 0;
    const total = Number(entero) * 100 + Number(centavos) + sube;
    if (Number.isSafeInteger(total)) return sign * total;
  }

  const n = Number(trimmed);
  if (!Number.isFinite(n)) return 0;
  // Camino de respaldo (notación científica). El epsilon se escala con la
  // magnitud, que es lo que le faltaba a la versión anterior.
  const scaled = n * 100;
  const eps = Math.max(1e-9, Math.abs(scaled) * 1e-12);
  return Math.round(scaled + (scaled >= 0 ? eps : -eps));
}

/** Centavos enteros → número con dos decimales (el shape del DTO). */
export function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

/** Suma exacta: enteros de centavos, un solo redondeo al final. */
export function sumCents(values: readonly MoneyLike[]): number {
  let cents = 0;
  for (let i = 0; i < values.length; i++) cents += toCents(values[i]);
  return cents;
}

/** sumCents sobre una propiedad: `sumCentsBy(pagos, (p) => p.amount)`. */
export function sumCentsBy<T>(items: readonly T[], pick: (item: T) => MoneyLike): number {
  let cents = 0;
  for (let i = 0; i < items.length; i++) cents += toCents(pick(items[i]));
  return cents;
}

/** Formato de dinero es-MX. SIEMPRE dos decimales: es un estado de cuenta. */
export function formatMoney(amount: MoneyLike, currency: RealtyCurrency | string = "MXN"): string {
  const n = centsToNumber(toCents(amount));
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: typeof currency === "string" && currency ? currency : "MXN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

/** Igual que formatMoney pero recibiendo CENTAVOS (lo normal aquí dentro). */
export function formatCents(cents: number, currency: RealtyCurrency | string = "MXN"): string {
  return formatMoney(centsToNumber(cents), currency);
}

// ── Fechas: mediodía UTC y el "hoy" de la cuenta ───────────────────────
//
// Las columnas DateTime del vertical son timestamp(3) SIN zona. Si un
// vencimiento se guardara a medianoche, el mismo instante se lee como el
// día anterior en México y la cobranza corre un día. Por eso TODA fecha de
// calendario de este módulo se ancla al MEDIODÍA UTC: a las 12:00Z el día
// del calendario es el mismo en UTC y en cualquier huso de México
// (UTC−5/−6/−7), así que "el 5" es el 5 se mire desde donde se mire.

/** Fecha de calendario anclada al mediodía UTC. monthIndex es 0-11. */
export function atNoonUTC(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0, 0));
}

/** Días del mes (monthIndex 0-11), respetando años bisiestos. */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * "Hoy" en la zona horaria de la cuenta, como fecha de calendario a
 * mediodía UTC. `en-CA` da "YYYY-MM-DD" sin ambigüedad de formato.
 * Una zona inválida cae a America/Mexico_City en vez de tronar.
 */
export function todayInTimezone(timezone?: string | null, now: Date = new Date()): Date {
  const tz = timezone && timezone.trim() ? timezone : "America/Mexico_City";
  let iso: string;
  try {
    iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  return atNoonUTC(y, m - 1, d);
}

/** "YYYY-MM" de una fecha, leído en UTC (ver la nota del mediodía). */
export function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return `${y}-${m < 10 ? "0" : ""}${m}`;
}

/** "YYYY-MM" → { year, monthIndex }. Devuelve null si no es un periodo. */
export function parseMonthKey(key: string): { year: number; monthIndex: number } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(key ?? ""));
  if (!m) return null;
  return { year: parseInt(m[1], 10), monthIndex: parseInt(m[2], 10) - 1 };
}

/** Suma meses a un "YYYY-MM". addMonthKey("2026-11", 2) → "2027-01". */
export function addMonthKey(key: string, months: number): string {
  const p = parseMonthKey(key);
  if (!p) return key;
  return monthKey(atNoonUTC(p.year, p.monthIndex + months, 1));
}

/** Días de diferencia entre dos fechas de calendario (b − a). */
export function daysBetween(a: Date, b: Date): number {
  const DAY = 24 * 60 * 60 * 1000;
  const ua = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const ub = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((ub - ua) / DAY);
}

/**
 * El día de pago recortado al mes: el 31 en febrero es el 28 (o el 29).
 *
 * `Number.isFinite` y no `paymentDay || 1`: un string truthy pero no
 * numérico ("abc") pasaba el `||`, `Math.floor` lo volvía NaN y de aquí
 * salía un NaN que terminaba en un `dueAt: Invalid Date` dentro del plan de
 * cobros. La columna es Int, así que la BD nunca lo vio — pero esta función
 * es pública y client-safe, y una pantalla que le pase el valor de un input
 * suelto se llevaba fechas inválidas.
 */
export function clampPaymentDay(year: number, monthIndex: number, paymentDay: number): number {
  const n = Number(paymentDay);
  const day = Number.isFinite(n) ? Math.min(31, Math.max(1, Math.floor(n))) : 1;
  return Math.min(day, daysInMonth(year, monthIndex));
}

/** Nombre del periodo tal como lo diría el dueño: "agosto de 2026". */
export function monthLabel(key: string): string {
  const p = parseMonthKey(key);
  if (!p) return key;
  try {
    const s = new Intl.DateTimeFormat("es-MX", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(atNoonUTC(p.year, p.monthIndex, 1));
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return key;
  }
}

/** Fecha corta es-MX: "5 de agosto de 2026". */
export function formatLongDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Fecha compacta para tablas: "05/08/2026". */
export function formatShortDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// ── El calendario de cobros de un contrato ─────────────────────────────
//
// REGLA (una sola, escrita aquí para que ninguna pantalla la reinvente):
//
//   1. Hay UN cargo por cada mes de calendario, desde el mes en que empieza
//      el contrato hasta el mes en que termina.
//   2. Vence el día de pago pactado. Si ese día no existe en el mes (el 31
//      en febrero), vence el último día del mes.
//   3. Si el primer vencimiento cayera ANTES de que empiece el contrato
//      (contrato que arranca el 15 con día de pago 5), ese primer cargo
//      vence el día que arranca el contrato: nadie debe renta de antes de
//      haberse mudado.
//   4. El último mes NO se cobra si el contrato ya terminó antes de que esa
//      renta venciera. Un contrato del 15-mar-2026 al 14-mar-2027 con día
//      de pago 15 son DOCE cobros, no trece.
//   5. El importe es la renta completa. Aquí no se prorratea: los ajustes
//      del primer o del último mes se capturan como un cargo aparte o se
//      pactan en el contrato. Prorratear a escondidas produce un cobro que
//      el dueño no sabe explicar por teléfono.
//
// Y un techo duro de MAX_GENERATED_CHARGES: un endsAt con un dedazo
// ("2226" en vez de "2026") no puede llegar a insertar 2 400 filas.

/** Techo de cargos que se generan de una vez (10 años de renta mensual). */
export const MAX_GENERATED_CHARGES = 120;

export interface RentChargePlanRow {
  /** "YYYY-MM" del mes que cubre. */
  periodMonth: string;
  /** Vencimiento a mediodía UTC. */
  dueAt: Date;
  /** Importe del mes, en CENTAVOS enteros. */
  amountCents: number;
}

export interface BuildChargeScheduleArgs {
  startsAt: Date | string;
  endsAt: Date | string;
  paymentDay: number;
  rentAmount: MoneyLike;
}

/** El calendario completo de cobros de un contrato. Ver la REGLA de arriba. */
export function buildChargeSchedule(args: BuildChargeScheduleArgs): RentChargePlanRow[] {
  const start = toCalendarDate(args.startsAt);
  const end = toCalendarDate(args.endsAt);
  const amountCents = toCents(args.rentAmount);
  if (!start || !end) return [];
  if (end.getTime() < start.getTime()) return [];

  const out: RentChargePlanRow[] = [];
  let year = start.getUTCFullYear();
  let monthIndex = start.getUTCMonth();

  for (let i = 0; i < MAX_GENERATED_CHARGES; i++) {
    const first = atNoonUTC(year, monthIndex, 1);
    // Ya pasamos el mes en que termina el contrato.
    if (first.getUTCFullYear() > end.getUTCFullYear()) break;
    if (first.getUTCFullYear() === end.getUTCFullYear() && first.getUTCMonth() > end.getUTCMonth()) {
      break;
    }

    const day = clampPaymentDay(year, monthIndex, args.paymentDay);
    let dueAt = atNoonUTC(year, monthIndex, day);

    // Regla 3: no se debe renta de antes de haberse mudado.
    if (i === 0 && dueAt.getTime() < start.getTime()) dueAt = start;

    // Regla 4: el contrato ya terminó antes de que esta renta venciera.
    if (dueAt.getTime() > end.getTime()) break;

    out.push({ periodMonth: monthKey(first), dueAt, amountCents });

    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }

  return out;
}

/** Normaliza cualquier entrada de fecha a fecha de calendario (mediodía UTC). */
export function toCalendarDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return atNoonUTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ── Estado del cargo y saldo ───────────────────────────────────────────

export interface ChargeBalance {
  amountCents: number;
  paidCents: number;
  /** Lo que falta. Nunca negativo: un sobrepago deja el saldo en 0. */
  balanceCents: number;
  status: RealtyChargeStatus;
  /** Días de retraso del SALDO. 0 o menos = todavía no vence. */
  daysLate: number;
}

/**
 * El estado de un cargo a partir de lo pagado. Prioridad EXPLÍCITA:
 *
 *   PAGADO  → ya se cubrió (o se pagó de más)
 *   PARCIAL → hay abonos pero falta saldo — GANA sobre VENCIDO a propósito:
 *             "pago parcial" es lo que el dueño necesita ver, y la
 *             antigüedad del saldo la lleva el semáforo (agingBucket), no
 *             el estado. Un cargo PARCIAL vencido se pinta ámbar con su
 *             "30 días" al lado, y eso dice más que un rojo pelado.
 *   VENCIDO → cero abonos y ya pasó el día de pago
 *   PENDIENTE → cero abonos y todavía no vence
 */
export function chargeBalance(args: {
  amount: MoneyLike;
  /** Lo pagado como importe. Ignorado si viene `paidCents`. */
  paid?: MoneyLike;
  /**
   * Lo pagado YA en centavos enteros. Quien suma los pagos con sumCents ya
   * tiene el entero exacto: pasarlo por aquí evita el viaje de ida y vuelta
   * por punto flotante (centavos → pesos → centavos) del que no hace falta
   * dudar si nunca ocurre.
   */
  paidCents?: number;
  dueAt: Date | string;
  today: Date;
}): ChargeBalance {
  const amountCents = toCents(args.amount);
  const paidCents =
    typeof args.paidCents === "number" && Number.isFinite(args.paidCents)
      ? Math.round(args.paidCents)
      : toCents(args.paid);
  const balanceCents = Math.max(0, amountCents - paidCents);
  const due = toCalendarDate(args.dueAt);
  const daysLate = due ? daysBetween(due, args.today) : 0;

  let status: RealtyChargeStatus;
  if (paidCents >= amountCents && amountCents > 0) status = "PAGADO";
  else if (paidCents > 0) status = "PARCIAL";
  else if (daysLate > 0) status = "VENCIDO";
  else status = "PENDIENTE";

  return { amountCents, paidCents, balanceCents, status, daysLate };
}

// ── Semáforo por antigüedad del saldo ──────────────────────────────────

export type RealtyAgingKey = "AL_CORRIENTE" | "D1_15" | "D16_30" | "D30_MAS";

export const REALTY_AGING_UI: Record<
  RealtyAgingKey,
  { label: string; short: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  AL_CORRIENTE: { label: "Al corriente", short: "Al corriente", tone: "success" },
  D1_15: { label: "1 a 15 días de retraso", short: "1-15 días", tone: "warning" },
  D16_30: { label: "16 a 30 días de retraso", short: "16-30 días", tone: "warning" },
  D30_MAS: { label: "Más de 30 días de retraso", short: "+30 días", tone: "danger" },
};

export const REALTY_AGING_ORDER: RealtyAgingKey[] = [
  "AL_CORRIENTE",
  "D1_15",
  "D16_30",
  "D30_MAS",
];

/**
 * El semáforo. Un cargo SIN saldo está al corriente aunque haya vencido:
 * lo que envejece es el dinero que falta, no la fecha.
 */
export function agingBucket(balanceCents: number, daysLate: number): RealtyAgingKey {
  if (balanceCents <= 0) return "AL_CORRIENTE";
  if (daysLate <= 0) return "AL_CORRIENTE";
  if (daysLate <= 15) return "D1_15";
  if (daysLate <= 30) return "D16_30";
  return "D30_MAS";
}

// ── Recordatorios escalonados ──────────────────────────────────────────
//
// Cuatro toques por cargo, con TONO distinto. El de −5 días es un aviso
// amable; el de +8 ya es una gestión de cobranza. Un solo recordatorio
// genérico repetido cuatro veces se vuelve ruido y la gente lo silencia.
//
// 🔴 El plan PROPIETARIO ($199) NO trae WhatsApp. En ese plan estos avisos
// salen por CORREO y quedan como pendiente dentro del panel; el WhatsApp es
// exactamente el motivo para subir al plan de $349. Ver noticeChannelsFor.

export type RealtyReminderStepKey = "PREVIO_5" | "DIA_PAGO" | "VENCIDO_3" | "VENCIDO_8";

export interface RealtyReminderStep {
  key: RealtyReminderStepKey;
  /** Días respecto al vencimiento. Negativo = antes. */
  offsetDays: number;
  /** Cómo se le habla al inquilino en ese toque. */
  tone: "amable" | "recordatorio" | "firme" | "urgente";
  label: string;
  /** Lo que el dueño ve en la configuración: qué se manda y cuándo. */
  help: string;
}

export const REALTY_REMINDER_STEPS: RealtyReminderStep[] = [
  {
    key: "PREVIO_5",
    offsetDays: -5,
    tone: "amable",
    label: "5 días antes",
    help: "Un aviso amable de que se acerca el día de pago.",
  },
  {
    key: "DIA_PAGO",
    offsetDays: 0,
    tone: "recordatorio",
    label: "El día del pago",
    help: "El recordatorio del día, con el monto y cómo pagar.",
  },
  {
    key: "VENCIDO_3",
    offsetDays: 3,
    tone: "firme",
    label: "3 días después",
    help: "Ya venció: se avisa el saldo y se pide fecha de pago.",
  },
  {
    key: "VENCIDO_8",
    offsetDays: 8,
    tone: "urgente",
    label: "8 días después",
    help: "Última llamada antes de escalar la cobranza.",
  },
];

/** El paso que toca HOY para un vencimiento dado, o null si hoy no toca. */
export function pickReminderStep(dueAt: Date | string, today: Date): RealtyReminderStep | null {
  const due = toCalendarDate(dueAt);
  if (!due) return null;
  const delta = daysBetween(due, today); // + = ya venció
  for (const step of REALTY_REMINDER_STEPS) {
    if (step.offsetDays === delta) return step;
  }
  return null;
}

/** Por dónde sale el aviso. WhatsApp SOLO si el plan lo incluye. */
export type RealtyNoticeChannel = "WHATSAPP" | "CORREO" | "PANEL";

export const REALTY_NOTICE_CHANNEL_LABELS: Record<RealtyNoticeChannel, string> = {
  WHATSAPP: "WhatsApp",
  CORREO: "Correo",
  PANEL: "Pendiente en el panel",
};

/**
 * Canales de un aviso según el plan de la cuenta.
 *
 * Con WhatsApp: sale por WhatsApp y queda el pendiente en el panel.
 * Sin WhatsApp (plan PROPIETARIO): CORREO + pendiente en el panel. Se
 * devuelve SIEMPRE PANEL para que un aviso jamás se pierda del todo: si el
 * inquilino no tiene correo capturado, el dueño lo ve igual en su lista.
 */
export function noticeChannelsFor(planHasWhatsapp: boolean): RealtyNoticeChannel[] {
  return planHasWhatsapp ? ["WHATSAPP", "PANEL"] : ["CORREO", "PANEL"];
}

/**
 * 🔴 CONTRATO CON T6 (WhatsApp). Este es el shape EXACTO de la cola de
 * avisos que deja esta terminal. T4 arma la lista; T6 la entrega.
 * Ningún campo cambia de nombre sin avisar: es una frontera entre olas.
 */
export interface RealtyRentNotice {
  /** Idempotencia: mismo cargo + mismo paso = misma llave. */
  key: string;
  accountId: string;
  leaseId: string;
  chargeId: string;
  propertyId: string;
  propertyTitle: string;
  /** El inquilino del contrato (RealtyLeaseParty con role INQUILINO). */
  contactId: string | null;
  contactName: string;
  /** Normalizado a 10 dígitos, como manda el contrato. null = no hay. */
  contactPhone: string | null;
  contactEmail: string | null;
  step: RealtyReminderStepKey;
  tone: RealtyReminderStep["tone"];
  /** "YYYY-MM" del mes que se cobra. */
  periodMonth: string;
  periodLabel: string;
  dueAt: string;
  /** Días de retraso al momento de armar la lista. Negativo = falta. */
  daysLate: number;
  /** Saldo pendiente EN CENTAVOS: el que manda es el saldo, no el cargo. */
  balanceCents: number;
  currency: RealtyCurrency;
  channels: RealtyNoticeChannel[];
  /** El texto ya armado en español de México. T6 puede sustituirlo. */
  message: string;
}

/** Llave idempotente de un aviso: cargo + paso. */
export function noticeKey(chargeId: string, step: RealtyReminderStepKey): string {
  return `${chargeId}:${step}`;
}

/**
 * El texto del aviso, con el tono del paso. Sin jerga, sin "estimado
 * cliente" y sin una sola palabra de facturación: aquí se cobra renta.
 */
export function buildNoticeMessage(args: {
  step: RealtyReminderStepKey;
  contactName: string;
  propertyTitle: string;
  periodLabel: string;
  dueAt: Date | string;
  balanceCents: number;
  currency: RealtyCurrency;
  landlordName: string;
  isPartial: boolean;
}): string {
  const nombre = (args.contactName || "").split(" ")[0] || "Hola";
  const monto = formatCents(args.balanceCents, args.currency);
  const fecha = formatLongDate(args.dueAt);
  const inmueble = args.propertyTitle || "el inmueble";
  const saldo = args.isPartial ? "el saldo pendiente" : "la renta";

  switch (args.step) {
    case "PREVIO_5":
      return (
        `Hola ${nombre}. Te recordamos que ${saldo} de ${inmueble} correspondiente a ` +
        `${args.periodLabel} vence el ${fecha}. Son ${monto}. ` +
        `Cualquier duda, aquí estamos. — ${args.landlordName}`
      );
    case "DIA_PAGO":
      return (
        `Hola ${nombre}. Hoy vence ${saldo} de ${inmueble} de ${args.periodLabel}: ${monto}. ` +
        `En cuanto lo cubras te mandamos tu recibo. — ${args.landlordName}`
      );
    case "VENCIDO_3":
      return (
        `Hola ${nombre}. ${saldo.charAt(0).toUpperCase()}${saldo.slice(1)} de ${inmueble} de ` +
        `${args.periodLabel} venció el ${fecha} y quedan ${monto}. ` +
        `¿Nos confirmas qué día lo cubres? — ${args.landlordName}`
      );
    case "VENCIDO_8":
    default:
      return (
        `Hola ${nombre}. Seguimos sin recibir ${saldo} de ${inmueble} de ${args.periodLabel}: ` +
        `${monto}, vencido desde el ${fecha}. Necesitamos ponernos de acuerdo hoy mismo ` +
        `para no tener que escalarlo. — ${args.landlordName}`
      );
  }
}

// ── Resumen de un tablero de cobranza (lo que pinta la pantalla) ────────

export interface CollectionsTotals {
  /** Cargos del periodo mirado. */
  chargedCents: number;
  paidCents: number;
  balanceCents: number;
  /** Solo lo VENCIDO con saldo (no incluye lo que todavía no vence). */
  overdueCents: number;
  count: number;
  paidCount: number;
  overdueCount: number;
  /** Cuánto saldo hay en cada cajón del semáforo. */
  byAging: Record<RealtyAgingKey, { count: number; balanceCents: number }>;
}

export function emptyCollectionsTotals(): CollectionsTotals {
  const byAging = {} as Record<RealtyAgingKey, { count: number; balanceCents: number }>;
  for (const key of REALTY_AGING_ORDER) byAging[key] = { count: 0, balanceCents: 0 };
  return {
    chargedCents: 0,
    paidCents: 0,
    balanceCents: 0,
    overdueCents: 0,
    count: 0,
    paidCount: 0,
    overdueCount: 0,
    byAging,
  };
}

/** Acumula una fila de cobranza ya calculada dentro de los totales. */
export function accumulate(
  totals: CollectionsTotals,
  row: { amountCents: number; paidCents: number; balanceCents: number; daysLate: number },
): CollectionsTotals {
  totals.chargedCents += row.amountCents;
  totals.paidCents += row.paidCents;
  totals.balanceCents += row.balanceCents;
  totals.count += 1;
  if (row.balanceCents <= 0) totals.paidCount += 1;
  if (row.balanceCents > 0 && row.daysLate > 0) {
    totals.overdueCents += row.balanceCents;
    totals.overdueCount += 1;
  }
  const bucket = agingBucket(row.balanceCents, row.daysLate);
  totals.byAging[bucket].count += 1;
  totals.byAging[bucket].balanceCents += row.balanceCents;
  return totals;
}

// ── Contratos por vencer ───────────────────────────────────────────────

/** Las ventanas de la pantalla "por vencer": 30 / 60 / 90 días. */
export const REALTY_EXPIRY_WINDOWS = [30, 60, 90] as const;
export type RealtyExpiryWindow = (typeof REALTY_EXPIRY_WINDOWS)[number];

/** En qué ventana cae un contrato. null = ni vencido ni dentro de 90 días. */
export function expiryWindowFor(endsAt: Date | string, today: Date): RealtyExpiryWindow | null {
  const end = toCalendarDate(endsAt);
  if (!end) return null;
  const days = daysBetween(today, end);
  if (days < 0) return null;
  for (const w of REALTY_EXPIRY_WINDOWS) {
    if (days <= w) return w;
  }
  return null;
}

// ── Folio del recibo ───────────────────────────────────────────────────
//
// 🔴 EL FOLIO SALE SIEMPRE DEL MÁXIMO EMITIDO, NUNCA DE UN count + 1.
// Con un pago borrado o con dos recibos emitiéndose a la vez, count colisiona
// y dos recibos distintos salen con el mismo folio. En este repo ya pasó.
//
// El vertical NO tiene columna de folio (el contrato y el schema son de la
// Ola 0 y no se tocan), así que el folio vive DENTRO de
// RealtyPayment.receiptUrl, que es justo la liga del recibo:
//
//     /api/realty/payments/recibo/REC-000123
//
// Dos consecuencias buscadas:
//   · El prefijo es CONSTANTE y el número va al final con ancho fijo, así
//     que el orden alfabético de la columna ES el orden numérico: el MÁXIMO
//     se saca con un ORDER BY "receiptUrl" DESC LIMIT 1, sin contar nada.
//   · La liga es real y resoluble: el folio no es un dato colgado, es la
//     dirección del documento.

export const RECEIPT_FOLIO_PREFIX = "REC-";
export const RECEIPT_FOLIO_DIGITS = 6;
export const RECEIPT_URL_BASE = "/api/realty/payments/recibo/";

/** 123 → "REC-000123". Ancho fijo: sin él, "REC-9" ordenaría después de "REC-10". */
export function formatReceiptFolio(n: number): string {
  const safe = Math.max(1, Math.floor(n || 0));
  return `${RECEIPT_FOLIO_PREFIX}${String(safe).padStart(RECEIPT_FOLIO_DIGITS, "0")}`;
}

/** "REC-000123" → 123. Devuelve 0 si no es un folio de este vertical. */
export function parseReceiptFolio(folio: string | null | undefined): number {
  if (!folio) return 0;
  const m = new RegExp(`^${RECEIPT_FOLIO_PREFIX}(\\d{1,12})$`).exec(String(folio).trim());
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

/** El folio → la liga que se guarda en receiptUrl. */
export function receiptUrlFor(folio: string): string {
  return `${RECEIPT_URL_BASE}${folio}`;
}

/** La liga → su folio. "" si la liga no es de un recibo del vertical. */
export function folioFromReceiptUrl(url: string | null | undefined): string {
  if (!url) return "";
  const raw = String(url);
  const at = raw.lastIndexOf("/");
  const tail = at >= 0 ? raw.slice(at + 1) : raw;
  return parseReceiptFolio(tail) > 0 ? tail : "";
}

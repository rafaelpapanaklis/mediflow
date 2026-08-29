/**
 * DaleControl INSTITUCIONAL — EL DINERO, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"). Aquí vive
 * TODA la aritmética del cobro y la ÚNICA forma de escribir y de leer una
 * cantidad de dinero en este vertical. La capa que consulta está en
 * tarifas.ts (los precios) y caja.ts (los cobros).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 CENTAVOS ENTEROS, SIEMPRE. Ni float ni Decimal.
 *
 * En coma flotante 0.1 + 0.2 no da 0.3, y un tarifario con 40 renglones
 * acumula ese error hasta que el corte de caja no cuadra por un peso que
 * nadie encuentra. Un entero de centavos suma exacto, se compara exacto y
 * viaja al navegador como número.
 *
 * Consecuencia práctica: en TODO este vertical, una cantidad de dinero es
 * un `number` de centavos y se llama `…Cents`. Un número que no lleve ese
 * sufijo NO es dinero. Convertir a texto es `eduMoney`, y leer lo que
 * teclea una persona es `parseEduMoneyCents`; no hay una tercera forma.
 *
 * 🔴 LOS TOPES NO SON PARANOIA. `Int` de Postgres es de 4 bytes:
 * 2,147,483,647 centavos ≈ 21 millones de pesos. Sin topes, un cero de más
 * en el precio unitario multiplicado por la cantidad desborda la columna y
 * la escritura falla con un error de driver que no explica nada — o peor,
 * pasa. Los topes de abajo dejan cualquier suma posible por debajo de ese
 * límite CON margen.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduChargeStatus, EduPaymentMethod, EduFeeRule } from "@/lib/edu/types";
import {
  EDU_CHARGE_STATUSES,
  EDU_FEE_RULES,
  EDU_PAYMENT_METHODS,
} from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// 1 · TOPES
// ═══════════════════════════════════════════════════════════════════════

/** $100,000.00 por unidad. Una unidad dental cara, no un edificio. */
export const EDU_MAX_PRICE_CENTS = 10_000_000;

/** Cuántas veces cabe el mismo procedimiento en una línea. */
export const EDU_MAX_QUANTITY = 99;

/** Líneas por cobro. Un ticket más largo que esto es dos tickets. */
export const EDU_MAX_CHARGE_ITEMS = 50;

/**
 * $1,000,000.00 por cobro. Con este tope y el de la línea, el peor caso
 * (50 líneas × 99 × $100,000) se rechaza ANTES de tocar la base, y ninguna
 * suma que se guarde puede acercarse a los 2,147,483,647 de un Int4.
 */
export const EDU_MAX_CHARGE_CENTS = 100_000_000;

/** Fondo de caja y conteo del corte. */
export const EDU_MAX_CASH_CENTS = 10_000_000;

/** Cuántos cobros lista una pantalla. Mismo criterio que el resto del vertical. */
export const EDU_CAJA_MAX_ROWS = 300;

// ═══════════════════════════════════════════════════════════════════════
// 2 · ESCRIBIR Y LEER DINERO
// ═══════════════════════════════════════════════════════════════════════

/**
 * El formateador se construye UNA vez. Construirlo dentro de la función
 * costaría un objeto Intl por cada celda de un tarifario de 40×4.
 */
const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Centavos → "$1,234.50". Es la ÚNICA forma de pintar dinero en el
 * vertical: si cada pantalla lo formatea a su manera, una escribe
 * "$1,234.5" y otra "1234.50 MXN" en el mismo recibo.
 *
 * Un valor que no es un número finito se pinta como "—" y no como "$NaN":
 * una pantalla que dice "no hay dato" es correcta; uno que dice "$NaN" es
 * un error de software delante del paciente.
 */
export function eduMoney(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return MXN.format(cents / 100);
}

/**
 * Centavos → "1234.50", el valor de un `<input>`. Sin símbolo y sin
 * separador de miles: un input con comas no se puede volver a leer.
 */
export function eduMoneyInputValue(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

/**
 * Lo que teclea una persona → centavos enteros. `null` = no es una
 * cantidad válida (y el que llama decide si eso es un error o un campo
 * vacío).
 *
 * 🔴 Se lee por TEXTO y no con `Math.round(x * 100)`: en coma flotante
 * 1.005 * 100 vale 100.49999999999999 y redondea a 100, o sea $1.00 por
 * algo que costaba $1.01. Partir la cadena por el punto y multiplicar
 * enteros no tiene ese problema.
 *
 * 🔴 NO acepta negativos. En esta ola ningún campo de dinero es negativo:
 * una devolución es un pago con `isRefund`, no un monto con signo. Aceptar
 * el signo aquí sería abrir la puerta a un "pago" de −$500 que cuadra
 * mágicamente cualquier corte.
 *
 * Tolera lo que la gente escribe de verdad: "$1,234.5", " 300 ", "1 234.00".
 * Rechaza más de dos decimales en vez de redondearlos: si alguien teclea
 * 99.999 hay que preguntarle, no decidir por él.
 */
export function parseEduMoneyCents(raw: unknown): number | null {
  let texto: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null;
    texto = raw.toFixed(2);
  } else if (typeof raw === "string") {
    texto = raw.trim();
  } else {
    return null;
  }

  // Símbolo, espacios y separador de miles. Los dos espacios de la clase
  // van ESCAPADOS a propósito (el duro y el fino): son los que pega Excel y
  // los que mete el teclado de un móvil, y escritos tal cual se verían
  // idénticos a un espacio normal, así que nadie sabría que están ahí.
  texto = texto.replace(/[$\s\u00a0\u202f]/g, "").replace(/,/g, "");
  if (!texto) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) return null;

  const [enteros, decimales = ""] = texto.split(".");
  const centavos = Number(enteros) * 100 + Number((decimales + "00").slice(0, 2));
  if (!Number.isSafeInteger(centavos)) return null;
  return centavos;
}

/**
 * Igual que la anterior pero con tope. Devuelve `null` si se pasa, para
 * que el que llama pueda dar un mensaje con el tope escrito.
 */
export function parseEduMoneyCentsMax(raw: unknown, maxCents: number): number | null {
  const v = parseEduMoneyCents(raw);
  if (v === null) return null;
  return v > maxCents ? null : v;
}

/** Cantidad de una línea: entero de 1 a EDU_MAX_QUANTITY. */
export function parseEduQuantity(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 1 || n > EDU_MAX_QUANTITY) return null;
  return n;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA ARITMÉTICA DEL COBRO
//
// Vive aquí, en funciones puras, para que la pantalla, el endpoint y el
// recibo no puedan discrepar sobre cuánto suma un ticket. La regla que
// fijan las pruebas: `subtotal − descuento == total`, SIEMPRE.
// ═══════════════════════════════════════════════════════════════════════

export interface EduLineMath {
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}

/**
 * cantidad × unitario − descuento, nunca por debajo de cero.
 *
 * El piso en cero es a propósito: un descuento mayor que la línea no
 * convierte el renglón en dinero que la escuela le debe al paciente. Si
 * hay que devolver dinero, eso es una devolución, no un descuento.
 */
export function eduLineTotalCents(line: EduLineMath): number {
  const bruto = line.quantity * line.unitPriceCents;
  return Math.max(0, bruto - line.discountCents);
}

export interface EduChargeTotals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * Los tres números del ticket a partir de sus líneas.
 *
 * `discountCents` se RECORTA a lo que de verdad se descontó (el piso en
 * cero de cada línea ya se aplicó), para que el invariante
 * `subtotal − descuento == total` se cumpla también cuando alguien teclea
 * un descuento absurdo. Si no se recortara, el recibo diría "descuento
 * $900" sobre un subtotal de $500 y un total de $0, que no suma.
 */
export function eduChargeTotals(lines: EduLineMath[]): EduChargeTotals {
  let subtotalCents = 0;
  let totalCents = 0;
  for (const l of lines) {
    subtotalCents += l.quantity * l.unitPriceCents;
    totalCents += eduLineTotalCents(l);
  }
  return { subtotalCents, discountCents: subtotalCents - totalCents, totalCents };
}

/**
 * En qué estado queda un cobro. Se DERIVA; no se captura nunca.
 *
 * El orden de las ramas importa:
 *  · cancelado gana a todo — ya no se le debe nada a nadie;
 *  · un total de cero nace LIQUIDADO (el tamizaje gratis de la escuela no
 *    puede quedarse "pendiente" para siempre en la lista de cobranza);
 *  · pagado y devuelto hasta volver a cero es DEVUELTO, no "pendiente":
 *    son dos historias distintas y el corte las cuenta distinto.
 */
export function eduChargeStatusFor(input: {
  cancelled: boolean;
  totalCents: number;
  paidCents: number;
  hasRefund: boolean;
}): EduChargeStatus {
  if (input.cancelled) return "CANCELLED";
  if (input.totalCents <= 0) return "PAID";
  if (input.paidCents >= input.totalCents) return "PAID";
  if (input.paidCents <= 0) return input.hasRefund ? "REFUNDED" : "PENDING";
  return "PARTIAL";
}

/**
 * 🔴 EL SALDO VIVO. Un cobro CANCELADO debe CERO.
 *
 * Esta función existe por un bug que ya se pagó en el producto dental:
 * cancelar una factura marcaba el estado y dejaba el `balance` intacto, así
 * que la ficha del paciente seguía ofreciendo "Cobrar ahora · $1,800" de
 * algo anulado, y lo mismo hacían el corte de caja y cuatro pantallas más.
 *
 * Aquí se cierra por los dos lados: la columna `balanceCents` se escribe en
 * 0 al cancelar Y toda suma filtra por estado. Esta función es la tercera
 * cerradura, la que usa la UI.
 */
export function eduSaldoVivoCents(charge: {
  status: EduChargeStatus;
  totalCents: number;
  paidCents: number;
}): number {
  if (charge.status === "CANCELLED") return 0;
  return Math.max(0, charge.totalCents - charge.paidCents);
}

/** Los estados que NO cuentan como dinero por cobrar. */
export const EDU_CHARGE_DEAD_STATUSES: EduChargeStatus[] = ["CANCELLED"];

// ═══════════════════════════════════════════════════════════════════════
// 4 · PARSEO DE LO QUE VIENE DEL CLIENTE
// ═══════════════════════════════════════════════════════════════════════

export function parseEduPaymentMethod(raw: unknown): EduPaymentMethod | null {
  if (typeof raw !== "string") return null;
  return (EDU_PAYMENT_METHODS as string[]).includes(raw) ? (raw as EduPaymentMethod) : null;
}

export function parseEduChargeStatus(raw: unknown): EduChargeStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_CHARGE_STATUSES as string[]).includes(raw) ? (raw as EduChargeStatus) : null;
}

export function parseEduFeeRule(raw: unknown): EduFeeRule | null {
  if (typeof raw !== "string") return null;
  return (EDU_FEE_RULES as string[]).includes(raw) ? (raw as EduFeeRule) : null;
}

/**
 * Clave de una lista de precios o de un procedimiento: minúsculas, sin
 * espacios, solo letras, números y guion. Se normaliza porque el índice
 * único es (institutionId, key) y Postgres distingue mayúsculas: sin esto
 * "Alumno" y "alumno" serían dos listas distintas con el mismo nombre
 * impreso.
 */
export function normalizeEduKey(raw: unknown, maxLength = 40): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!v || v.length > maxLength) return null;
  return v;
}

/** Clave del procedimiento: MAYÚSCULAS, como en el tarifario de la pared. */
export function normalizeEduProcedureCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (!v || v.length > 20) return null;
  return v;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · FILTROS DE LAS PANTALLAS
// ═══════════════════════════════════════════════════════════════════════

export interface EduChargeFilters {
  status: EduChargeStatus | null;
  patientId: string | null;
  /** true = solo lo del turno abierto; false = todo lo que se pueda ver. */
  soloTurno: boolean;
  q: string | null;
}

export const EDU_CHARGE_EMPTY_FILTERS: EduChargeFilters = {
  status: null,
  patientId: null,
  soloTurno: true,
  q: null,
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (typeof value === "string") return value;
  return null;
}

function cleanId(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/**
 * Lee los filtros de la query string. Lo que no reconoce, lo descarta.
 *
 * 🔴 Aquí NO se lee ningún institutionId. El tenant sale de la sesión; si
 * esto lo aceptara, bastaría teclear `?institutionId=…` para leer la caja
 * de otra escuela.
 */
export function parseEduChargeFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
): EduChargeFilters {
  const sp = searchParams ?? {};
  const busqueda = firstParam(sp.q);
  return {
    status: parseEduChargeStatus(firstParam(sp.estado)),
    patientId: cleanId(sp.paciente),
    // El default es el TURNO: quien abre caja quiere ver lo de su turno,
    // no el histórico del instituto.
    soloTurno: firstParam(sp.ver) !== "todos",
    q: busqueda && busqueda.trim() ? busqueda.trim().slice(0, 60) : null,
  };
}

export function eduHasChargeFilters(f: EduChargeFilters): boolean {
  return Boolean(f.status || f.patientId || f.q || !f.soloTurno);
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Se declaran aquí (módulo puro) para que la página server y el componente
// cliente lean el MISMO tipo. Todo lo que sale hacia el navegador es
// serializable: fechas en ISO, dinero en centavos.
// ═══════════════════════════════════════════════════════════════════════

export interface EduProcedureRow {
  id: string;
  code: string;
  name: string;
  category: string | null;
  durationMinutes: number;
  isActive: boolean;
  orderIndex: number;
  /** En cuántas listas tiene precio. Lo pinta el catálogo. */
  pricedIn: number;
}

export interface EduFeeScheduleRow {
  id: string;
  key: string;
  name: string;
  rule: EduFeeRule;
  isDefault: boolean;
  isActive: boolean;
  orderIndex: number;
  notes: string | null;
  /** Cuántos procedimientos tienen precio en esta lista. */
  itemCount: number;
}

/** Una celda de la tabla comparativa: el precio de un procedimiento en una lista. */
export interface EduTarifaCell {
  feeScheduleId: string;
  priceCents: number | null;
}

export interface EduTarifaRow {
  procedure: EduProcedureRow;
  cells: EduTarifaCell[];
}

/** La tabla comparativa completa: N listas × M procedimientos. */
export interface EduTarifario {
  schedules: EduFeeScheduleRow[];
  rows: EduTarifaRow[];
  truncated: boolean;
}

/** Por qué a este paciente le tocó ESTA lista. Se pinta tal cual en caja. */
export interface EduTarifaMatch {
  feeScheduleId: string;
  feeScheduleName: string;
  feeScheduleKey: string;
  /** "Lo trajo la alumna Sofía Ibarra (A-014)" / "Llegó solo a la clínica". */
  reason: string;
  /** true si se cayó a la lista default porque ninguna regla disparó. */
  isDefault: boolean;
}

/** El precio de UN procedimiento para UN paciente, ya resuelto. */
export interface EduPrecioResuelto {
  procedureId: string;
  code: string;
  name: string;
  category: string | null;
  durationMinutes: number;
  priceCents: number;
  /** De qué lista salió el precio (puede no ser la que le tocaba). */
  fromFeeScheduleId: string;
  fromFeeScheduleName: string;
  /**
   * true = la lista que le tocaba NO tiene este procedimiento y el precio
   * salió de la lista default. La pantalla lo DICE en vez de callarlo.
   */
  fallback: boolean;
}

export interface EduChargeItemRow {
  id: string;
  procedureId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  /** El precio que mandó el navegador y se descartó. null = no hubo. */
  clientPriceCents: number | null;
}

export interface EduPaymentRow {
  id: string;
  method: EduPaymentMethod;
  amountCents: number;
  isRefund: boolean;
  reference: string | null;
  notes: string | null;
  paidAt: string;
  receivedByName: string;
}

export interface EduChargeRow {
  id: string;
  folio: string;
  patientId: string;
  patientName: string;
  patientFolio: string;
  caseId: string | null;
  feeScheduleLabel: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: EduChargeStatus;
  notes: string | null;
  chargedByName: string;
  chargedAt: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  items: EduChargeItemRow[];
  payments: EduPaymentRow[];
}

export interface EduChargesPage {
  rows: EduChargeRow[];
  truncated: boolean;
  /** Suma de lo cobrado y lo pendiente de las filas devueltas. */
  totals: { totalCents: number; paidCents: number; balanceCents: number };
}

/** Un renglón del corte: cuánto entró por cada método. */
export interface EduCorteMethodRow {
  method: EduPaymentMethod;
  chargedCents: number;
  refundedCents: number;
  netCents: number;
  count: number;
}

export interface EduCashSessionRow {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingCents: number;
  countedCents: number | null;
  expectedCents: number | null;
  differenceCents: number | null;
  notes: string | null;
  openedByName: string;
  closedByName: string | null;
}

export interface EduCorte {
  session: EduCashSessionRow | null;
  /** Cierre del turno: los renglones por método dentro de la ventana. */
  methods: EduCorteMethodRow[];
  /** Efectivo esperado en el cajón: fondo + efectivo − devoluciones. */
  expectedCashCents: number;
  /** Neto de TODOS los métodos. */
  netCents: number;
  refundedCents: number;
  /** Cobros emitidos en el turno y lo que quedó a deber. */
  chargeCount: number;
  chargedCents: number;
  pendingCents: number;
  /**
   * Cuántos días naturales abarca la ventana del turno. >1 significa que
   * el turno lleva abierto más de un día y la pantalla tiene que decirlo
   * en vez de titular "hoy" unos datos que no son de hoy.
   */
  spanDays: number;
  /** Turnos cerrados recientes, para poder reimprimir un corte. */
  previous: EduCashSessionRow[];
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · EL CORTE, EN ARITMÉTICA PURA
// ═══════════════════════════════════════════════════════════════════════

export interface EduCortePaymentInput {
  method: EduPaymentMethod;
  amountCents: number;
  isRefund: boolean;
}

/**
 * Los renglones del corte a partir de los pagos de la ventana.
 *
 * 🔴 Una devolución NO se resta del renglón de "cobrado": se cuenta en su
 * propia columna. Un corte que enseña un solo neto esconde que hubo que
 * devolver $1,500, que es justo el número por el que pregunta la dirección.
 *
 * Devuelve SIEMPRE los cuatro métodos, también en cero. Una tabla de corte
 * a la que le faltan renglones obliga a leerla dos veces para saber si
 * "no hubo tarjeta" o "se me olvidó mirar".
 */
export function eduCorteMethods(pagos: EduCortePaymentInput[]): EduCorteMethodRow[] {
  const base = new Map<EduPaymentMethod, EduCorteMethodRow>();
  for (const m of EDU_PAYMENT_METHODS) {
    base.set(m, { method: m, chargedCents: 0, refundedCents: 0, netCents: 0, count: 0 });
  }
  for (const p of pagos) {
    const row = base.get(p.method);
    if (!row) continue;
    if (p.isRefund) row.refundedCents += p.amountCents;
    else row.chargedCents += p.amountCents;
    row.netCents = row.chargedCents - row.refundedCents;
    row.count += 1;
  }
  return EDU_PAYMENT_METHODS.map((m) => base.get(m) as EduCorteMethodRow);
}

/**
 * Cuántos días naturales abarca la ventana del turno, CONTANDO el día en
 * que se abrió.
 *
 * Un turno que se abrió ayer y solo cobró hoy también cruza días, y el
 * corte tiene que decirlo. Se cuenta en la zona del instituto — en UTC, un
 * turno de las 20:00 a las 22:00 en México cruzaría de día él solo.
 */
export function eduCorteSpanDays(
  openedAt: Date,
  hasta: Date,
  timeZone: string,
): number {
  const dia = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const a = dia(openedAt);
  const b = dia(hasta);
  if (a === b) return 1;
  // Diferencia en días entre dos fechas de calendario "AAAA-MM-DD".
  const ms = Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z");
  if (!Number.isFinite(ms) || ms < 0) return 1;
  return Math.round(ms / 86_400_000) + 1;
}

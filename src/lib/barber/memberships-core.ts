/**
 * DaleControl BARBER — núcleo PURO de membresías (client-safe).
 *
 * Aquí vive TODA la aritmética y las decisiones de la membresía: vigencia,
 * cupo de cortes, urgencia de renovación, periodo siguiente y el `where`
 * atómico con el que se descuenta un corte. Sin prisma, sin "server-only",
 * sin Stripe: se importa desde componentes "use client", desde el server y
 * desde las pruebas (node:test) sin necesitar base de datos.
 *
 * El módulo con acceso a BD es src/lib/barber/memberships.ts, que re-exporta
 * todo esto. Las otras terminales importan SIEMPRE desde `memberships.ts`.
 *
 * REGLA DE DINERO: nada de float. Todo el dinero se maneja aquí como
 * ENTEROS de centavos y se convierte a Prisma.Decimal en la frontera de BD.
 */
import { METHOD_CHANGE_PREFIX } from "@/lib/barber/method-change-core";
import type {
  BarberClientMembershipStatus,
  BarberPaymentMethod,
} from "@/lib/barber/types";

// ═══════════════════════════════════════════════════════════════════════
// Dinero exacto — enteros de centavos (jamás float)
// ═══════════════════════════════════════════════════════════════════════

/**
 * "349.50" | 349.5 | Decimal.toString() → 34950 centavos.
 * Redondea al centavo más cercano (medio hacia arriba) y tolera comas de
 * miles. Entrada basura → 0.
 */
export function moneyToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100);
  }
  const s = String(value).trim().replace(/\s+/g, "").replace(/,/g, "");
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return 0;
  const sign = m[1] ? -1 : 1;
  const whole = m[2] === "" ? 0 : Number(m[2]);
  const frac3 = (m[3] ?? "").padEnd(3, "0").slice(0, 3);
  let cents = whole * 100 + Number(frac3.slice(0, 2));
  if (Number(frac3[2]) >= 5) cents += 1;
  return sign * cents;
}

/** 34950 → "349.50" (string apto para Prisma.Decimal). */
export function centsToMoney(cents: number): string {
  const n = Math.round(cents);
  const neg = n < 0;
  const abs = Math.abs(n);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 34950 → 349.5 (solo para DTOs; NUNCA para aritmética). */
export function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

/** Porcentaje exacto sobre centavos: 34950 al 30% → 10485. */
export function percentOfCents(cents: number, percent: number): number {
  const bp = Math.round((Number.isFinite(percent) ? percent : 0) * 100); // puntos base
  return Math.round((Math.round(cents) * bp) / 10_000);
}

/** Formato es-MX/en-US de centavos. */
export function formatCents(cents: number, currency = "MXN", locale = "es"): string {
  const amount = centsToNumber(cents);
  const hasCents = Math.abs(cents % 100) > 0;
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    }).format(amount);
  } catch {
    return `$${amount} ${currency}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Fechas / periodos
// ═══════════════════════════════════════════════════════════════════════

/** Días antes del vencimiento en los que la membresía sale en "Por vencer". */
export const BARBER_MEMBERSHIP_SOON_DAYS = 7;

/**
 * Días de gracia antes de marcar VENCIDA una membresía con cobro recurrente
 * en Stripe: el cargo de renovación puede tardar en confirmarse y no
 * queremos que parpadee a "vencida" entre el corte de periodo y el webhook.
 * Las de efectivo/SPEI/tarjeta manual NO tienen gracia: vencen al segundo.
 */
export const BARBER_MEMBERSHIP_STRIPE_GRACE_DAYS = 3;

export const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + Math.round(days) * DAY_MS);
}

/** Fin del periodo a partir del inicio (periodDays del plan, mínimo 1). */
export function computePeriodEnd(startAt: Date, periodDays: number): Date {
  return addDays(startAt, Math.max(1, Math.round(periodDays || 30)));
}

/**
 * Nuevo fin de periodo al RENOVAR. Si la membresía sigue vigente se encadena
 * desde su fin actual (el cliente no pierde días); si ya venció, arranca hoy.
 */
export function nextPeriodEnd(currentEnd: Date, periodDays: number, now: Date): Date {
  const base = currentEnd.getTime() > now.getTime() ? currentEnd : now;
  return computePeriodEnd(base, periodDays);
}

/** Días completos que faltan para `endAt` (negativo si ya venció). */
export function daysUntil(endAt: Date, now: Date): number {
  return Math.floor((endAt.getTime() - now.getTime()) / DAY_MS);
}

// ═══════════════════════════════════════════════════════════════════════
// Periodos (decisión D1 de Rafael, 15-nov-2026)
// ═══════════════════════════════════════════════════════════════════════
//
// «Tiene 2 meses de membresía, tendría enero y febrero, 4 cortes y 4
// cortes.» Cada periodo PAGADO es una fila de barber_client_memberships con
// sus fechas y su cupo: renovar antes de que venza AGREGA una fila que empieza
// donde termina la última, en vez de reiniciar el cupo de toda la ventana.
//  · Los cortes se gastan del periodo VIGENTE (startAt ≤ ahora < endAt).
//  · Los del siguiente se ven como «próximo periodo» y no se pueden adelantar.
//  · Si un periodo vence con cortes sin usar, se pierden (como en un mes
//    normal): el siguiente arranca con los suyos.
//  · LEGADO: antes del cambio, renovar antes de tiempo movía startAt al
//    futuro en la MISMA fila. Esa fila no tiene un periodo anterior que
//    termine en su startAt, así que sigue cubriendo desde ya con su contador:
//    nadie pierde cortes y no hace falta convertir datos.

export interface MembershipPeriodRow {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  cutsUsed: number;
  /** Plan; las filas de planes distintos no se encadenan entre sí. */
  membershipId?: string;
}

/** ¿Algún periodo NO cancelado de la misma cadena termina justo donde empieza éste? */
function hasPredecessor<T extends MembershipPeriodRow>(row: T, rows: readonly T[]): boolean {
  return rows.some(
    (o) =>
      o.id !== row.id &&
      o.status !== "CANCELLED" &&
      (row.membershipId === undefined || o.membershipId === row.membershipId) &&
      o.endAt.getTime() === row.startAt.getTime(),
  );
}

/**
 * El periodo VIGENTE de un cliente (o null): activo, sin vencer y ya empezado
 * — o una fila de legado (ver arriba). Recibe TODAS las filas del cliente que
 * se tengan a mano; las vencidas o canceladas solo sirven para reconocer la
 * cadena.
 */
export function pickCurrentPeriod<T extends MembershipPeriodRow>(rows: readonly T[], now: Date): T | null {
  const live = rows
    .filter((r) => r.status === "ACTIVE" && r.endAt.getTime() > now.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  for (const r of live) {
    if (r.startAt.getTime() <= now.getTime()) return r;
    if (!hasPredecessor(r, rows)) return r; // legado: renovada antes del cambio
  }
  return null;
}

/** Periodos pagados que todavía no empiezan (los «próximos»), en orden. */
export function upcomingPeriods<T extends MembershipPeriodRow>(rows: readonly T[], now: Date): T[] {
  const current = pickCurrentPeriod(rows, now);
  return rows
    .filter(
      (r) =>
        r.id !== current?.id &&
        (r.status === "ACTIVE" || r.status === "PAUSED") &&
        r.startAt.getTime() > now.getTime(),
    )
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

// ═══════════════════════════════════════════════════════════════════════
// Estado de la membresía de un cliente
// ═══════════════════════════════════════════════════════════════════════

/** Lo mínimo que necesita el núcleo para decidir sobre una suscripción. */
export interface ClientMembershipState {
  status: BarberClientMembershipStatus;
  endAt: Date;
  cutsUsed: number;
  /** null = cortes ILIMITADOS (así lo guarda el schema). */
  includedCuts: number | null;
  paymentMethod?: BarberPaymentMethod;
  stripeSubscriptionId?: string | null;
}

export function isUnlimitedCuts(includedCuts: number | null | undefined): boolean {
  return includedCuts === null || includedCuts === undefined;
}

/** Cortes que le quedan. null = ilimitado. NUNCA negativo. */
export function remainingCuts(
  includedCuts: number | null | undefined,
  cutsUsed: number,
): number | null {
  if (isUnlimitedCuts(includedCuts)) return null;
  return Math.max(0, (includedCuts as number) - Math.max(0, cutsUsed));
}

/** Vigente = ACTIVE y todavía dentro del periodo. */
export function isMembershipCurrent(m: ClientMembershipState, now: Date): boolean {
  return m.status === "ACTIVE" && m.endAt.getTime() > now.getTime();
}

/** ¿Le queda cupo? Ilimitada siempre sí. */
export function hasQuota(m: ClientMembershipState): boolean {
  if (isUnlimitedCuts(m.includedCuts)) return true;
  return Math.max(0, m.cutsUsed) < (m.includedCuts as number);
}

export type MembershipCoverageReason =
  | "COVERED"
  | "NO_CLIENT"
  | "NO_MEMBERSHIP"
  | "EXPIRED"
  | "INACTIVE"
  | "QUOTA_EXHAUSTED"
  | "NO_ELIGIBLE_LINE"
  | "ALREADY_APPLIED";

/** Por qué (no) cubre esta membresía. Decide SIEMPRE el servidor. */
export function coverageReason(
  m: ClientMembershipState | null,
  now: Date,
): MembershipCoverageReason {
  if (!m) return "NO_MEMBERSHIP";
  if (m.status === "CANCELLED" || m.status === "PAUSED") return "INACTIVE";
  if (m.status === "EXPIRED" || m.endAt.getTime() <= now.getTime()) return "EXPIRED";
  if (!hasQuota(m)) return "QUOTA_EXHAUSTED";
  return "COVERED";
}

export function canConsumeCut(m: ClientMembershipState | null, now: Date): boolean {
  return coverageReason(m, now) === "COVERED";
}

/** ¿Se renueva sola? Solo la suscripción real de Stripe. */
export function isAutoRenewing(m: ClientMembershipState): boolean {
  return Boolean(m.stripeSubscriptionId);
}

export type MembershipUrgency = "EXPIRED" | "SOON" | "OK";

/** Cubeta para la lista del dueño: vencidas, por vencer y al corriente. */
export function membershipUrgency(
  m: ClientMembershipState,
  now: Date,
  soonDays = BARBER_MEMBERSHIP_SOON_DAYS,
): MembershipUrgency {
  if (m.status !== "ACTIVE") return m.status === "EXPIRED" ? "EXPIRED" : "OK";
  const left = daysUntil(m.endAt, now);
  if (left < 0) return "EXPIRED";
  if (left <= soonDays) return "SOON";
  return "OK";
}

/**
 * ¿Toca marcarla VENCIDA sola? Esto es lo que hace que una membresía de
 * EFECTIVO venza sin tocar Stripe. Las de Stripe esperan la gracia para no
 * parpadear mientras entra el cobro de renovación.
 */
export function shouldSweepToExpired(m: ClientMembershipState, now: Date): boolean {
  if (m.status !== "ACTIVE") return false;
  const graceDays = isAutoRenewing(m) ? BARBER_MEMBERSHIP_STRIPE_GRACE_DAYS : 0;
  return m.endAt.getTime() + graceDays * DAY_MS <= now.getTime();
}

// ═══════════════════════════════════════════════════════════════════════
// Descuento de un corte — el `where` ATÓMICO
// ═══════════════════════════════════════════════════════════════════════

/**
 * `where` del updateMany que descuenta UN corte. Todo el candado vive en el
 * WHERE (vigencia + cupo), así que Postgres re-evalúa la condición contra la
 * fila ya actualizada cuando dos peticiones llegan a la vez: la segunda
 * simplemente no encuentra fila y devuelve count 0. Por eso el cupo NUNCA
 * queda negativo y JAMÁS se lee-y-luego-escribe.
 *
 * `includedCuts` null (ilimitada) omite la condición de cupo a propósito.
 */
export function buildConsumeWhere(args: {
  clientMembershipId: string;
  barbershopId: string;
  includedCuts: number | null;
  now: Date;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: args.clientMembershipId,
    barbershopId: args.barbershopId,
    status: "ACTIVE",
    endAt: { gt: args.now },
  };
  if (!isUnlimitedCuts(args.includedCuts)) {
    base.cutsUsed = { lt: args.includedCuts as number };
  }
  return base;
}

// ═══════════════════════════════════════════════════════════════════════
// Líneas del ticket — marcadores compartidos con T3 (caja) y T5 (portal)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Prefijos RESERVADOS de BarberSaleItem.description. Son el marcador durable
 * que hace idempotentes el descuento de membresía y la aplicación del
 * anticipo: si una línea con este prefijo ya existe en cualquier ticket de la
 * visita, no se vuelve a aplicar. Se leen bien en el ticket impreso, así que
 * T3 puede pintarlos tal cual.
 */
export const BARBER_MEMBERSHIP_LINE_PREFIX = "Membresía · ";
export const BARBER_DEPOSIT_LINE_PREFIX = "Anticipo aplicado · ";

/**
 * La OTRA marca de "esta línea ya la cubrió la membresía": la que le pone
 * la caja (T3) al cerrar el ticket — sufijo en la descripción del servicio y
 * unitPrice en 0, en vez de una línea de crédito aparte.
 *
 * Se declara aquí en vez de importarla porque este módulo es client-safe y
 * src/lib/barber/cash.ts es server-only. La fuente de verdad sigue siendo
 * `MEMBERSHIP_SUFFIX` de ese archivo, y la prueba de contrato de esta ola
 * (contrato-caja.test.ts) falla si los dos textos dejan de coincidir.
 */
export const BARBER_CASH_MEMBERSHIP_SUFFIX = " · Membresía";

/** Reconoce las DOS marcas para que nada descuente dos veces la misma visita. */
export function isMembershipLine(description: string | null | undefined): boolean {
  if (typeof description !== "string") return false;
  // La línea de un ticket de mostrador («Venta de membresía · …») NO es un
  // corte cubierto, se llame como se llame el plan.
  if (isCounterTicketLine(description)) return false;
  return (
    description.startsWith(BARBER_MEMBERSHIP_LINE_PREFIX) ||
    description.endsWith(BARBER_CASH_MEMBERSHIP_SUFFIX)
  );
}

export function isDepositLine(description: string | null | undefined): boolean {
  return typeof description === "string" && description.startsWith(BARBER_DEPOSIT_LINE_PREFIX);
}

export function membershipLineDescription(planName: string, serviceName: string): string {
  return `${BARBER_MEMBERSHIP_LINE_PREFIX}${planName} — ${serviceName}`;
}

export function depositLineDescription(label: string): string {
  return `${BARBER_DEPOSIT_LINE_PREFIX}${label}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Tickets de mostrador que NO son una visita: venta/renovación de membresía
// y anticipo recibido
// ═══════════════════════════════════════════════════════════════════════
//
// Todo el dinero que entra por el mostrador pasa por un ticket (BarberSale)
// del turno abierto: así cae solo en el corte, en Inicio y en Reportes. Estos
// tres tickets llevan UNA línea sin servicio ni producto (no generan visita,
// ni sello de lealtad, ni comisión) y un sello en `notes` que dice a qué
// membresía o a qué cita pertenecen, para que CANCELAR el ticket pueda
// deshacer también la membresía o el anticipo.
//
// Por qué el sello vive en `notes` y no en una columna: el schema no tiene
// dónde ligar un ticket con una membresía ni guardar el estado anterior de
// una renovación, y una columna nueva sería un SQL manual más. `notes` ya
// carga la marca de cancelación (CANCELLED_MARK) con el mismo criterio. El
// sello es UNA línea que empieza con BARBER_SALE_TAG_PREFIX; la caja no deja
// que una nota escrita a mano lo contenga y nunca lo muestra en pantalla.

export const BARBER_MEMBERSHIP_SALE_LINE_PREFIX = "Venta de membresía · ";
export const BARBER_MEMBERSHIP_RENEWAL_LINE_PREFIX = "Renovación de membresía · ";
export const BARBER_DEPOSIT_RECEIVED_LINE_PREFIX = "Anticipo recibido · ";
/**
 * Devolución de un anticipo cobrado en mostrador: ticket NEGATIVO en el turno
 * abierto del día en que se devuelve, con el método con que sale el dinero.
 * Baja el esperado de ese turno y el ingreso del mes (el ticket original, que
 * puede estar en un turno ya cerrado, no se toca).
 */
export const BARBER_DEPOSIT_REFUND_LINE_PREFIX = "Devolución de anticipo · ";

export function depositRefundLineDescription(label: string): string {
  return `${BARBER_DEPOSIT_REFUND_LINE_PREFIX}${label}`;
}

/** ¿Es la línea de una devolución de anticipo (ticket negativo)? */
export function isDepositRefundLine(description: string | null | undefined): boolean {
  return typeof description === "string" && description.startsWith(BARBER_DEPOSIT_REFUND_LINE_PREFIX);
}

export function membershipSaleLineDescription(planName: string, renewal = false): string {
  return `${renewal ? BARBER_MEMBERSHIP_RENEWAL_LINE_PREFIX : BARBER_MEMBERSHIP_SALE_LINE_PREFIX}${planName}`;
}

export function depositReceivedLineDescription(label: string): string {
  return `${BARBER_DEPOSIT_RECEIVED_LINE_PREFIX}${label}`;
}

/** ¿Es la línea de un ticket de mostrador (membresía vendida o anticipo recibido)? */
export function isCounterTicketLine(description: string | null | undefined): boolean {
  if (typeof description !== "string") return false;
  return (
    description.startsWith(BARBER_MEMBERSHIP_SALE_LINE_PREFIX) ||
    description.startsWith(BARBER_MEMBERSHIP_RENEWAL_LINE_PREFIX) ||
    description.startsWith(BARBER_DEPOSIT_RECEIVED_LINE_PREFIX) ||
    description.startsWith(BARBER_DEPOSIT_REFUND_LINE_PREFIX)
  );
}

export const BARBER_SALE_TAG_PREFIX = "#dcb ";

/** Estado de la membresía ANTES de una renovación (para poder deshacerla). */
export interface BarberMembershipSnapshot {
  start: string;
  end: string;
  cuts: number;
  status: string;
  method: string;
}

export type BarberSaleTag =
  | { k: "deposit"; appt: string }
  /** Devolución (ticket negativo) del anticipo de esa cita. */
  | { k: "refund"; appt: string }
  | {
      k: "membership";
      /**
       * sell = venta; renew = renovación que REINICIÓ la misma fila (ya
       * vencida); extend = renovación anticipada que agregó un periodo NUEVO
       * (fila propia, con sus fechas y su cupo — decisión D1, 15-nov).
       */
      op: "sell" | "renew" | "extend";
      /** id de BarberClientMembership. */
      cm: string;
      /** endAt que dejó este ticket: si ya no coincide, alguien la movió después. */
      end: string;
      prev?: BarberMembershipSnapshot;
    };

export type BarberSaleKind = "sale" | "membership" | "deposit" | "refund";

export function buildSaleTag(tag: BarberSaleTag): string {
  // El orden de las llaves es FIJO: depositTagNeedle() busca ese texto exacto.
  const canon =
    tag.k === "deposit" || tag.k === "refund"
      ? { k: tag.k, appt: tag.appt }
      : { k: tag.k, op: tag.op, cm: tag.cm, end: tag.end, ...(tag.prev ? { prev: tag.prev } : {}) };
  return `${BARBER_SALE_TAG_PREFIX}${JSON.stringify(canon)}`;
}

function isSnapshot(v: unknown): v is BarberMembershipSnapshot {
  const o = v as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o === "object" &&
    typeof o.start === "string" &&
    typeof o.end === "string" &&
    typeof o.cuts === "number" &&
    Number.isInteger(o.cuts) &&
    o.cuts >= 0 &&
    typeof o.status === "string" &&
    typeof o.method === "string"
  );
}

/** Lee el sello de un ticket (o null). Tolera la marca de cancelación delante. */
export function parseSaleTag(notes: string | null | undefined): BarberSaleTag | null {
  if (typeof notes !== "string" || notes.indexOf(BARBER_SALE_TAG_PREFIX) < 0) return null;
  for (const line of notes.split("\n")) {
    if (!line.startsWith(BARBER_SALE_TAG_PREFIX)) continue;
    try {
      const raw = JSON.parse(line.slice(BARBER_SALE_TAG_PREFIX.length)) as Record<string, unknown>;
      if ((raw.k === "deposit" || raw.k === "refund") && typeof raw.appt === "string" && raw.appt) {
        return { k: raw.k, appt: raw.appt };
      }
      if (
        raw.k === "membership" &&
        (raw.op === "sell" || raw.op === "renew" || raw.op === "extend") &&
        typeof raw.cm === "string" &&
        raw.cm &&
        typeof raw.end === "string"
      ) {
        if (raw.op === "renew" && !isSnapshot(raw.prev)) return null;
        return {
          k: "membership",
          op: raw.op,
          cm: raw.cm,
          end: raw.end,
          ...(raw.op === "renew" ? { prev: raw.prev as BarberMembershipSnapshot } : {}),
        };
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Las notas SIN el sello ni la bitácora de cambios de método (lo único que se
 * le enseña a una persona).
 */
export function stripSaleTag(notes: string | null | undefined): string | null {
  if (typeof notes !== "string") return null;
  if (notes.indexOf(BARBER_SALE_TAG_PREFIX) < 0 && notes.indexOf(METHOD_CHANGE_PREFIX) < 0) return notes;
  const kept = notes
    .split("\n")
    .filter((line) => !line.startsWith(BARBER_SALE_TAG_PREFIX) && !line.startsWith(METHOD_CHANGE_PREFIX))
    .join("\n")
    .trim();
  return kept || null;
}

export function saleKindOf(notes: string | null | undefined): BarberSaleKind {
  const tag = parseSaleTag(notes);
  return tag ? tag.k : "sale";
}

/** Texto que busca, en `notes`, el ticket de anticipo de UNA cita. */
export function depositTagNeedle(appointmentId: string): string {
  return `"k":"deposit","appt":"${appointmentId}"`;
}

/** Línea de servicio del ticket, tal como la ve el núcleo (dinero en centavos). */
export interface MembershipCoverageLine {
  serviceId: string | null;
  description: string;
  /** Precio unitario en CENTAVOS. */
  unitPriceCents: number;
  qty: number;
}

/**
 * Qué línea cubre la membresía. Una visita descuenta UN corte y se aplica al
 * servicio MÁS CARO del ticket (lo que más le conviene al cliente). Ignora
 * productos, líneas libres, líneas en $0 y las líneas marcadoras.
 * Devuelve el índice o -1.
 */
export function pickCoveredLine(lines: MembershipCoverageLine[]): number {
  let best = -1;
  let bestPrice = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || !l.serviceId) continue;
    if (isMembershipLine(l.description) || isDepositLine(l.description)) continue;
    if (l.unitPriceCents <= 0) continue;
    if (l.unitPriceCents > bestPrice) {
      bestPrice = l.unitPriceCents;
      best = i;
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════
// Validación del plan que define la barbería
// ═══════════════════════════════════════════════════════════════════════

export interface MembershipPlanInput {
  name: string;
  description: string | null;
  /** Precio en CENTAVOS. */
  priceCents: number;
  /** null = cortes ilimitados. */
  includedCuts: number | null;
  periodDays: number;
  isActive: boolean;
  sortOrder: number;
}

export const MEMBERSHIP_MAX_PERIOD_DAYS = 365;
export const MEMBERSHIP_MAX_INCLUDED_CUTS = 999;

/**
 * Resultado de validar el formulario. Un solo objeto con los dos campos
 * opcionales (y no una unión discriminada) porque el repo compila con
 * `strict: false` y ahí TypeScript no estrecha por `ok`.
 */
export interface MembershipPlanInputResult {
  ok: boolean;
  value?: MembershipPlanInput;
  error?: string;
}

/** Valida y NORMALIZA lo que llega del formulario. Nunca confía en el cliente. */
export function normalizeMembershipPlanInput(raw: unknown): MembershipPlanInputResult {
  const b = (raw ?? {}) as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "El nombre de la membresía es obligatorio." };
  if (name.length > 80) return { ok: false, error: "El nombre no puede pasar de 80 caracteres." };

  const description =
    typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 500) : null;

  const priceCents = moneyToCents(
    typeof b.price === "string" || typeof b.price === "number" ? (b.price as string | number) : 0,
  );
  if (priceCents <= 0) return { ok: false, error: "El precio debe ser mayor a cero." };
  if (priceCents > 99_999_999) return { ok: false, error: "El precio es demasiado alto." };

  const unlimited = b.unlimited === true || b.includedCuts === null;
  let includedCuts: number | null = null;
  if (!unlimited) {
    const n = Number(b.includedCuts);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
      return { ok: false, error: "Los cortes incluidos deben ser un número entero de 1 o más (o marca ilimitado)." };
    }
    if (n > MEMBERSHIP_MAX_INCLUDED_CUTS) {
      return { ok: false, error: `Máximo ${MEMBERSHIP_MAX_INCLUDED_CUTS} cortes incluidos.` };
    }
    includedCuts = n;
  }

  const periodRaw = Number(b.periodDays);
  const periodDays = Number.isFinite(periodRaw) ? Math.round(periodRaw) : 30;
  if (periodDays < 1 || periodDays > MEMBERSHIP_MAX_PERIOD_DAYS) {
    return { ok: false, error: `La duración del periodo debe ir de 1 a ${MEMBERSHIP_MAX_PERIOD_DAYS} días.` };
  }

  const sortRaw = Number(b.sortOrder);
  return {
    ok: true,
    value: {
      name,
      description,
      priceCents,
      includedCuts,
      periodDays,
      isActive: b.isActive === undefined ? true : b.isActive === true,
      sortOrder: Number.isFinite(sortRaw) ? Math.round(sortRaw) : 0,
    },
  };
}

/** "2 cortes cada 30 días" / "Cortes ilimitados al mes". */
export function describeMembershipPlan(
  plan: { includedCuts: number | null; periodDays: number },
  locale = "es",
): string {
  const en = locale === "en";
  const period =
    plan.periodDays === 30
      ? en ? "per month" : "al mes"
      : plan.periodDays === 15
        ? en ? "every 2 weeks" : "cada quincena"
        : plan.periodDays === 7
          ? en ? "per week" : "a la semana"
          : plan.periodDays === 365
            ? en ? "per year" : "al año"
            : en ? `every ${plan.periodDays} days` : `cada ${plan.periodDays} días`;

  if (isUnlimitedCuts(plan.includedCuts)) {
    return en ? `Unlimited cuts ${period}` : `Cortes ilimitados ${period}`;
  }
  const n = plan.includedCuts as number;
  if (en) return `${n} ${n === 1 ? "cut" : "cuts"} ${period}`;
  return `${n} ${n === 1 ? "corte" : "cortes"} ${period}`;
}

// ═══════════════════════════════════════════════════════════════════════
// DTOs que consumen el panel, T3 (ticket) y T5 (portal del cliente)
// ═══════════════════════════════════════════════════════════════════════

/** Plan de membresía tal como lo pinta la UI (Decimal → number). */
export interface BarberMembershipPlanView {
  id: string;
  name: string;
  description: string | null;
  price: number;
  includedCuts: number | null;
  periodDays: number;
  isActive: boolean;
  sortOrder: number;
  /** Cuántos clientes la tienen ACTIVE y vigente ahora mismo. */
  activeCount: number;
}

/** Suscripción de un cliente, ya resuelta para la lista del dueño / portal. */
export interface BarberClientMembershipView {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  membershipId: string;
  membershipName: string;
  status: BarberClientMembershipStatus;
  startAt: string;
  endAt: string;
  cutsUsed: number;
  includedCuts: number | null;
  remaining: number | null;
  paymentMethod: BarberPaymentMethod;
  autoRenew: boolean;
  urgency: MembershipUrgency;
  daysLeft: number;
  price: number;
  periodDays: number;
  /**
   * Periodos ya pagados que empiezan cuando termina éste (renovación
   * anticipada, D1). Cada uno trae SU cupo; no se gastan antes de tiempo.
   */
  nextPeriods?: Array<{ id: string; startAt: string; endAt: string; includedCuts: number | null }>;
}

/** Resultado de intentar cubrir una visita con la membresía. */
export interface MembershipCoverageResult {
  covered: boolean;
  reason: MembershipCoverageReason;
  clientMembershipId: string | null;
  membershipName: string | null;
  /** Índice de la línea cubierta dentro del array recibido (-1 si ninguna). */
  coveredLineIndex: number;
  /** Cuánto se descuenta, en CENTAVOS (siempre >= 0). */
  discountCents: number;
  cutsUsed: number;
  includedCuts: number | null;
  remaining: number | null;
  /** Línea de crédito sugerida para el ticket (la inserta T3 o esta lib). */
  creditLine: { description: string; unitPriceCents: number; qty: number } | null;
}

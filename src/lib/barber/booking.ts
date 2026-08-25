import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import { mxTenDigits } from "@/lib/phone-mx";
import { isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";
import { getBarberPlan } from "@/lib/barber/plans";
import { canTransition } from "@/lib/barber/types";
// De T1 (agenda del panel): reconoce el rechazo de la constraint EXCLUDE
// barber_appt_no_overlap (SQLSTATE 23P01) de sql/barber_agenda.sql.
import { isBarberOverlapError } from "@/lib/barber/agenda";
import {
  BARBER_BUSY_STATUSES,
  BARBER_MAX_DAYS_AHEAD,
  BARBER_MAX_OPEN_PER_PHONE,
  BARBER_MIN_LEAD_MIN,
  advisoryLockKey,
  addIsoDays,
  barberNowMinutes,
  barberTodayISO,
  barberTzLocalToUtc,
  computeFreeBarbersForDay,
  isValidIsoDate,
  isoDaysBetween,
  parseHhMm,
  pickLeastBusy,
  pickPublicShop,
  shortReference,
  toPublicSlots,
  type AvailabilityData,
  type BarberSlotDTO,
  type PublicBarbershopDTO,
  type BusyInterval,
} from "@/lib/barber/booking-core";

/**
 * El núcleo PURO (parámetros del embudo, zona horaria, rejilla de huecos,
 * clave del candado) vive en ./booking-core y se re-exporta desde aquí: los
 * consumidores siguen importando de "@/lib/barber/booking" y las pruebas
 * pueden cargar el núcleo sin arrastrar prisma.
 */
export * from "@/lib/barber/booking-core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — motor de la RESERVA PÚBLICA (/b/[slug]/reservar).
   ═══════════════════════════════════════════════════════════════════════

   El ángulo del producto: el cliente reserva SIN cuenta, SIN contraseña y
   SIN instalar nada, y el cliente es de la barbería (no de un marketplace).
   Todo lo que hay aquí sirve a eso.

   REGLAS QUE ESTE MÓDULO SOSTIENE
   ────────────────────────────────────────────────────────────────────────
   1. El tenant se resuelve SIEMPRE por el slug de la URL, en el servidor.
      Ninguna función de aquí acepta un barbershopId que venga del cliente.
   2. Los precios salen de BarberService (nunca hardcodeados) y se CONGELAN
      en BarberAppointmentService.priceAtBooking al reservar.
   3. Jamás se ofrece un hueco que la base vaya a rechazar: los huecos
      respetan BarberSchedule (horario recurrente), BarberTimeOff (bloqueos
      y días cerrados) y las citas ya existentes, con la duración REAL de
      los servicios elegidos.
   4. Dos personas sobre el mismo hueco: la decisión la toma la BASE, no la
      UI — candado de transacción de Postgres (pg_advisory_xact_lock) por
      (barbería, día) + re-verificación de solape DENTRO de la transacción.
      Ver createPublicBooking.

   ZONA HORARIA
   ────────────────────────────────────────────────────────────────────────
   Los helpers de tz son un ESPEJO puro de los del dental
   (src/lib/agenda/time-utils.ts). Se replican a propósito: el vertical
   barber no cuelga de módulos del producto dental (mismo criterio que
   permissions.ts y plans.ts en la Ola 0). Son funciones puras de ~20
   líneas; el costo de duplicarlas es menor que el de acoplarse.

   FRONTERAS (lo que este módulo NO hace)
   ────────────────────────────────────────────────────────────────────────
   · T1 es dueño de la agenda del panel. El cálculo de huecos de aquí es
     PROPIO de la reserva pública; cuando T1 exponga el suyo, se consolida
     en un solo punto (ver nota en el reporte).
   · T4 es dueño de los anticipos: resolveDepositForBooking() es el punto
     de integración y hoy devuelve null a propósito.
   · El WhatsApp lo manda la ola T7 (src/lib/barber/whatsapp.ts):
     notifyBookingCreated() YA está conectado y ENCOLA la confirmación.
   ═══════════════════════════════════════════════════════════════════════ */

/** Cliente Prisma o el `tx` de una transacción — las lecturas sirven en ambos. */
type Db = PrismaClient | Prisma.TransactionClient;

// ── Teléfono ────────────────────────────────────────────────────────────

/**
 * Punto ÚNICO de normalización del teléfono del cliente. Todo el vertical
 * (reserva y portal) guarda y busca con ESTE formato — si el alta y la
 * búsqueda normalizaran distinto, el índice único (barbershopId, phone)
 * dejaría de servir y nacerían clientes duplicados.
 */
export function normalizeBarberPhone(raw: unknown): string | null {
  return mxTenDigits(typeof raw === "string" ? raw : "");
}

// ── La barbería, resuelta por slug (SOLO campos públicos) ───────────────

/**
 * Lo que se LEE de la base. Ojo: no es lo mismo que lo que SALE al navegador
 * — los tres últimos campos solo deciden si la barbería puede recibir
 * reservas y los recorta pickPublicShop (lista blanca en ./booking-core).
 */
const PUBLIC_SHOP_SELECT = {
  id: true,
  name: true,
  slug: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  timezone: true,
  locale: true,
  logoUrl: true,
  branchName: true,
  // Los tres de abajo NO viajan al navegador: solo deciden si la barbería
  // puede recibir reservas. Se recortan en toPublicShop().
  plan: true,
  isActive: true,
  subscriptionStatus: true,
} satisfies Prisma.BarbershopSelect;

export type BarbershopBookingRow = Prisma.BarbershopGetPayload<{
  select: typeof PUBLIC_SHOP_SELECT;
}>;
type ShopRow = BarbershopBookingRow;

/**
 * Recorta la fila a lo que SÍ puede salir al navegador. La lista blanca vive
 * en ./booking-core (PUBLIC_SHOP_FIELDS) y está probada: ver
 * __tests__/salida-publica.test.ts.
 */
export function toPublicShop(row: ShopRow): PublicBarbershopDTO {
  return pickPublicShop(row as unknown as Record<string, unknown>);
}

export interface BookingGateOk {
  ok: true;
  shop: BarbershopBookingRow;
}
export interface BookingGateErr {
  ok: false;
  reason: "notFound" | "inactive" | "planOff";
}
export type BarbershopBookingGate = BookingGateOk | BookingGateErr;

/**
 * GUARDA DE TIPO — el tsconfig del repo compila con strict:false, y sin
 * strictNullChecks TypeScript NO estrecha una union por su discriminante
 * booleano. Sin esta guarda, `if (!gate.ok)` deja el tipo igual que estaba y
 * leer `gate.reason` es un error de compilación. Mismo motivo en las otras
 * dos uniones de este módulo.
 */
export function isBookingGateOk(gate: BarbershopBookingGate): gate is BookingGateOk {
  return gate.ok === true;
}

/**
 * Resuelve el slug y decide si esa barbería puede recibir reservas hoy.
 *
 * Una barbería suspendida (o con la suscripción impaga) NO recibe reservas:
 * mandarle citas que nadie va a ver en el panel deja plantado a un cliente
 * real. Y la feature `publicBooking` se le pregunta al plan aunque hoy la
 * tengan los tres — el gate es del plan, no una suposición del código.
 */
export async function resolveBookingGate(slug: string): Promise<BarbershopBookingGate> {
  if (typeof slug !== "string" || !slug.trim()) return { ok: false, reason: "notFound" };
  const row = await prisma.barbershop.findUnique({
    where: { slug: slug.trim() },
    select: PUBLIC_SHOP_SELECT,
  });
  if (!row) return { ok: false, reason: "notFound" };
  if (!row.isActive || !isBarbershopSubscriptionActive(row)) {
    return { ok: false, reason: "inactive" };
  }
  const plan = await getBarberPlan(row.plan);
  if (plan.features.publicBooking !== true) return { ok: false, reason: "planOff" };
  return { ok: true, shop: row };
}

// ── Catálogo público ────────────────────────────────────────────────────

export interface PublicServiceDTO {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  /** Precio VIVO de BarberService. Jamás hardcodeado. */
  price: number;
  category: string;
}

export interface PublicBarberDTO {
  id: string;
  name: string;
  nickname: string | null;
  photoUrl: string | null;
  bio: string | null;
}

/** Servicios activos de la barbería, en el orden que la barbería definió. */
export async function getPublicServices(barbershopId: string): Promise<PublicServiceDTO[]> {
  const rows = await prisma.barberService.findMany({
    where: { barbershopId, isActive: true },
    select: {
      id: true, name: true, description: true,
      durationMin: true, price: true, category: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    durationMin: s.durationMin,
    price: Number(s.price),
    category: s.category,
  }));
}

/**
 * Barberos que el público puede elegir. Se devuelven SOLO los campos de
 * vitrina: nada de comisiones, renta de silla ni sueldo.
 */
export async function getPublicBarbers(barbershopId: string): Promise<PublicBarberDTO[]> {
  const rows = await prisma.barber.findMany({
    where: { barbershopId, isActive: true },
    select: { id: true, name: true, nickname: true, photoUrl: true, bio: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows;
}

// ── Política de confirmación ────────────────────────────────────────────

export type BarberBookingPolicy = "auto" | "manual";

/**
 * ¿La reserva pública se confirma sola o pasa por la bandeja de solicitudes?
 *
 *   "manual" (DEFAULT) → la cita nace PENDING y la barbería la acepta o
 *                        rechaza en /barber/solicitudes.
 *   "auto"             → la cita nace CONFIRMED.
 *
 * En AMBOS modos la cita EXISTE y aparta el hueco: la diferencia es el
 * estado, no la reserva. (Distinto del dental, donde la solicitud pública
 * no llega a apartar el horario por sí sola.)
 *
 * DÓNDE VIVE EL INTERRUPTOR: hoy en ningún lado. El schema del vertical no
 * tiene columna para esto y esta ola NO puede tocarlo, así que se lee —
 * solo se LEE, jamás se escribe — la llave `bookingPolicy` del Json de
 * BarberLandingConfig (dueño: T8), y si no está, gana el default seguro.
 * Cuando exista `Barbershop.bookingPolicy` (o la pantalla de configuración
 * de T5), se cambia AQUÍ y en ningún otro lugar: es el punto único.
 */
export async function resolveBookingPolicy(barbershopId: string): Promise<BarberBookingPolicy> {
  try {
    const row = await prisma.barberLandingConfig.findUnique({
      where: { barbershopId },
      select: { config: true },
    });
    const cfg = row?.config;
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
      const value = (cfg as Record<string, unknown>).bookingPolicy;
      if (value === "auto") return "auto";
    }
  } catch {
    // La tabla puede no existir todavía en este entorno: el default manda.
  }
  return "manual";
}

// ── Anticipos (T4) ──────────────────────────────────────────────────────

/**
 * PUNTO DE INTEGRACIÓN — anticipos anti no-show (feature `deposits`, planes
 * Avanzado y Profesional). T4 es dueño del flujo de cobro; esta ola NO lo
 * implementa. Cuando T4 exponga "cuánto anticipo pide esta barbería por
 * estos servicios", se resuelve aquí y el resultado se escribe en
 * BarberAppointment.depositAmount / depositStatus.
 */
export async function resolveDepositForBooking(_args: {
  barbershopId: string;
  serviceIds: string[];
  total: number;
}): Promise<{ amount: number; status: "PENDING" } | null> {
  return null;
}

// ── WhatsApp (T7) ───────────────────────────────────────────────────────

/**
 * Aviso de reserva — CONECTADO a WhatsApp por la ola T7.
 *
 * ENCOLA la confirmación (plantilla de utilidad `dc_barber_reserva_confirmada`)
 * en vez de mandarla aquí mismo: el cliente acaba de ver la pantalla de
 * "listo", así que un minuto de diferencia no rompe nada y a cambio el flujo
 * de reserva NUNCA se queda esperando a Meta ni falla porque Meta falle.
 *
 * `queueBarberBookingConfirmation` es idempotente: una reserva no confirma
 * dos veces aunque el flujo se reintente.
 *
 * Fuera de producción deja rastro en el log del servidor para poder verificar
 * el flujo sin WhatsApp conectado; en producción no loguea datos del cliente.
 */
export async function notifyBookingCreated(payload: {
  barbershopId: string;
  appointmentId: string;
  policy: BarberBookingPolicy;
}): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[barber/reserva] cita ${payload.appointmentId} creada (${payload.policy}) — encolando el aviso de WhatsApp`,
    );
  }
  try {
    const { queueBarberBookingConfirmation } = await import("@/lib/barber/whatsapp");
    await queueBarberBookingConfirmation({
      barbershopId: payload.barbershopId,
      appointmentId: payload.appointmentId,
    });
  } catch (err) {
    // La reserva YA está creada y es lo que importa. Un aviso que no se pudo
    // encolar no puede tumbarla.
    console.error(`[barber/reserva] aviso no encolado (${payload.appointmentId}):`, err);
  }
}

// ── Huecos reales ───────────────────────────────────────────────────────


export interface AvailabilityInput {
  shop: { id: string; timezone: string };
  /** "YYYY-MM-DD" en la zona de la barbería. */
  dateISO: string;
  /** Duración TOTAL de los servicios elegidos. */
  durationMin: number;
  /** null = "cualquier barbero disponible". */
  barberId: string | null;
  now?: Date;
  db?: Db;
}

/**
 * Barberos libres por horario para un día. Devuelve, por cada hueco de la
 * rejilla, QUIÉNES pueden atenderlo — el llamador decide si lo publica como
 * un conteo (API pública) o si toma uno para asignarlo (creación de cita).
 *
 * Un hueco existe si, para algún barbero:
 *   · cae completo dentro de un turno suyo de BarberSchedule ese día;
 *   · no lo pisa un BarberTimeOff suyo NI uno de barbería completa;
 *   · no se solapa con ninguna cita suya que ocupe el sillón.
 */
export async function getFreeBarbersByTime(
  input: AvailabilityInput,
): Promise<Map<string, string[]>> {
  const { shop, dateISO, durationMin, barberId } = input;
  const now = input.now ?? new Date();
  if (durationMin <= 0) return new Map();
  const data = await loadAvailabilityData({
    db: input.db ?? prisma,
    shop,
    barberId,
    fromISO: dateISO,
    days: 1,
  });
  return computeFreeBarbersForDay(data, dateISO, durationMin, shop.timezone, now);
}

/** Los huecos del día tal como se publican: hora + cuántos barberos hay. */
export async function getPublicSlots(input: AvailabilityInput): Promise<BarberSlotDTO[]> {
  const free = await getFreeBarbersByTime(input);
  return toPublicSlots(free);
}

/**
 * Qué días de un rango tienen al menos un hueco — para que el selector de
 * fecha nazca con los días muertos ya apagados y el cliente no vaya tocando
 * uno por uno (en móvil eso es abandono puro).
 *
 * UNA sola tanda de lecturas para TODO el rango, no tres por día.
 */
export async function getOpenDays(args: {
  shop: { id: string; timezone: string };
  fromISO: string;
  days: number;
  durationMin: number;
  barberId: string | null;
  now?: Date;
}): Promise<string[]> {
  const { shop, fromISO, days, durationMin, barberId } = args;
  const now = args.now ?? new Date();
  if (durationMin <= 0 || days <= 0) return [];
  const data = await loadAvailabilityData({ db: prisma, shop, barberId, fromISO, days });
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const dateISO = addIsoDays(fromISO, i);
    const free = computeFreeBarbersForDay(data, dateISO, durationMin, shop.timezone, now);
    if (free.size > 0) out.push(dateISO);
  }
  return out;
}


// ── Motor de disponibilidad: cargar una vez, calcular por día ───────────

/**
 * Trae de la base TODO lo que hace falta para calcular los huecos de un
 * rango de días: barberos, horarios, bloqueos y citas. Una sola tanda de
 * lecturas para el rango entero — no tres por día.
 */
async function loadAvailabilityData(args: {
  db: Db;
  shop: { id: string; timezone: string };
  barberId: string | null;
  fromISO: string;
  days: number;
}): Promise<AvailabilityData> {
  const { db, shop, barberId, fromISO, days } = args;

  const barbers = await db.barber.findMany({
    where: {
      barbershopId: shop.id,
      isActive: true,
      ...(barberId ? { id: barberId } : {}),
    },
    select: { id: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const barberIds = barbers.map((b) => b.id);
  const empty: AvailabilityData = { barberIds, schedules: [], busyByBarber: new Map() };
  if (barberIds.length === 0) return empty;

  const rangeStart = barberTzLocalToUtc(fromISO, 0, 0, shop.timezone);
  const rangeEnd = barberTzLocalToUtc(addIsoDays(fromISO, days), 0, 0, shop.timezone);

  const [schedules, timeOff, appointments] = await Promise.all([
    db.barberSchedule.findMany({
      where: { barbershopId: shop.id, barberId: { in: barberIds }, isActive: true },
      select: { barberId: true, dayOfWeek: true, startMinute: true, endMinute: true },
    }),
    db.barberTimeOff.findMany({
      where: {
        barbershopId: shop.id,
        // barberId null = la barbería ENTERA cerrada (p.ej. festivo).
        OR: [{ barberId: { in: barberIds } }, { barberId: null }],
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      select: { barberId: true, startAt: true, endAt: true },
    }),
    db.barberAppointment.findMany({
      where: {
        barbershopId: shop.id,
        barberId: { in: barberIds },
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
        status: { in: [...BARBER_BUSY_STATUSES] },
      },
      select: { barberId: true, startAt: true, endAt: true },
    }),
  ]);

  // Bloqueos de barbería completa: pisan a todos por igual.
  const shopWide: BusyInterval[] = timeOff
    .filter((t) => t.barberId === null)
    .map((t) => ({ startMs: t.startAt.getTime(), endMs: t.endAt.getTime() }));

  const busyByBarber = new Map<string, BusyInterval[]>();
  for (const id of barberIds) busyByBarber.set(id, shopWide.slice());
  for (const t of timeOff) {
    if (!t.barberId) continue;
    busyByBarber.get(t.barberId)?.push({ startMs: t.startAt.getTime(), endMs: t.endAt.getTime() });
  }
  for (const a of appointments) {
    if (!a.barberId) continue;
    busyByBarber.get(a.barberId)?.push({ startMs: a.startAt.getTime(), endMs: a.endAt.getTime() });
  }

  return { barberIds, schedules, busyByBarber };
}

// ── Creación de la cita ─────────────────────────────────────────────────


export type BookingErrorCode =
  | "shopNotFound"
  | "shopInactive"
  | "planOff"
  | "badRequest"
  | "noServices"
  | "badBarber"
  | "pastDate"
  | "tooFar"
  | "slotTaken"
  | "tooManyOpen"
  | "clientBlocked";

export interface BookingResultOk {
  ok: true;
  /** Referencia corta para el cliente (no es el id de la cita). */
  reference: string;
  status: "PENDING" | "CONFIRMED";
  policy: BarberBookingPolicy;
  startAt: string;
  endAt: string;
  barberName: string | null;
  services: { name: string; price: number }[];
  total: number;
  /** true si esta llamada NO creó nada (doble envío del mismo formulario). */
  duplicate: boolean;
}

export interface BookingResultErr {
  ok: false;
  code: BookingErrorCode;
}

export type BookingResult = BookingResultOk | BookingResultErr;

/** Guarda de tipo (ver isBookingGateOk). */
export function isBookingError(result: BookingResult): result is BookingResultErr {
  return result.ok === false;
}

export interface CreateBookingInput {
  shop: ShopRow;
  serviceIds: string[];
  barberId: string | null;
  dateISO: string;
  time: string;
  clientName: string;
  phone: string;
  notes: string | null;
  now?: Date;
  /**
   * Canal que crea la cita. Default PUBLIC (la reserva de /b/[slug]).
   * El bot de WhatsApp manda WHATSAPP para que la agenda y el historial
   * del panel sepan que esa cita se cerró sola en el chat.
   */
  source?: "PUBLIC" | "WHATSAPP";
  /**
   * true = NO encolar la confirmación por WhatsApp. Lo usa el bot: el
   * cliente está leyendo la respuesta en ese mismo chat, y mandarle
   * además la plantilla sería gastarle un mensaje del plan para
   * decirle dos veces lo mismo.
   */
  skipNotify?: boolean;
}

/**
 * Crea la cita de una reserva pública.
 *
 * CARRERA POR EL MISMO HUECO — cómo se resuelve, y por qué así:
 *
 * El vertical barber no tiene (todavía) una constraint EXCLUDE de no-solape
 * como la que sí tiene el producto dental, y esta ola no puede crearla:
 * una constraint dura cambiaría el comportamiento de la agenda del panel,
 * que es de T1 (el panel a veces empalma a propósito). Lo que sí se puede
 * hacer sin tocar el schema es que la decisión la tome POSTGRES:
 *
 *   1. pg_advisory_xact_lock por (barbería, día) — dos reservas del mismo
 *      día de la misma barbería se SERIALIZAN dentro de la base; la segunda
 *      espera a que la primera haga commit.
 *   2. Ya con el candado tomado, se vuelve a calcular quién está libre
 *      LEYENDO DENTRO de la transacción — o sea, viendo ya la cita que
 *      acaba de commitear la primera.
 *   3. Si no queda nadie libre → "slotTaken" (409).
 *
 * El candado se suelta solo al terminar la transacción (xact), incluso si
 * revienta, así que no hay forma de dejarlo colgado. La verificación de la
 * UI (los huecos que se pintaron) es solo cortesía: quien decide es el paso 2.
 */
export async function createPublicBooking(
  input: CreateBookingInput,
): Promise<BookingResult> {
  const { shop, dateISO, time } = input;
  const now = input.now ?? new Date();

  // ── Forma ────────────────────────────────────────────────────────────
  if (!isValidIsoDate(dateISO)) return { ok: false, code: "badRequest" };
  const startMinute = parseHhMm(time);
  if (startMinute === null) return { ok: false, code: "badRequest" };

  const name = input.clientName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return { ok: false, code: "badRequest" };

  const phone = normalizeBarberPhone(input.phone);
  if (!phone) return { ok: false, code: "badRequest" };

  const serviceIds = Array.from(
    new Set((input.serviceIds ?? []).filter((s): s is string => typeof s === "string" && !!s)),
  ).slice(0, 6);
  if (serviceIds.length === 0) return { ok: false, code: "noServices" };

  // ── Ventana de fechas ────────────────────────────────────────────────
  const todayISO = barberTodayISO(shop.timezone, now);
  if (dateISO < todayISO) return { ok: false, code: "pastDate" };
  if (isoDaysBetween(todayISO, dateISO) > BARBER_MAX_DAYS_AHEAD) {
    return { ok: false, code: "tooFar" };
  }
  if (dateISO === todayISO && startMinute <= barberNowMinutes(shop.timezone, now) + BARBER_MIN_LEAD_MIN) {
    return { ok: false, code: "pastDate" };
  }

  // ── Servicios: existen, son de ESTA barbería y están activos ─────────
  const services = await prisma.barberService.findMany({
    where: { id: { in: serviceIds }, barbershopId: shop.id, isActive: true },
    select: { id: true, name: true, durationMin: true, price: true },
  });
  if (services.length !== serviceIds.length) return { ok: false, code: "noServices" };
  const durationMin = services.reduce((acc, s) => acc + s.durationMin, 0);
  if (durationMin <= 0 || durationMin > 600) return { ok: false, code: "noServices" };
  const total = services.reduce((acc, s) => acc + Number(s.price), 0);

  // ── Barbero pedido: tiene que ser de ESTA barbería y estar activo ────
  // Un id ajeno NO se degrada silenciosamente a "cualquiera": el cliente
  // eligió a alguien y merece saber que ya no está disponible.
  let requestedBarberId: string | null = null;
  if (input.barberId && input.barberId !== "any") {
    const b = await prisma.barber.findFirst({
      where: { id: input.barberId, barbershopId: shop.id, isActive: true },
      select: { id: true },
    });
    if (!b) return { ok: false, code: "badBarber" };
    requestedBarberId = b.id;
  }

  const startAt = barberTzLocalToUtc(
    dateISO, Math.floor(startMinute / 60), startMinute % 60, shop.timezone,
  );
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);

  // ── Anti-abuso por teléfono ──────────────────────────────────────────
  // Un límite por IP no alcanza: una IP móvil rota sola. El tope real es
  // "cuántas citas futuras vivas puede tener UN teléfono en ESTA barbería".
  const openForPhone = await prisma.barberAppointment.count({
    where: {
      barbershopId: shop.id,
      clientPhone: phone,
      startAt: { gte: now },
      status: { in: ["PENDING", "CONFIRMED"] },
    },
  });
  if (openForPhone >= BARBER_MAX_OPEN_PER_PHONE) return { ok: false, code: "tooManyOpen" };

  // ── Doble envío (doble clic, reintento del navegador) ────────────────
  const already = await prisma.barberAppointment.findFirst({
    where: {
      barbershopId: shop.id,
      clientPhone: phone,
      startAt,
      status: { in: ["PENDING", "CONFIRMED"] },
    },
    select: { id: true, status: true, barberId: true },
  });
  if (already) {
    const barber = already.barberId
      ? await prisma.barber.findUnique({
          where: { id: already.barberId },
          select: { name: true, nickname: true },
        })
      : null;
    return {
      ok: true,
      duplicate: true,
      reference: shortReference(already.id),
      status: already.status === "CONFIRMED" ? "CONFIRMED" : "PENDING",
      policy: already.status === "CONFIRMED" ? "auto" : "manual",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      barberName: barber ? barber.nickname || barber.name : null,
      services: services.map((s) => ({ name: s.name, price: Number(s.price) })),
      total,
    };
  }

  const policy = await resolveBookingPolicy(shop.id);
  const deposit = await resolveDepositForBooking({
    barbershopId: shop.id, serviceIds, total,
  });

  // ── La transacción: candado + re-verificación + escritura ────────────
  const [lockA, lockB] = advisoryLockKey(`barber:booking:${shop.id}:${dateISO}`);

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Los dos argumentos son enteros calculados aquí mismo (nunca entrada
      // del usuario), así que van como literales: así Postgres resuelve la
      // sobrecarga (int4, int4) sin ambigüedad de tipos de parámetro.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(${Math.trunc(lockA)}, ${Math.trunc(lockB)})`,
      );

      // Se recalcula DENTRO del candado: lo que se pintó en la pantalla no
      // decide nada.
      const free = await getFreeBarbersByTime({
        shop: { id: shop.id, timezone: shop.timezone },
        dateISO,
        durationMin,
        barberId: requestedBarberId,
        now,
        db: tx,
      });
      const candidates = free.get(time) ?? [];
      if (candidates.length === 0) return { taken: true as const };

      // "Cualquiera disponible": se asigna un barbero CONCRETO ya mismo. Si
      // se dejara barberId null, dos reservas "cualquiera" a la misma hora
      // cabrían aunque solo hubiera un barbero libre, y el empalme lo
      // descubriría la barbería el día de la cita.
      const assignedBarberId = requestedBarberId ?? (await pickLeastBusyBarber(
        tx, shop.id, candidates, dateISO, shop.timezone,
      ));

      const client = await tx.barberClient.findUnique({
        where: { barbershopId_phone: { barbershopId: shop.id, phone } },
        select: { id: true, blockedAt: true },
      });
      if (client?.blockedAt) return { blocked: true as const };

      // El nombre que la barbería curó en su ficha NO se pisa con lo que el
      // cliente teclee hoy; el nombre tecleado viaja en la cita.
      const clientId = client
        ? (
            await tx.barberClient.update({
              where: { id: client.id },
              data: { portalEnabled: true },
              select: { id: true },
            })
          ).id
        : (
            await tx.barberClient.create({
              data: { barbershopId: shop.id, name, phone, portalEnabled: true },
              select: { id: true },
            })
          ).id;

      const appointment = await tx.barberAppointment.create({
        data: {
          barbershopId: shop.id,
          clientId,
          clientName: name,
          clientPhone: phone,
          barberId: assignedBarberId,
          startAt,
          endAt,
          status: policy === "auto" ? "CONFIRMED" : "PENDING",
          source: input.source ?? "PUBLIC",
          notes: input.notes,
          ...(deposit ? { depositAmount: deposit.amount, depositStatus: deposit.status } : {}),
          services: {
            create: services.map((s) => ({
              serviceId: s.id,
              priceAtBooking: s.price,
            })),
          },
        },
        select: { id: true, barberId: true },
      });

      const barber = appointment.barberId
        ? await tx.barber.findUnique({
            where: { id: appointment.barberId },
            select: { name: true, nickname: true },
          })
        : null;

      return {
        taken: false as const,
        id: appointment.id,
        barberName: barber ? barber.nickname || barber.name : null,
      };
    },
    // El candado hace ESPERAR a la segunda reserva del mismo día; con el
    // timeout por defecto (5 s) una cola normal de sábado podría abortar
    // transacciones sanas. maxWait cubre la espera por el candado; timeout,
    // el trabajo de dentro (que son milisegundos).
    { maxWait: 10_000, timeout: 15_000 });

    if ("blocked" in created) return { ok: false, code: "clientBlocked" };
    if (created.taken) return { ok: false, code: "slotTaken" };

    if (!input.skipNotify) {
      await notifyBookingCreated({ barbershopId: shop.id, appointmentId: created.id, policy });
    }

    return {
      ok: true,
      duplicate: false,
      reference: shortReference(created.id),
      status: policy === "auto" ? "CONFIRMED" : "PENDING",
      policy,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      barberName: created.barberName,
      services: services.map((s) => ({ name: s.name, price: Number(s.price) })),
      total,
    };
  } catch (err) {
    // LA ÚLTIMA PALABRA sobre dobles reservas la tiene Postgres: la
    // constraint EXCLUDE barber_appt_no_overlap (de T1, sql/barber_agenda.sql)
    // rechaza el INSERT que se solape con otra cita del mismo barbero. El
    // candado + la re-verificación de arriba están para dar un mensaje
    // amable; esto es la red por debajo, y también cubre el caso de que el
    // .sql todavía no esté aplicado al revés: si lo está, ni un empalme pasa.
    if (isBarberOverlapError(err)) return { ok: false, code: "slotTaken" };
    // Carrera en el alta del cliente (dos reservas simultáneas del MISMO
    // teléfono): el índice único (barbershopId, phone) hace su trabajo y
    // aquí se traduce a "intenta otra vez" en vez de un 500 crudo.
    if ((err as { code?: string })?.code === "P2002") {
      return { ok: false, code: "slotTaken" };
    }
    throw err;
  }
}


/**
 * De los barberos libres a esa hora, el que MENOS citas tiene ese día — así
 * "cualquiera disponible" reparte el trabajo en vez de saturar al primero de
 * la lista. Empate: gana el orden que la barbería definió (sortOrder).
 */
async function pickLeastBusyBarber(
  db: Db,
  barbershopId: string,
  candidates: string[],
  dateISO: string,
  timezone: string,
): Promise<string> {
  if (candidates.length === 1) return candidates[0];
  const dayStart = barberTzLocalToUtc(dateISO, 0, 0, timezone);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const counts = await db.barberAppointment.groupBy({
    by: ["barberId"],
    where: {
      barbershopId,
      barberId: { in: candidates },
      startAt: { gte: dayStart, lt: dayEnd },
      status: { in: [...BARBER_BUSY_STATUSES] },
    },
    _count: { _all: true },
  });
  const load = new Map<string, number>();
  for (const row of counts) if (row.barberId) load.set(row.barberId, row._count._all);
  // `candidates` ya viene en el orden sortOrder → name de getFreeBarbersByTime.
  return pickLeastBusy(candidates, load) ?? candidates[0];
}

// ── Bandeja de solicitudes (lado panel) ─────────────────────────────────

/**
 * Una solicitud de reserva TAL COMO la ve el panel. Ojo: esto es la vista
 * INTERNA (teléfono y notas incluidos) — no confundir con lo que sale a las
 * superficies públicas.
 */
export interface BarberBookingRequestDTO {
  id: string;
  barbershopId: string;
  /** Sede: solo importa en cadenas multisucursal. */
  branchLabel: string;
  clientName: string;
  clientPhone: string;
  /** Visitas previas del cliente: distingue al de siempre del que estrena. */
  clientVisits: number;
  barberId: string | null;
  barberName: string | null;
  startAt: string;
  endAt: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "NO_SHOW" | "IN_PROGRESS" | "DONE";
  createdAt: string;
  services: { name: string; price: number }[];
  total: number;
  notes: string | null;
  /** El horario pedido ya pasó y nadie la atendió. */
  isPast: boolean;
}

/**
 * Las solicitudes de las sedes que el usuario puede ver.
 *
 * `barbershopIds` sale SIEMPRE de getAccessibleBranchIds(ctx) — jamás del
 * request. Una lista vacía devuelve vacío en vez de "todas": en Prisma un
 * filtro que se evapora es una fuga entre inquilinos.
 */
export async function listBookingRequests(args: {
  barbershopIds: string[];
  scope: "pendientes" | "resueltas";
  limit?: number;
  now?: Date;
}): Promise<BarberBookingRequestDTO[]> {
  const { barbershopIds, scope } = args;
  if (barbershopIds.length === 0) return [];
  const now = args.now ?? new Date();
  const limit = Math.min(200, Math.max(1, args.limit ?? 100));

  const rows = await prisma.barberAppointment.findMany({
    where: {
      barbershopId: { in: barbershopIds },
      source: "PUBLIC",
      ...(scope === "pendientes"
        ? { status: "PENDING" }
        : { status: { not: "PENDING" } }),
    },
    select: {
      id: true, barbershopId: true, clientName: true, clientPhone: true,
      barberId: true, startAt: true, endAt: true, status: true,
      createdAt: true, notes: true,
      barbershop: { select: { name: true, branchName: true } },
      barber: { select: { name: true, nickname: true } },
      client: { select: { totalVisits: true } },
      services: { select: { priceAtBooking: true, service: { select: { name: true } } } },
    },
    orderBy: scope === "pendientes" ? { startAt: "asc" } : { createdAt: "desc" },
    take: limit,
  });

  return rows.map((r) => {
    const services = r.services.map((s) => ({
      name: s.service.name,
      price: Number(s.priceAtBooking),
    }));
    return {
      id: r.id,
      barbershopId: r.barbershopId,
      branchLabel: r.barbershop.branchName || r.barbershop.name,
      clientName: r.clientName ?? "Sin nombre",
      clientPhone: r.clientPhone ?? "",
      clientVisits: r.client?.totalVisits ?? 0,
      barberId: r.barberId,
      barberName: r.barber ? r.barber.nickname || r.barber.name : null,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      services,
      total: services.reduce((acc, s) => acc + s.price, 0),
      notes: r.notes,
      isPast: r.startAt.getTime() < now.getTime(),
    };
  });
}

export interface RequestActionOk {
  ok: true;
  status: "CONFIRMED" | "CANCELLED";
}
export interface RequestActionErr {
  ok: false;
  code: "notFound" | "badStatus";
}
export type RequestActionResult = RequestActionOk | RequestActionErr;

/** Guarda de tipo (ver isBookingGateOk). */
export function isRequestActionError(r: RequestActionResult): r is RequestActionErr {
  return r.ok === false;
}

/**
 * Acepta o rechaza una solicitud.
 *
 * Aceptar NO vuelve a comprobar el hueco a propósito: la cita ya existe
 * desde que el cliente reservó, o sea que el horario YA estaba apartado.
 * Aquí solo cambia de estado (PENDING → CONFIRMED / CANCELLED), y la
 * transición se valida contra la máquina de estados del vertical, no a mano.
 *
 * La pertenencia va dentro del where (id + sedes accesibles): una solicitud
 * de otra cadena simplemente no existe para este usuario.
 */
export async function resolveBookingRequest(args: {
  barbershopIds: string[];
  appointmentId: string;
  action: "aceptar" | "rechazar";
}): Promise<RequestActionResult> {
  const { barbershopIds, appointmentId, action } = args;
  if (barbershopIds.length === 0) return { ok: false, code: "notFound" };

  const target = action === "aceptar" ? "CONFIRMED" : "CANCELLED";

  const current = await prisma.barberAppointment.findFirst({
    where: { id: appointmentId, barbershopId: { in: barbershopIds }, source: "PUBLIC" },
    select: { id: true, status: true },
  });
  if (!current) return { ok: false, code: "notFound" };
  if (!canTransition(current.status, target)) return { ok: false, code: "badStatus" };

  const res = await prisma.barberAppointment.updateMany({
    where: {
      id: appointmentId,
      barbershopId: { in: barbershopIds },
      source: "PUBLIC",
      status: "PENDING",
    },
    data: { status: target },
  });
  if (res.count === 0) return { ok: false, code: "badStatus" };
  return { ok: true, status: target };
}

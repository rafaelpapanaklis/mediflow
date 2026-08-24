import "server-only";
import { prisma } from "@/lib/prisma";
import type { BarberAppointmentStatus } from "@/lib/barber/types";
import type { BarberContext } from "@/lib/barber-auth";
import {
  BARBER_CLIENTS_CONFIG_DEFAULTS,
  LOYALTY_HISTORY_MAX,
  LOYALTY_LEDGER_KEY,
  findBarberClient,
  getBarberClientsConfig,
  listBarberClientPhotos,
  readBlockInfo,
  readClientPreferences,
  readLoyaltyLedger,
  tallyVisitsForClient,
  toBarberClientDTO,
  withReservedPreference,
  type BarberClientPreferences,
  type BarberClientRow,
  type BarberClientsConfig,
  type BarberVisitPhotoView,
  type ClientBlockInfo,
} from "@/lib/barber/clients";
import type { BarberClientDTO } from "@/lib/barber/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — tarjeta de lealtad e historial de cortes.
 *
 * ── POR QUÉ EL CONTADOR ES DERIVADO Y NO "UN +1" ────────────────────
 * `barber_clients.loyaltyCount` existe como columna, pero aquí NO se trata
 * como un acumulador que alguien incrementa. Se RECALCULA desde la fuente
 * de verdad cada vez que se abre la ficha o se cierra una visita:
 *
 *     visitas   = citas DONE del cliente
 *               + ventas de servicio sin cita (walk-in de mostrador)
 *     contador  = visitas − visitas ya canjeadas
 *
 * Tres cosas salen gratis con este diseño:
 *   1. NO SE PUEDE MANIPULAR DESDE EL CLIENTE. No existe un endpoint que
 *      reciba un número: el navegador no tiene forma de sumar sellos.
 *   2. ES IDEMPOTENTE. Cerrar dos veces la misma visita no suma dos sellos,
 *      porque no se suma nada: se cuenta. Un reintento de red es inocuo.
 *   3. SE AUTO-REPARA. Si la ola de agenda (T1) olvida llamar al gancho, el
 *      número se corrige solo la próxima vez que el barbero abre la ficha.
 *
 * La columna se conserva actualizada porque la LISTA la lee directo (25
 * fichas × 4 queries de recuento sería absurdo). O sea: la columna es una
 * caché, y esta capa es quien la refresca.
 *
 * ── GANCHO PARA LAS OTRAS OLAS ──────────────────────────────────────
 *   T1 (agenda) al pasar una cita a DONE, y T3 (caja) al cerrar un ticket:
 *
 *     import { registerBarberVisit } from "@/lib/barber/loyalty";
 *     await registerBarberVisit(ctx, { clientId, appointmentId });
 *
 *   T1 al ABRIR una cita, para el aviso de "corte gratis disponible":
 *
 *     import { getBarberLoyaltyForAppointment } from "@/lib/barber/loyalty";
 *     const loyalty = await getBarberLoyaltyForAppointment(ctx, appointmentId);
 *     // loyalty.rewardAvailable → pinta <BarberLoyaltyBadge state={loyalty} />
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface BarberLoyaltyState {
  enabled: boolean;
  /** Sellos vivos (visitas menos las ya canjeadas). */
  count: number;
  /** Cada cuántos sellos se gana el premio (config de la barbería). */
  threshold: number;
  /** Etiqueta del premio ("Corte gratis" por defecto). */
  reward: string;
  /** Ya juntó los sellos: la ficha y la agenda lo tienen que gritar. */
  rewardAvailable: boolean;
  /** Sellos pintados en la tarjeta (0..threshold). */
  progress: number;
  /** Cuántos le faltan. 0 si ya lo tiene. */
  remaining: number;
  /** Visitas totales contadas desde la fuente de verdad. */
  totalVisits: number;
  lastVisitAt: string | null;
  /** Cuántos premios ha canjeado en total. */
  redemptions: number;
  lastRedeemedAt: string | null;
}

/** Estado "apagado", para cuando la barbería no usa lealtad o no hay ficha. */
export function emptyLoyaltyState(config?: Partial<BarberClientsConfig>): BarberLoyaltyState {
  const threshold = config?.loyaltyThreshold ?? BARBER_CLIENTS_CONFIG_DEFAULTS.loyaltyThreshold;
  return {
    enabled: config?.loyaltyEnabled ?? false,
    count: 0,
    threshold,
    reward: config?.loyaltyReward ?? BARBER_CLIENTS_CONFIG_DEFAULTS.loyaltyReward,
    rewardAvailable: false,
    progress: 0,
    remaining: threshold,
    totalVisits: 0,
    lastVisitAt: null,
    redemptions: 0,
    lastRedeemedAt: null,
  };
}

/** Cálculo PURO del estado a partir de números ya resueltos en el servidor. */
export function buildLoyaltyState(args: {
  config: BarberClientsConfig;
  visits: number;
  redeemedVisits: number;
  lastVisitAt: Date | null;
  redemptions: number;
  lastRedeemedAt: string | null;
}): BarberLoyaltyState {
  const threshold = Math.max(1, args.config.loyaltyThreshold);
  const count = Math.max(0, args.visits - args.redeemedVisits);
  const rewardAvailable = args.config.loyaltyEnabled && count >= threshold;
  return {
    enabled: args.config.loyaltyEnabled,
    count,
    threshold,
    reward: args.config.loyaltyReward,
    rewardAvailable,
    progress: Math.min(count, threshold),
    remaining: Math.max(0, threshold - count),
    totalVisits: args.visits,
    lastVisitAt: args.lastVisitAt ? args.lastVisitAt.toISOString() : null,
    redemptions: args.redemptions,
    lastRedeemedAt: args.lastRedeemedAt,
  };
}

// ── La fuente de verdad de "una visita" ────────────────────────────────
// El recuento vive en clients.ts (tallyVisitsForClients) para que la LISTA
// pueda usarlo sin arrastrar este módulo, y para que "qué cuenta como
// visita" tenga UNA sola definición en todo el vertical.

export interface LoyaltySyncResult {
  client: BarberClientRow;
  state: BarberLoyaltyState;
  config: BarberClientsConfig;
}

/**
 * Recalcula contador, visitas totales y última visita, y refresca la caché
 * (las columnas) SOLO si cambiaron. Es la única función que escribe
 * loyaltyCount / totalVisits / lastVisitAt.
 */
export async function syncBarberClientLoyalty(
  ctx: BarberContext,
  clientId: string,
  preloaded?: { config?: BarberClientsConfig },
): Promise<LoyaltySyncResult | null> {
  // La fila se lee SIEMPRE con findBarberClient (que filtra por la barbería
  // de la sesión). No se acepta una fila ya cargada por el caller: era la
  // única rendija por la que podía colarse un cliente de otra barbería.
  const client = await findBarberClient(ctx, clientId);
  if (!client) return null;

  const config = preloaded?.config ?? (await getBarberClientsConfig(ctx));
  const ledger = readLoyaltyLedger(client.preferences);
  const tally = await tallyVisitsForClient(ctx.barbershopId, client.id);

  const count = Math.max(0, tally.visits - ledger.redeemedVisits);
  const lastMs = (d: Date | null) => (d ? d.getTime() : null);

  let row = client;
  if (
    client.loyaltyCount !== count ||
    client.totalVisits !== tally.visits ||
    lastMs(client.lastVisitAt) !== lastMs(tally.lastVisitAt)
  ) {
    row = await prisma.barberClient.update({
      where: { id: client.id, barbershopId: ctx.barbershopId },
      data: {
        loyaltyCount: count,
        totalVisits: tally.visits,
        lastVisitAt: tally.lastVisitAt,
      },
      select: CLIENT_SYNC_SELECT,
    });
  }

  const state = buildLoyaltyState({
    config,
    visits: tally.visits,
    redeemedVisits: ledger.redeemedVisits,
    lastVisitAt: tally.lastVisitAt,
    redemptions: ledger.redemptions.length,
    lastRedeemedAt: ledger.redemptions[0]?.at ?? null,
  });

  return { client: row, state, config };
}

// Mismo shape que CLIENT_SELECT de clients.ts; se repite aquí porque el
// update tiene que devolver EXACTAMENTE BarberClientRow.
const CLIENT_SYNC_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  birthday: true,
  notes: true,
  preferences: true,
  photoUrl: true,
  loyaltyCount: true,
  totalVisits: true,
  lastVisitAt: true,
  blockedAt: true,
  portalEnabled: true,
  lastPortalLoginAt: true,
  createdAt: true,
} as const;

/**
 * GANCHO para T1 (agenda) y T3 (caja): "esta visita ya se cerró".
 *
 * No suma nada — vuelve a contar. Por eso da igual llamarlo dos veces, o no
 * llamarlo (la ficha se auto-repara). `appointmentId` es opcional y hoy solo
 * sirve para validar que la cita es de este cliente antes de recontar.
 */
export async function registerBarberVisit(
  ctx: BarberContext,
  args: { clientId: string; appointmentId?: string | null },
): Promise<BarberLoyaltyState | null> {
  if (args.appointmentId) {
    const appt = await prisma.barberAppointment.findFirst({
      where: {
        id: args.appointmentId,
        barbershopId: ctx.barbershopId,
        clientId: args.clientId,
      },
      select: { id: true },
    });
    if (!appt) return null;
  }
  const result = await syncBarberClientLoyalty(ctx, args.clientId);
  return result ? result.state : null;
}

/** Estado de lealtad del cliente de una cita (para el aviso en la agenda). */
export async function getBarberLoyaltyForAppointment(
  ctx: BarberContext,
  appointmentId: string,
): Promise<BarberLoyaltyState | null> {
  const appt = await prisma.barberAppointment.findFirst({
    where: { id: appointmentId, barbershopId: ctx.barbershopId },
    select: { clientId: true },
  });
  if (!appt?.clientId) return null;
  const result = await syncBarberClientLoyalty(ctx, appt.clientId);
  return result ? result.state : null;
}

// ── Canje ──────────────────────────────────────────────────────────────

/** Plano, no unión discriminada: ver la nota de UpsertClientResult. */
export interface RedeemResult {
  ok: boolean;
  state?: BarberLoyaltyState;
  error?: string;
}

/**
 * Canjea el premio: descuenta `threshold` sellos y lo anota en la bitácora
 * (que vive en la llave reservada __loyalty de `preferences`, imposible de
 * escribir desde el navegador). El canje queda VISIBLE en el historial.
 *
 * No resetea a 0 a lo bruto: RESTA el umbral. En el caso normal es lo mismo
 * (se canjea justo al llegar al número), pero si el cliente alcanzó 12 con
 * un umbral de 10, los 2 sellos de más son suyos y no se los quita nadie.
 *
 * La carrera de dos canjes simultáneos la corta el propio UPDATE: la
 * condición `loyaltyCount >= threshold` viaja en el WHERE, así que el
 * segundo afecta 0 filas y devuelve el error.
 */
export async function redeemBarberLoyalty(
  ctx: BarberContext,
  args: { clientId: string; appointmentId?: string | null; note?: unknown },
): Promise<RedeemResult> {
  const synced = await syncBarberClientLoyalty(ctx, args.clientId);
  if (!synced) return { ok: false, error: "Ese cliente no es de esta barbería." };

  const { client, config, state } = synced;
  if (!config.loyaltyEnabled) {
    return { ok: false, error: "La tarjeta de lealtad está apagada en esta barbería." };
  }
  if (!state.rewardAvailable) {
    return {
      ok: false,
      error: `Todavía le faltan ${state.remaining} para el ${config.loyaltyReward.toLowerCase()}.`,
    };
  }

  let appointmentId: string | null = null;
  if (args.appointmentId) {
    const appt = await prisma.barberAppointment.findFirst({
      where: {
        id: args.appointmentId,
        barbershopId: ctx.barbershopId,
        clientId: args.clientId,
      },
      select: { id: true },
    });
    appointmentId = appt?.id ?? null;
  }

  const ledger = readLoyaltyLedger(client.preferences);
  const entry = {
    at: new Date().toISOString(),
    byUserId: ctx.barberUserId,
    threshold: config.loyaltyThreshold,
    reward: config.loyaltyReward,
    appointmentId,
    note: typeof args.note === "string" && args.note.trim()
      ? args.note.trim().slice(0, 200)
      : null,
  };
  const nextLedger = {
    redeemedVisits: ledger.redeemedVisits + config.loyaltyThreshold,
    redemptions: [entry, ...ledger.redemptions].slice(0, LOYALTY_HISTORY_MAX),
  };

  const written = await prisma.barberClient.updateMany({
    where: {
      id: client.id,
      barbershopId: ctx.barbershopId,
      loyaltyCount: { gte: config.loyaltyThreshold },
    },
    data: {
      loyaltyCount: { decrement: config.loyaltyThreshold },
      preferences: withReservedPreference(client.preferences, LOYALTY_LEDGER_KEY, nextLedger),
    },
  });

  if (written.count === 0) {
    return { ok: false, error: "Ese premio ya se canjeó. Vuelve a abrir la ficha." };
  }

  const after = await syncBarberClientLoyalty(ctx, args.clientId);
  return { ok: true, state: after ? after.state : state };
}

// ── Historial de cortes (el corazón del módulo) ────────────────────────

export type BarberVisitEntryKind = "appointment" | "sale" | "redemption";

export interface BarberVisitEntry {
  id: string;
  kind: BarberVisitEntryKind;
  /** ISO. Cita → startAt; venta → createdAt; canje → fecha del canje. */
  at: string;
  status: BarberAppointmentStatus | null;
  barberId: string | null;
  barberName: string | null;
  services: string[];
  /** Total cobrado. null = todavía no hay ticket para esa visita. */
  amount: number | null;
  /** true = el importe viene del precio congelado al reservar, no de un cobro. */
  amountIsEstimate: boolean;
  notes: string | null;
  photos: BarberVisitPhotoView[];
  /** Solo en kind = "redemption". */
  reward: string | null;
}

export interface BarberVisitHistory {
  entries: BarberVisitEntry[];
  /** Fotos que no cuelgan de ninguna visita (subidas sueltas a la ficha). */
  loosePhotos: BarberVisitPhotoView[];
  /** La última foto del cliente, sea de donde sea. Siempre visible en la ficha. */
  latestPhoto: BarberVisitPhotoView | null;
}

const HISTORY_MAX_ENTRIES = 60;

/**
 * Timeline del "así me lo hiciste la vez pasada": citas (incluidas las que
 * NO llegó — eso es justo lo que se mira antes de bloquear a alguien),
 * ventas de mostrador sin cita, y canjes de premio, todo en una sola línea
 * de tiempo, con sus fotos colgadas de cada visita.
 */
export async function getBarberVisitHistory(
  ctx: BarberContext,
  clientId: string,
): Promise<BarberVisitHistory> {
  const barbershopId = ctx.barbershopId;

  const [appointments, sales, photos, client] = await Promise.all([
    prisma.barberAppointment.findMany({
      where: { barbershopId, clientId },
      orderBy: { startAt: "desc" },
      take: HISTORY_MAX_ENTRIES,
      select: {
        id: true,
        startAt: true,
        status: true,
        notes: true,
        barber: { select: { id: true, name: true, nickname: true } },
        services: { select: { id: true, priceAtBooking: true, service: { select: { name: true } } } },
        sales: { select: { total: true, tip: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.barberSale.findMany({
      where: { barbershopId, clientId, appointmentId: null },
      orderBy: { createdAt: "desc" },
      take: HISTORY_MAX_ENTRIES,
      select: {
        id: true,
        createdAt: true,
        total: true,
        notes: true,
        barber: { select: { id: true, name: true, nickname: true } },
        items: { select: { description: true, serviceId: true } },
      },
    }),
    listBarberClientPhotos(ctx, clientId, { take: 120 }),
    findBarberClient(ctx, clientId),
  ]);

  const byAppointment = new Map<string, BarberVisitPhotoView[]>();
  const loosePhotos: BarberVisitPhotoView[] = [];
  for (const photo of photos) {
    if (!photo.appointmentId) {
      loosePhotos.push(photo);
      continue;
    }
    const list = byAppointment.get(photo.appointmentId);
    if (list) list.push(photo);
    else byAppointment.set(photo.appointmentId, [photo]);
  }

  const entries: BarberVisitEntry[] = [];

  for (const appt of appointments) {
    const sale = appt.sales[0];
    const booked = appt.services.reduce((sum, s) => sum + Number(s.priceAtBooking), 0);
    entries.push({
      id: appt.id,
      kind: "appointment",
      at: appt.startAt.toISOString(),
      status: appt.status,
      barberId: appt.barber?.id ?? null,
      barberName: appt.barber ? appt.barber.nickname || appt.barber.name : null,
      services: appt.services.map((s) => s.service?.name ?? "Servicio"),
      amount: sale ? Number(sale.total) : appt.services.length ? booked : null,
      amountIsEstimate: !sale,
      notes: appt.notes,
      photos: byAppointment.get(appt.id) ?? [],
      reward: null,
    });
  }

  for (const sale of sales) {
    const serviceLines = sale.items.filter((i) => i.serviceId);
    entries.push({
      id: sale.id,
      kind: "sale",
      at: sale.createdAt.toISOString(),
      status: null,
      barberId: sale.barber?.id ?? null,
      barberName: sale.barber ? sale.barber.nickname || sale.barber.name : null,
      services: (serviceLines.length ? serviceLines : sale.items).map((i) => i.description),
      amount: Number(sale.total),
      amountIsEstimate: false,
      notes: sale.notes,
      photos: [],
      reward: null,
    });
  }

  const ledger = readLoyaltyLedger(client?.preferences);
  ledger.redemptions.forEach((r, i) => {
    entries.push({
      id: `redemption-${i}-${r.at}`,
      kind: "redemption",
      at: r.at,
      status: null,
      barberId: null,
      barberName: null,
      services: [],
      amount: null,
      amountIsEstimate: false,
      notes: r.note,
      photos: [],
      reward: r.reward || BARBER_CLIENTS_CONFIG_DEFAULTS.loyaltyReward,
    });
  });

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    entries: entries.slice(0, HISTORY_MAX_ENTRIES),
    loosePhotos,
    latestPhoto: photos[0] ?? null,
  };
}

// ── La ficha completa (lo que pinta /barber/clientes/[id]) ─────────────

export interface BarberClientMembershipBadge {
  name: string;
  endAt: string;
  cutsUsed: number;
  includedCuts: number | null;
}

export interface BarberClientDetail {
  client: BarberClientDTO;
  preferences: BarberClientPreferences;
  /** Motivo y fecha del bloqueo (null si no está bloqueado). */
  block: ClientBlockInfo | null;
  loyalty: BarberLoyaltyState;
  history: BarberVisitHistory;
  membership: BarberClientMembershipBadge | null;
  config: BarberClientsConfig;
  /** Barberos activos, para elegir "su barbero" en las preferencias. */
  barbers: Array<{ id: string; name: string }>;
}

/**
 * Todo lo que la ficha necesita, en un solo viaje. Empieza por SINCRONIZAR
 * la lealtad: abrir la ficha es el momento en que el número se corrige solo
 * si alguna ola no llamó al gancho.
 */
export async function getBarberClientDetail(
  ctx: BarberContext,
  clientId: string,
): Promise<BarberClientDetail | null> {
  const synced = await syncBarberClientLoyalty(ctx, clientId);
  if (!synced) return null;

  const { client, state, config } = synced;
  const [history, membership, barbers] = await Promise.all([
    getBarberVisitHistory(ctx, clientId),
    prisma.barberClientMembership.findFirst({
      where: {
        barbershopId: ctx.barbershopId,
        clientId,
        status: "ACTIVE",
        endAt: { gt: new Date() },
      },
      orderBy: { endAt: "desc" },
      select: {
        endAt: true,
        cutsUsed: true,
        membership: { select: { name: true, includedCuts: true } },
      },
    }),
    prisma.barber.findMany({
      where: { barbershopId: ctx.barbershopId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, nickname: true },
    }),
  ]);

  return {
    client: toBarberClientDTO(client),
    preferences: readClientPreferences(client.preferences),
    block: readBlockInfo(client.preferences),
    loyalty: state,
    history,
    membership: membership
      ? {
          name: membership.membership?.name ?? "Membresía",
          endAt: membership.endAt.toISOString(),
          cutsUsed: membership.cutsUsed,
          includedCuts: membership.membership?.includedCuts ?? null,
        }
      : null,
    config,
    barbers: barbers.map((b) => ({ id: b.id, name: b.nickname || b.name })),
  };
}

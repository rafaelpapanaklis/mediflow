import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { getRealtyPlan } from "@/lib/realty/plans";
import { isRealtySubscriptionActive, realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { scheduleVisitFromLead } from "@/lib/realty/leads";
import { getRealtyWaQuota } from "@/lib/realty/whatsapp";
import {
  REALTY_WA_WINDOW_MS,
  formatRealtyWaPrice,
  isRealtyWaSendErr,
  realtyWaWindowOpen,
} from "@/lib/realty/whatsapp-core";
import {
  MICROS_PER_MXN,
  REALTY_BOT_USD_MXN_FALLBACK,
  realtyBotAnswersNow,
  realtyBotAsksForHuman,
  realtyBotCanSpend,
  realtyBotTurnCostMicros,
  type RealtyBotSettings,
  type RealtyBotSkipReason,
} from "@/lib/realty/bot/core";
import {
  addRealtyBotSpend,
  countRealtyBotRepliesToday,
  getRealtyBotSettings,
  growthDayInTz,
  growthTzParts,
  isRealtyBotThreadPaused,
  isRealtyOptedOut,
  logRealtyBotTurn,
  pauseRealtyBotThread,
  readRealtyBotSpendMicros,
  realtyGrowthStorageReady,
} from "@/lib/realty/bot/growth-db";
import { REALTY_BOT_FEATURE } from "@/lib/realty/bot/gate";

export * from "@/lib/realty/bot/core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — EL BOT QUE CALIFICA Y AGENDA POR WHATSAPP.

   En bienes raíces gana quien contesta primero. El prospecto que escribe a
   las 11 de la noche desde un portal recibe respuesta de cuatro
   inmobiliarias; se queda con la que le contestó en segundos. Esto es lo
   que convierte ese mensaje en una visita agendada.

   ── DÓNDE SE ENGANCHA ────────────────────────────────────────────────
   🔴 ESTA TERMINAL NO TOCA EL TRANSPORTE. `src/lib/realty/whatsapp.ts`,
   `src/lib/whatsapp.ts` y el webhook compartido quedaron INTACTOS.

   El bot NO manda: DECIDE. `runRealtyBotTurn` devuelve el texto y quien
   llama lo manda con `sendRealtyWhatsApp` — que es el único camino a Meta y
   el que cobra el cupo, resuelve la ventana de 24 h y registra en el hilo.
   Así el bot no puede romper el envío ni saltarse un cupo.

   Hoy lo llama el BARRIDO (`sweepRealtyBot`, aquí abajo → la ruta
   /api/realty/bot/sweep). El día que el dueño de whatsapp.ts quiera
   respuesta instantánea, la línea que falta dentro de
   `ingestRealtyInbound`, justo donde hoy `applyRealtyReply` se rinde con
   `reply === "unclear"`, es UNA:

       await runRealtyBotAndReply({ accountId, phone, text });

   (exportada abajo; hace el turno y manda con sendRealtyWhatsApp). Es el
   mismo reparto que barber: `applyReminderReply` primero, el bot ÚLTIMO.

   ── 🔴 LA REGLA QUE NO SE NEGOCIA ────────────────────────────────────
   EL BOT NUNCA INVENTA UN INMUEBLE, NI UN PRECIO, NI UNA DIRECCIÓN.

   Todo lo que dice sale de la cartera real por herramienta. Y la dirección
   EXACTA no sale nunca si el propietario marcó `showExactAddress: false`:
   esa casilla es la privacidad que pidió el dueño de la casa, no un
   adorno. El bot da colonia y ciudad, y la dirección la da el asesor
   cuando confirma la visita.

   ── EL DINERO ────────────────────────────────────────────────────────
   · El bot contesta DENTRO de la ventana de 24 h (el prospecto acaba de
     escribir): texto libre, categoría servicio. Nunca manda una plantilla
     de marketing.
   · Cupo de mensajes del plan: si se acabó, el bot calla y el panel lo dice.
   · Tope de gasto de IA POR CUENTA Y POR DÍA. Un prospecto insistente no
     puede disparar la cuenta. Al llegar al tope el bot no se apaga: pasa la
     conversación a una persona y lo dice.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Parámetros del turno ──────────────────────────────────────────── */

/**
 * Presupuesto de TODO el turno. Está calibrado para que, el día que se
 * enganche al webhook, quepa dentro de lo que Meta espera antes de
 * reintentar la entrega.
 */
const TURN_BUDGET_MS = 13_000;
/** Cada llamada al modelo, acotada aparte. */
const AI_CALL_TIMEOUT_MS = 9_000;
/** Cuántas veces puede el modelo pedir herramientas antes de contestar. */
const MAX_TOOL_ROUNDS = 4;
/** Turnos previos del hilo que viajan como contexto. */
const MAX_HISTORY = 12;
const MAX_OUTPUT_TOKENS = 700;
/** Un WhatsApp largo no lo lee nadie. */
const MAX_REPLY_CHARS = 900;
/** Cuántos inmuebles como máximo devuelve una búsqueda. */
const MAX_RESULTS = 5;
/** Hasta cuántos días adelante puede agendar el bot. */
const MAX_DAYS_AHEAD = 30;
/** Ventana de cortesía entre dos visitas al MISMO inmueble. */
const VISIT_GAP_MIN = 60;

/**
 * Modelo. Mismo criterio que el bot de barber y que el del dental para
 * exactamente este trabajo (conversación corta, alto volumen): se sostiene
 * el estándar del repo y se cambia por env sin redeploy.
 *
 * 🔴 La tarifa del modelo que se ponga aquí DEBE existir en
 * REALTY_BOT_MODEL_PRICES (core.ts) o el tope de gasto lo cobrará con la
 * tarifa más cara de la tabla — a propósito: frenar de más antes que gastar
 * de más.
 */
const DEFAULT_AI_MODEL = "claude-sonnet-4-6";

function aiModel(): string {
  return (process.env.REALTY_BOT_AI_MODEL || "").trim() || DEFAULT_AI_MODEL;
}

/** Llave propia del vertical, con caída a la del dental (igual que Stripe). */
function aiApiKey(): string {
  return (process.env.REALTY_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
}

function usdMxn(): number {
  const raw = Number(process.env.REALTY_BOT_USD_MXN);
  return Number.isFinite(raw) && raw > 0 ? raw : REALTY_BOT_USD_MXN_FALLBACK;
}

/* ── Contrato del turno ────────────────────────────────────────────── */

export interface RealtyBotTurnInput {
  accountId: string;
  phone: string;
  text: string;
  now?: Date;
}

export interface RealtyBotEffects {
  handoff: boolean;
  handoffReason: string | null;
  /** Id de la visita que agendó el bot, si agendó. */
  visitId: string | null;
  /** Lo que dedujo del prospecto y guardó en el lead. */
  qualified: Record<string, unknown> | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}

export interface RealtyBotTurnResult {
  /** Lo que hay que mandarle al prospecto. null = el bot no contesta. */
  reply: string | null;
  /** Por qué no contestó (o qué pasó), para el panel. */
  skipped: RealtyBotSkipReason | null;
  effects: RealtyBotEffects;
}

function emptyEffects(): RealtyBotEffects {
  return {
    handoff: false,
    handoffReason: null,
    visitId: null,
    qualified: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0,
  };
}

function noReply(reason: RealtyBotSkipReason): RealtyBotTurnResult {
  return { reply: null, skipped: reason, effects: emptyEffects() };
}

/* ── Contexto que el bot necesita ──────────────────────────────────── */

interface BotAccount {
  id: string;
  name: string;
  mode: string;
  timezone: string;
  slug: string;
  isActive: boolean;
  plan: string;
  subscriptionStatus: string;
  phone: string | null;
  city: string | null;
  state: string | null;
}

interface TurnCtx {
  account: BotAccount;
  settings: RealtyBotSettings;
  threadId: string | null;
  contactId: string | null;
  contactName: string | null;
  leadId: string | null;
  /** Usuario de la cuenta a cuyo nombre actúa el bot al escribir en el CRM. */
  actingUserId: string | null;
  actingRole: string;
  actingOverride: string[];
  phone: string;
  now: Date;
  effects: RealtyBotEffects;
}

async function loadAccount(accountId: string): Promise<BotAccount | null> {
  const row = await prisma.realtyAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      mode: true,
      timezone: true,
      slug: true,
      isActive: true,
      plan: true,
      subscriptionStatus: true,
      phone: true,
      city: true,
      state: true,
    },
  });
  return row as BotAccount | null;
}

/* ═══════════════════════════════════════════════════════════════════════
   HERRAMIENTAS
   Todo lo que el bot puede decir sale de aquí. Ninguna inventa nada:
   consultan la cartera y la agenda reales de ESA cuenta.
   ═══════════════════════════════════════════════════════════════════════ */

function propertyPublicLink(ctx: TurnCtx, p: { publicUrlSlug: string | null; id: string; isPublished: boolean }): string | null {
  if (!p.isPublished) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/i/${ctx.account.slug}/${p.publicUrlSlug || p.id}`;
}

/** Zona pública del inmueble. NUNCA la calle si el dueño no lo autorizó. */
function publicZone(p: {
  colonia: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  showExactAddress: boolean;
}): string {
  const parts = [p.colonia, p.city, p.state].filter(Boolean);
  const zona = parts.join(", ");
  if (p.showExactAddress && p.address) return `${p.address}${zona ? ` (${zona})` : ""}`;
  return zona || "sin zona capturada";
}

async function toolBuscarInmuebles(
  ctx: TurnCtx,
  args: Record<string, unknown>,
): Promise<unknown> {
  const operacion = typeof args.operacion === "string" ? args.operacion.toUpperCase() : null;
  const tipo = typeof args.tipo === "string" ? args.tipo.toUpperCase() : null;
  const zona = typeof args.zona === "string" ? args.zona.trim() : "";
  const presupuestoMax = Number(args.presupuestoMax);
  const recamaras = Number(args.recamaras);

  const rows = await prisma.realtyProperty.findMany({
    where: {
      accountId: ctx.account.id,
      status: "DISPONIBLE",
      ...(operacion === "VENTA" || operacion === "RENTA"
        ? { operation: { in: [operacion as "VENTA" | "RENTA", "AMBAS"] } }
        : {}),
      ...(tipo ? { kind: tipo as never } : {}),
      ...(zona
        ? {
            OR: [
              { colonia: { contains: zona, mode: "insensitive" } },
              { city: { contains: zona, mode: "insensitive" } },
              { state: { contains: zona, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(Number.isFinite(recamaras) && recamaras > 0 ? { bedrooms: { gte: recamaras } } : {}),
    },
    select: {
      id: true,
      title: true,
      kind: true,
      operation: true,
      price: true,
      rentPrice: true,
      currency: true,
      bedrooms: true,
      bathrooms: true,
      parking: true,
      builtM2: true,
      colonia: true,
      city: true,
      state: true,
      address: true,
      showExactAddress: true,
      isPublished: true,
      publicUrlSlug: true,
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const showPrice = ctx.settings.abilities.precio;
  const mapped = rows
    .map((p) => {
      const venta = Number(p.price ?? 0);
      const renta = p.rentPrice === null || p.rentPrice === undefined ? null : Number(p.rentPrice);
      const monto = operacion === "RENTA" ? (renta ?? venta) : venta;
      return { p, monto };
    })
    .filter(({ monto }) =>
      Number.isFinite(presupuestoMax) && presupuestoMax > 0 ? monto <= presupuestoMax * 1.1 : true,
    )
    .slice(0, MAX_RESULTS)
    .map(({ p, monto }) => ({
      id: p.id,
      titulo: p.title,
      tipo: p.kind,
      operacion: p.operation,
      precio: showPrice ? formatRealtyWaPrice(monto, p.currency) : "consultar con el asesor",
      recamaras: p.bedrooms,
      banos: p.bathrooms,
      cocheras: p.parking,
      m2Construidos: p.builtM2 === null || p.builtM2 === undefined ? null : Number(p.builtM2),
      zona: publicZone(p),
      liga: propertyPublicLink(ctx, p),
    }));

  return { total: mapped.length, inmuebles: mapped };
}

async function toolFichaInmueble(ctx: TurnCtx, args: Record<string, unknown>): Promise<unknown> {
  const id = typeof args.inmuebleId === "string" ? args.inmuebleId : "";
  if (!id) return { error: "Falta el id del inmueble." };
  const p = await prisma.realtyProperty.findFirst({
    where: { id, accountId: ctx.account.id },
    select: {
      id: true,
      title: true,
      description: true,
      kind: true,
      operation: true,
      status: true,
      price: true,
      rentPrice: true,
      maintenanceFee: true,
      currency: true,
      bedrooms: true,
      bathrooms: true,
      halfBathrooms: true,
      parking: true,
      builtM2: true,
      landM2: true,
      ageYears: true,
      amenities: true,
      colonia: true,
      city: true,
      state: true,
      address: true,
      showExactAddress: true,
      isPublished: true,
      publicUrlSlug: true,
    },
  });
  if (!p) return { error: "Ese inmueble no está en la cartera." };

  const showPrice = ctx.settings.abilities.precio;
  return {
    id: p.id,
    titulo: p.title,
    descripcion: (p.description ?? "").slice(0, 600),
    tipo: p.kind,
    operacion: p.operation,
    estatus: p.status,
    precioVenta: showPrice ? formatRealtyWaPrice(Number(p.price ?? 0), p.currency) : null,
    precioRenta:
      showPrice && p.rentPrice !== null && p.rentPrice !== undefined
        ? formatRealtyWaPrice(Number(p.rentPrice), p.currency)
        : null,
    mantenimiento:
      showPrice && p.maintenanceFee !== null && p.maintenanceFee !== undefined
        ? formatRealtyWaPrice(Number(p.maintenanceFee), p.currency)
        : null,
    recamaras: ctx.settings.abilities.caracteristicas ? p.bedrooms : null,
    banos: ctx.settings.abilities.caracteristicas ? p.bathrooms : null,
    mediosBanos: ctx.settings.abilities.caracteristicas ? p.halfBathrooms : null,
    cocheras: ctx.settings.abilities.caracteristicas ? p.parking : null,
    m2Construidos:
      ctx.settings.abilities.caracteristicas && p.builtM2 !== null && p.builtM2 !== undefined
        ? Number(p.builtM2)
        : null,
    m2Terreno:
      ctx.settings.abilities.caracteristicas && p.landM2 !== null && p.landM2 !== undefined
        ? Number(p.landM2)
        : null,
    antiguedadAnios: ctx.settings.abilities.caracteristicas ? p.ageYears : null,
    amenidades: ctx.settings.abilities.caracteristicas ? p.amenities : null,
    zona: ctx.settings.abilities.ubicacion ? publicZone(p) : null,
    // 🔴 Se repite aquí a propósito: aunque el modelo tuviera la dirección en
    // el historial, esta bandera es lo que la pantalla y el bot respetan.
    direccionExactaAutorizada: p.showExactAddress === true,
    liga: propertyPublicLink(ctx, p),
  };
}

/**
 * Horas LIBRES de un día para visitar un inmueble.
 *
 * 🔴 NO ES UNA AGENDA DE VERDAD, y el bot lo dice: la agenda del asesor la
 * construye otra terminal (O2-T3). Lo que esto devuelve son las horas de
 * oficina en las que NO hay ya otra visita a ESE inmueble — dato real de
 * realty_visits, no una hora inventada. Por eso la visita se crea
 * PROGRAMADA (apartada) y no CONFIRMADA: quien confirma es una persona.
 */
async function toolVisitasLibres(ctx: TurnCtx, args: Record<string, unknown>): Promise<unknown> {
  const id = typeof args.inmuebleId === "string" ? args.inmuebleId : "";
  const fecha = typeof args.fecha === "string" ? args.fecha.trim() : "";
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: "Necesito el inmueble y la fecha en formato AAAA-MM-DD." };
  }
  const property = await prisma.realtyProperty.findFirst({
    where: { id, accountId: ctx.account.id },
    select: { id: true },
  });
  if (!property) return { error: "Ese inmueble no está en la cartera." };

  const dayStart = zonedDateTime(fecha, "00:00", ctx.account.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const taken = await prisma.realtyVisit.findMany({
    where: {
      accountId: ctx.account.id,
      propertyId: id,
      scheduledAt: { gte: dayStart, lt: dayEnd },
      status: { in: ["PROGRAMADA", "CONFIRMADA"] },
    },
    select: { scheduledAt: true },
  });
  const takenMs = taken.map((v) => v.scheduledAt.getTime());

  const libres: string[] = [];
  for (let hour = 10; hour <= 18; hour += 1) {
    const hh = String(hour).padStart(2, "0");
    const slot = zonedDateTime(fecha, `${hh}:00`, ctx.account.timezone);
    if (slot.getTime() <= ctx.now.getTime()) continue;
    const choca = takenMs.some((t) => Math.abs(t - slot.getTime()) < VISIT_GAP_MIN * 60 * 1000);
    if (!choca) libres.push(`${hh}:00`);
  }
  return { fecha, libres, nota: "Son horas de oficina sin otra visita a ese inmueble." };
}

async function toolAgendarVisita(ctx: TurnCtx, args: Record<string, unknown>): Promise<unknown> {
  if (!ctx.settings.abilities.agendar) {
    return { error: "Agendar está apagado para este bot." };
  }
  const id = typeof args.inmuebleId === "string" ? args.inmuebleId : "";
  const fecha = typeof args.fecha === "string" ? args.fecha.trim() : "";
  const hora = typeof args.hora === "string" ? args.hora.trim() : "";
  const nombre = typeof args.nombre === "string" ? args.nombre.trim().slice(0, 80) : "";
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) {
    return { error: "Necesito inmueble, fecha (AAAA-MM-DD) y hora (HH:MM)." };
  }

  const when = zonedDateTime(fecha, hora, ctx.account.timezone);
  if (Number.isNaN(when.getTime())) return { error: "Esa fecha no se entiende." };
  if (when.getTime() <= ctx.now.getTime()) return { error: "Esa hora ya pasó." };
  if (when.getTime() > ctx.now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
    return { error: `Solo puedo apartar visitas dentro de los próximos ${MAX_DAYS_AHEAD} días.` };
  }

  // Choque con otra visita al MISMO inmueble. Se comprueba aquí aunque el
  // modelo haya pedido horarios: entre que los pidió y agendó pudo entrar
  // otra visita desde el panel.
  const choque = await prisma.realtyVisit.findFirst({
    where: {
      accountId: ctx.account.id,
      propertyId: id,
      status: { in: ["PROGRAMADA", "CONFIRMADA"] },
      scheduledAt: {
        gte: new Date(when.getTime() - VISIT_GAP_MIN * 60 * 1000),
        lte: new Date(when.getTime() + VISIT_GAP_MIN * 60 * 1000),
      },
    },
    select: { id: true },
  });
  if (choque) return { error: "Ya hay una visita a esa hora en ese inmueble. Ofrece otra." };

  const leadId = await ensureLead(ctx, id, nombre);
  if (!leadId) return { error: "No pude preparar el expediente del prospecto." };

  try {
    const visitId = await scheduleVisitFromLead(
      ctx.account.id,
      leadId,
      { propertyId: id, scheduledAt: when },
      ctx.actingUserId ?? "",
      {
        role: ctx.actingRole as never,
        realtyUserId: ctx.actingUserId ?? "",
        permissionsOverride: ctx.actingOverride,
      },
    );
    ctx.effects.visitId = visitId;
    return {
      ok: true,
      visitId,
      cuando: `${fecha} ${hora}`,
      nota: "Queda APARTADA. Un asesor la confirma y te da la dirección exacta.",
    };
  } catch (err) {
    console.error("[realty/bot] no se pudo agendar:", err);
    return { error: "No pude apartarla. Pásasela a una persona." };
  }
}

async function toolGuardarCalificacion(
  ctx: TurnCtx,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!ctx.settings.abilities.calificar) {
    return { error: "Calificar está apagado para este bot." };
  }
  const presupuestoMin = Number(args.presupuestoMin);
  const presupuestoMax = Number(args.presupuestoMax);
  const creditoRaw = typeof args.credito === "string" ? args.credito.toUpperCase() : "";
  const credito = ["INFONAVIT", "FOVISSSTE", "BANCARIO", "CONTADO", "NINGUNO"].includes(creditoRaw)
    ? creditoRaw
    : null;
  const zonas = Array.isArray(args.zonas)
    ? args.zonas.filter((z): z is string => typeof z === "string").slice(0, 8)
    : [];
  const recamaras = Number(args.recamaras);
  const operacionRaw = typeof args.operacion === "string" ? args.operacion.toUpperCase() : "";
  const operacion = ["VENTA", "RENTA"].includes(operacionRaw) ? operacionRaw : null;

  const leadId = await ensureLead(ctx, null, "");
  if (!leadId) return { error: "No pude preparar el expediente del prospecto." };

  const data: Record<string, unknown> = {};
  if (Number.isFinite(presupuestoMin) && presupuestoMin > 0) data.budgetMin = presupuestoMin;
  if (Number.isFinite(presupuestoMax) && presupuestoMax > 0) data.budgetMax = presupuestoMax;
  if (credito) data.creditKind = credito;

  try {
    if (Object.keys(data).length > 0) {
      await prisma.realtyLead.updateMany({
        where: { id: leadId, accountId: ctx.account.id },
        data: data as never,
      });
    }
    // El PERFIL DE BÚSQUEDA cuelga del contacto, no del lead: la misma
    // persona con dos prospectos busca lo mismo.
    if (ctx.contactId && (zonas.length > 0 || operacion || Number.isFinite(recamaras))) {
      const existing = await prisma.realtySearchProfile.findFirst({
        where: { accountId: ctx.account.id, contactId: ctx.contactId },
        select: { id: true },
      });
      const profile: Record<string, unknown> = {};
      if (zonas.length > 0) profile.zones = zonas;
      if (operacion) profile.operation = operacion;
      if (Number.isFinite(recamaras) && recamaras > 0) profile.bedroomsMin = Math.floor(recamaras);
      if (Number.isFinite(presupuestoMin) && presupuestoMin > 0) profile.budgetMin = presupuestoMin;
      if (Number.isFinite(presupuestoMax) && presupuestoMax > 0) profile.budgetMax = presupuestoMax;
      if (existing) {
        await prisma.realtySearchProfile.update({
          where: { id: existing.id },
          data: profile as never,
        });
      } else {
        // 🔴 notifyByWhatsapp se queda en su default (false). El bot NO
        // apunta a nadie a los avisos de coincidencia: eso lo pide la
        // persona, no lo decide una IA.
        await prisma.realtySearchProfile.create({
          data: { accountId: ctx.account.id, contactId: ctx.contactId, ...profile } as never,
        });
      }
    }
    ctx.effects.qualified = {
      presupuestoMin: data.budgetMin ?? null,
      presupuestoMax: data.budgetMax ?? null,
      credito,
      zonas,
      recamaras: Number.isFinite(recamaras) ? recamaras : null,
      operacion,
    };
    return { ok: true };
  } catch (err) {
    console.error("[realty/bot] no se pudo guardar la calificación:", err);
    return { error: "No pude guardarlo." };
  }
}

function toolPasarConPersona(ctx: TurnCtx, args: Record<string, unknown>): unknown {
  const motivo = typeof args.motivo === "string" ? args.motivo.trim().slice(0, 200) : "";
  ctx.effects.handoff = true;
  ctx.effects.handoffReason = motivo || "El bot pidió pasar la conversación.";
  return { ok: true };
}

/* ── Expediente del prospecto ──────────────────────────────────────── */

/**
 * Devuelve el leadId con el que trabajar, creando contacto y prospecto si
 * hace falta. Un WhatsApp entrante de alguien que no está en la libreta ES
 * un prospecto: perderlo porque "no estaba dado de alta" es exactamente lo
 * que este producto viene a resolver.
 */
async function ensureLead(
  ctx: TurnCtx,
  propertyId: string | null,
  nombre: string,
): Promise<string | null> {
  try {
    if (!ctx.contactId) {
      const created = await prisma.realtyContact.create({
        data: {
          accountId: ctx.account.id,
          name: nombre || ctx.contactName || `WhatsApp ${ctx.phone.slice(-4)}`,
          phone: ctx.phone,
          kind: "PROSPECTO",
          source: "whatsapp-bot",
        },
        select: { id: true, name: true },
      });
      ctx.contactId = created.id;
      ctx.contactName = created.name;
      // Ligar el hilo al contacto recién creado, para que el Inbox lo
      // enseñe con nombre en vez de con un número suelto.
      if (ctx.threadId) {
        await prisma.realtyThread.updateMany({
          where: { id: ctx.threadId, accountId: ctx.account.id, contactId: null },
          data: { contactId: created.id },
        });
      }
    } else if (nombre && (!ctx.contactName || /^WhatsApp /.test(ctx.contactName))) {
      await prisma.realtyContact.updateMany({
        where: { id: ctx.contactId, accountId: ctx.account.id },
        data: { name: nombre },
      });
      ctx.contactName = nombre;
    }

    if (ctx.leadId) return ctx.leadId;

    const open = await prisma.realtyLead.findFirst({
      where: {
        accountId: ctx.account.id,
        contactId: ctx.contactId,
        stage: { notIn: ["CIERRE", "PERDIDO"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (open) {
      ctx.leadId = open.id;
      return open.id;
    }

    const lead = await prisma.realtyLead.create({
      data: {
        accountId: ctx.account.id,
        contactId: ctx.contactId,
        propertyId: propertyId ?? undefined,
        portal: "whatsapp",
        stage: "CONTACTADO",
        firstResponseAt: ctx.now,
      },
      select: { id: true },
    });
    ctx.leadId = lead.id;
    return lead.id;
  } catch (err) {
    console.error("[realty/bot] no se pudo preparar el expediente:", err);
    return null;
  }
}

/* ── Fechas en la zona de la cuenta ────────────────────────────────── */

/**
 * "2026-09-03" + "16:00" + zona → Date en UTC.
 *
 * Se calcula el desfase REAL de la zona en ESA fecha (no un offset fijo):
 * México cambió de horario de verano en 2022 y una constante habría movido
 * todas las citas una hora la mitad del año.
 */
function zonedDateTime(dateISO: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = dateISO.split("-").map((n) => Number(n));
  const [hh, mi] = hhmm.split(":").map((n) => Number(n));
  const asUtc = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mi || 0, 0, 0);
  const probe = new Date(asUtc);
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(probe);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const local = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    );
    return new Date(asUtc + (asUtc - local));
  } catch {
    return probe;
  }
}

/* ── El prompt ─────────────────────────────────────────────────────── */

function buildSystemPrompt(ctx: TurnCtx, corrections: string[]): string {
  const s = ctx.settings;
  const nombre = s.botName || ctx.account.name;
  const parts = growthTzParts(ctx.now, ctx.account.timezone);
  const hoy = growthDayInTz(ctx.now, ctx.account.timezone);
  const manana = growthDayInTz(
    new Date(ctx.now.getTime() + 24 * 60 * 60 * 1000),
    ctx.account.timezone,
  );
  const hh = String(Math.floor(parts.minuteOfDay / 60)).padStart(2, "0");
  const mm = String(parts.minuteOfDay % 60).padStart(2, "0");

  const apagadas = (Object.keys(s.abilities) as (keyof typeof s.abilities)[]).filter(
    (k) => !s.abilities[k],
  );

  const lines: string[] = [
    `Eres ${nombre}, quien contesta el WhatsApp de ${ctx.account.name}, una inmobiliaria en México.`,
    "",
    s.tone === "formal"
      ? "TONO: amable y correcto, sin frases hechas ni exceso de confianza."
      : "TONO: cercano y directo, como un asesor que ya conoce la zona.",
    "",
    "CÓMO ESCRIBES:",
    "- Español de México. TUTEA siempre. Nunca 'usted', nunca voseo.",
    "- De 1 a 3 frases por mensaje. Es WhatsApp, no un correo.",
    "- Sin markdown, sin viñetas, sin negritas. Texto plano.",
    "- Una pregunta a la vez.",
    "- NUNCA digas que eres una inteligencia artificial ni un bot.",
    "",
    "🔴 LO QUE NO PUEDES HACER:",
    "- NO inventes inmuebles, precios, metros ni disponibilidad. Todo sale de tus herramientas.",
    "- NO des la dirección exacta de un inmueble. Das colonia y ciudad. La calle y el número los da el asesor al confirmar la visita, y solo si el propietario lo autorizó.",
    "- NO prometas descuentos, apartados, ni que el dueño acepta una oferta.",
    "- NO opines sobre si un crédito le van a aprobar ni des asesoría legal o fiscal.",
    "- Si te preguntan algo que no está en tus datos, usa pasar_con_persona. Vale más pasarla que inventar.",
    "",
    "CUÁNDO PASAS LA CONVERSACIÓN A UNA PERSONA (pasar_con_persona):",
    "- Si te lo pide, aunque sea de mala manera.",
    "- Si quiere negociar el precio, hacer una oferta o hablar de escrituras, créditos o contratos.",
    "- Si se queja o reclama.",
    "- Ante la duda, pásala.",
    "",
    `HOY es ${hoy} y son las ${hh}:${mm} en la zona de la inmobiliaria. "Mañana" es ${manana}.`,
  ];

  if (ctx.account.city) {
    lines.push(`La inmobiliaria opera en ${[ctx.account.city, ctx.account.state].filter(Boolean).join(", ")}.`);
  }
  if (ctx.contactName) {
    lines.push(`La persona con la que hablas se llama ${ctx.contactName.split(/\s+/)[0]}.`);
  } else {
    lines.push("Todavía no sabes su nombre. Pídeselo cuando vayas a apartar una visita, no antes.");
  }

  if (s.abilities.agendar) {
    lines.push(
      "",
      "AGENDAR: primero pide la fecha, consulta visitas_libres y ofrece 2 o 3 horas REALES de esa lista. Al apartar, di claramente que queda APARTADA y que un asesor la confirma.",
    );
  }
  if (s.abilities.calificar) {
    lines.push(
      "CALIFICAR: en algún momento natural pregunta su presupuesto y si compra de contado, con crédito bancario, Infonavit o Fovissste. Guárdalo con guardar_calificacion. No lo preguntes todo de golpe ni en el primer mensaje.",
    );
  }
  if (apagadas.length > 0) {
    lines.push(
      "",
      `NO PUEDES ayudar con: ${apagadas.join(", ")}. Si lo piden, dilo con honestidad y pasa la conversación.`,
    );
  }
  if (s.notes.trim()) {
    lines.push("", "DATOS QUE TE DIO LA INMOBILIARIA:", s.notes.trim());
  }
  if (corrections.length > 0) {
    lines.push(
      "",
      "CORRECCIONES QUE TE HIZO EL EQUIPO (respétalas por encima de todo lo demás):",
      ...corrections.slice(0, 6).map((c) => `- ${c}`),
    );
  }
  return lines.join("\n");
}

function toolDefs(s: RealtyBotSettings): Anthropic.Tool[] {
  const defs: Anthropic.Tool[] = [
    {
      name: "buscar_inmuebles",
      description:
        "Busca en la cartera de la inmobiliaria. Úsala SIEMPRE antes de mencionar cualquier inmueble.",
      input_schema: {
        type: "object",
        properties: {
          operacion: { type: "string", enum: ["VENTA", "RENTA"] },
          tipo: {
            type: "string",
            enum: ["CASA", "DEPARTAMENTO", "TERRENO", "BODEGA", "LOCAL", "EDIFICIO", "OFICINA", "RANCHO"],
          },
          zona: { type: "string", description: "Colonia, ciudad o estado." },
          presupuestoMax: { type: "number", description: "En pesos." },
          recamaras: { type: "number" },
        },
      },
    },
    {
      name: "ficha_inmueble",
      description: "Todos los datos de UN inmueble, por su id.",
      input_schema: {
        type: "object",
        properties: { inmuebleId: { type: "string" } },
        required: ["inmuebleId"],
      },
    },
    {
      name: "pasar_con_persona",
      description:
        "Pasa la conversación a alguien de la inmobiliaria. Úsala si te lo pide, si se queja, si quiere negociar, o si preguntan algo que no está en tus datos.",
      input_schema: {
        type: "object",
        properties: { motivo: { type: "string", description: "En pocas palabras, para el panel." } },
        required: ["motivo"],
      },
    },
  ];

  if (s.abilities.agendar) {
    defs.push({
      name: "visitas_libres",
      description:
        "Horas de oficina de un día en las que NO hay otra visita a ese inmueble. Consúltala antes de ofrecer horarios.",
      input_schema: {
        type: "object",
        properties: {
          inmuebleId: { type: "string" },
          fecha: { type: "string", description: "AAAA-MM-DD" },
        },
        required: ["inmuebleId", "fecha"],
      },
    });
    defs.push({
      name: "agendar_visita",
      description:
        "Aparta una visita. Solo con una hora que haya salido de visitas_libres y con el nombre de la persona.",
      input_schema: {
        type: "object",
        properties: {
          inmuebleId: { type: "string" },
          fecha: { type: "string", description: "AAAA-MM-DD" },
          hora: { type: "string", description: "HH:MM en 24 horas" },
          nombre: { type: "string" },
        },
        required: ["inmuebleId", "fecha", "hora"],
      },
    });
  }

  if (s.abilities.calificar) {
    defs.push({
      name: "guardar_calificacion",
      description:
        "Guarda en el expediente lo que el prospecto te dijo de su presupuesto, su crédito y lo que busca.",
      input_schema: {
        type: "object",
        properties: {
          presupuestoMin: { type: "number" },
          presupuestoMax: { type: "number" },
          credito: {
            type: "string",
            enum: ["INFONAVIT", "FOVISSSTE", "BANCARIO", "CONTADO", "NINGUNO"],
          },
          zonas: { type: "array", items: { type: "string" } },
          recamaras: { type: "number" },
          operacion: { type: "string", enum: ["VENTA", "RENTA"] },
        },
      },
    });
  }

  return defs;
}

async function runTool(ctx: TurnCtx, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "buscar_inmuebles":
      return toolBuscarInmuebles(ctx, args);
    case "ficha_inmueble":
      return toolFichaInmueble(ctx, args);
    case "visitas_libres":
      return toolVisitasLibres(ctx, args);
    case "agendar_visita":
      return toolAgendarVisita(ctx, args);
    case "guardar_calificacion":
      return toolGuardarCalificacion(ctx, args);
    case "pasar_con_persona":
      return toolPasarConPersona(ctx, args);
    default:
      return { error: "Herramienta desconocida." };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   EL TURNO
   ═══════════════════════════════════════════════════════════════════════ */

export async function runRealtyBotTurn(input: RealtyBotTurnInput): Promise<RealtyBotTurnResult> {
  try {
    return await runTurnInner(input);
  } catch (err) {
    console.error("[realty/bot] turno con error:", err);
    return noReply("error");
  }
}

async function runTurnInner(input: RealtyBotTurnInput): Promise<RealtyBotTurnResult> {
  const now = input.now ?? new Date();
  const deadline = now.getTime() + TURN_BUDGET_MS;
  const phone = mxTenDigits(input.phone);
  const text = String(input.text ?? "").trim();
  if (!phone || !text) return noReply("error");

  // ── Los gates BARATOS primero. Ninguno cuesta un peso. ──
  if (!(await realtyGrowthStorageReady())) return noReply("storageMissing");

  const settings = await getRealtyBotSettings(input.accountId);
  if (!settings.enabled) return noReply("disabled");

  const account = await loadAccount(input.accountId);
  if (!account || !account.isActive) return noReply("disabled");

  // Candado de PLAN en el SERVIDOR. La pantalla también lo dibuja, pero una
  // pantalla se puede saltar.
  const plan = await getRealtyPlan(account.plan as never);
  if (!realtyPlanHasFeature(plan, REALTY_BOT_FEATURE)) return noReply("planLocked");
  if (!realtyPlanHasFeature(plan, "whatsapp")) return noReply("planLocked");
  if (!isRealtySubscriptionActive(account)) return noReply("subscriptionInactive");

  if (await isRealtyBotThreadPaused(input.accountId, phone)) return noReply("paused");

  // 🔴 Quien pidió baja TOTAL no recibe ni siquiera una respuesta del bot.
  // (La baja de MARKETING no aplica aquí: contestarle a quien te acaba de
  // escribir no es publicidad, es atención.)
  if (await isRealtyOptedOut(input.accountId, phone, "ALL")) return noReply("optedOut");

  const day = growthDayInTz(now, account.timezone);
  const tz = growthTzParts(now, account.timezone);
  if (!realtyBotAnswersNow(settings.hours, tz.weekday, tz.minuteOfDay)) {
    await pauseRealtyBotThread({
      accountId: input.accountId,
      phone,
      reason: "Escribió fuera del horario del bot",
    });
    return {
      reply:
        "¡Hola! Ahorita no estamos en línea. En cuanto abramos te contesta alguien del equipo por aquí. 🙏",
      skipped: "offHours",
      effects: emptyEffects(),
    };
  }

  // 🔴 `exhausted` y NO `remaining <= 0`: en un plan ILIMITADO el DTO
  // devuelve remaining = -1 (el centinela de "sin límite"), que también es
  // <= 0. Comparar contra remaining habría dejado mudo al bot justo en el
  // plan más caro. El único campo que responde la pregunta es `exhausted`.
  const quota = await getRealtyWaQuota(input.accountId);
  if (quota.exhausted) return noReply("quotaExhausted");

  const replies = await countRealtyBotRepliesToday(input.accountId, phone, day, account.timezone);
  if (replies >= settings.maxRepliesPerContactPerDay) return noReply("tooManyReplies");

  // Detección por REGLAS antes de gastar en IA.
  if (realtyBotAsksForHuman(text)) {
    await pauseRealtyBotThread({
      accountId: input.accountId,
      phone,
      reason: "El prospecto pidió hablar con una persona",
    });
    const effects = emptyEffects();
    effects.handoff = true;
    effects.handoffReason = "El prospecto pidió hablar con una persona";
    return {
      reply:
        "Claro que sí. Ya le avisé a un asesor y te escribe en un momento por aquí. 🙌",
      skipped: "handoff",
      effects,
    };
  }

  // ── El DINERO. Ninguna llamada al modelo pasa por encima de esto. ──
  const apiKey = aiApiKey();
  if (!apiKey) return noReply("aiUnavailable");
  const model = aiModel();
  const spentMicros = await readRealtyBotSpendMicros(input.accountId, day);
  if (!realtyBotCanSpend(spentMicros, settings.aiDailyCapMxn)) {
    // El tope frena a la IA, no al servicio: se contesta con la verdad y se
    // marca el hilo para que lo tome una persona.
    await pauseRealtyBotThread({
      accountId: input.accountId,
      phone,
      reason: "Se alcanzó el tope de gasto de IA del día",
    });
    return {
      reply: "¡Hola! En un momento te atiende un asesor por aquí. 🙏",
      skipped: "aiCapReached",
      effects: emptyEffects(),
    };
  }

  // ── Contexto de la conversación ──
  const thread = await prisma.realtyThread.findUnique({
    where: { accountId_phone: { accountId: input.accountId, phone } },
    select: { id: true, contactId: true, contact: { select: { id: true, name: true } } },
  });

  const lead = thread?.contactId
    ? await prisma.realtyLead.findFirst({
        where: {
          accountId: input.accountId,
          contactId: thread.contactId,
          stage: { notIn: ["CIERRE", "PERDIDO"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, assignedUserId: true },
      })
    : null;

  const acting = await resolveActingUser(input.accountId, lead?.assignedUserId ?? null);

  const ctx: TurnCtx = {
    account,
    settings,
    threadId: thread?.id ?? null,
    contactId: thread?.contactId ?? null,
    contactName: thread?.contact?.name ?? null,
    leadId: lead?.id ?? null,
    actingUserId: acting?.id ?? null,
    actingRole: acting?.role ?? "ASSISTANT",
    actingOverride: acting?.permissionsOverride ?? [],
    phone,
    now,
    effects: emptyEffects(),
  };

  const history = thread ? await loadHistory(input.accountId, thread.id) : [];
  const corrections = thread ? await loadCorrections(input.accountId) : [];

  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: text }];
  const system = buildSystemPrompt(ctx, corrections);
  const tools = toolDefs(settings);

  const client = new Anthropic({
    apiKey,
    timeout: AI_CALL_TIMEOUT_MS,
    // Sin reintentos: el presupuesto del turno es de 13 segundos y un
    // reintento del SDK se lo come entero. Si falla, se pasa a una persona.
    maxRetries: 0,
  });

  let reply: string | null = null;
  let aiFailed = false;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    if (Date.now() > deadline) break;
    // En la última ronda se quitan las herramientas para forzar que cierre
    // con texto en vez de pedir una herramienta más.
    const lastRound = round === MAX_TOOL_ROUNDS - 1;

    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages,
        ...(lastRound ? {} : { tools }),
      });
    } catch (err) {
      console.error("[realty/bot] la IA no respondió:", err);
      aiFailed = true;
      break;
    }

    inputTokens += res.usage?.input_tokens ?? 0;
    outputTokens += res.usage?.output_tokens ?? 0;

    const textBlocks = res.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const said = textBlocks.map((b) => b.text).join("\n").trim();
    if (said) reply = said;

    if (toolUses.length === 0 || lastRound) break;

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      // 🔴 Los inputs de herramienta se leen SIEMPRE como objeto ya
      // parseado por el SDK; nunca se hace string matching sobre el JSON.
      const args = (use.input ?? {}) as Record<string, unknown>;
      let out: unknown;
      try {
        out = await runTool(ctx, use.name, args);
      } catch (err) {
        console.error(`[realty/bot] herramienta ${use.name} falló:`, err);
        out = { error: "No se pudo consultar." };
      }
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(out).slice(0, 6000),
      });
    }
    // Todos los tool_result en UN SOLO mensaje de usuario: partirlos entrena
    // al modelo a dejar de pedir herramientas en paralelo.
    messages.push({ role: "user", content: results });
  }

  const costMicros = realtyBotTurnCostMicros({
    model,
    inputTokens,
    outputTokens,
    usdMxn: usdMxn(),
  });
  ctx.effects.model = model;
  ctx.effects.inputTokens = inputTokens;
  ctx.effects.outputTokens = outputTokens;
  ctx.effects.costMicros = costMicros;
  if (costMicros > 0) await addRealtyBotSpend(input.accountId, day, costMicros);

  if (ctx.effects.handoff) {
    await pauseRealtyBotThread({
      accountId: input.accountId,
      phone,
      reason: ctx.effects.handoffReason,
    });
  }

  if (!reply) {
    await pauseRealtyBotThread({
      accountId: input.accountId,
      phone,
      reason: aiFailed ? "El bot no pudo responder" : "El bot no supo qué contestar",
    });
    return {
      reply:
        "Déjame paso esto con un asesor para no darte mal la información. Te escriben en un momento. 🙏",
      skipped: aiFailed ? "aiUnavailable" : "handoff",
      effects: ctx.effects,
    };
  }

  return {
    reply: reply.slice(0, MAX_REPLY_CHARS),
    skipped: null,
    effects: ctx.effects,
  };
}

/**
 * A nombre de quién escribe el bot en el CRM. Es el asesor asignado al
 * prospecto; si no hay, el OWNER de la cuenta. Nunca un id inventado: la FK
 * de RealtyVisit.userId es global y un id ajeno filtraría el nombre de un
 * empleado de otra inmobiliaria (el mismo bug que documenta leads.ts).
 */
async function resolveActingUser(
  accountId: string,
  preferredUserId: string | null,
): Promise<{ id: string; role: string; permissionsOverride: string[] } | null> {
  if (preferredUserId) {
    const u = await prisma.realtyUser.findFirst({
      where: { id: preferredUserId, accountId, active: true },
      select: { id: true, role: true, permissionsOverride: true },
    });
    if (u) return { id: u.id, role: u.role, permissionsOverride: u.permissionsOverride ?? [] };
  }
  const owner = await prisma.realtyUser.findFirst({
    where: { accountId, active: true, role: { in: ["OWNER", "MANAGER"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, permissionsOverride: true },
  });
  if (!owner) return null;
  return {
    id: owner.id,
    role: owner.role,
    permissionsOverride: owner.permissionsOverride ?? [],
  };
}

/** Los últimos turnos del hilo, incluyendo lo que contestó una persona. */
async function loadHistory(
  accountId: string,
  threadId: string,
): Promise<Anthropic.MessageParam[]> {
  const rows = await prisma.realtyMessage.findMany({
    where: { accountId, threadId, body: { not: null } },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { direction: true, body: true },
  });
  const out: Anthropic.MessageParam[] = [];
  for (const row of rows.reverse()) {
    const body = (row.body ?? "").trim();
    if (!body) continue;
    out.push({
      role: row.direction === "INBOUND" ? "user" : "assistant",
      content: body.slice(0, 1500),
    });
  }
  // La API exige que el primero sea del usuario.
  while (out.length > 0 && out[0].role !== "user") out.shift();
  return out;
}

/**
 * Las correcciones que escribió el equipo sobre respuestas anteriores. Es
 * lo que hace que corregir al bot SIRVA de algo: no se queda en el panel,
 * entra al prompt del siguiente turno.
 */
async function loadCorrections(accountId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ correctedBody: string }[]>(
      `SELECT "correctedBody" FROM realty_bot_turns
       WHERE "accountId" = $1 AND "correctedBody" IS NOT NULL
       ORDER BY "correctedAt" DESC LIMIT 6`,
      accountId,
    );
    return rows.map((r) => r.correctedBody).filter(Boolean);
  } catch {
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   ENVÍO — el bot decide, sendRealtyWhatsApp manda
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * ⭐ LA LÍNEA QUE FALTA PARA RESPUESTA INSTANTÁNEA.
 *
 * Hace el turno y manda la respuesta por el ÚNICO camino a Meta que tiene
 * el vertical. Es lo que el dueño de `src/lib/realty/whatsapp.ts` puede
 * llamar desde `ingestRealtyInbound` con una línea, sin que esta terminal
 * haya tocado su archivo.
 */
export async function runRealtyBotAndReply(
  input: RealtyBotTurnInput,
): Promise<RealtyBotTurnResult> {
  const result = await runRealtyBotTurn(input);
  const phone = mxTenDigits(input.phone) ?? input.phone;

  if (result.reply) {
    // Import dinámico: si el módulo de WhatsApp cambiara o fallara al
    // cargar, el bot no puede tumbar a quien lo llamó.
    try {
      const { sendRealtyWhatsApp } = await import("@/lib/realty/whatsapp");
      const sent = await sendRealtyWhatsApp({
        accountId: input.accountId,
        phone,
        body: result.reply,
        // Sin `kind`: el bot SOLO contesta dentro de la ventana de 24 h.
        // Fuera de ella no hay plantilla que valga — escribirle primero a
        // alguien con una plantilla es otra cosa, y no le toca al bot.
        kind: null,
      });
      // Guarda de tipo EXPLÍCITA: el repo compila con `strict: false` y ahí
      // TypeScript NO estrecha una unión por un booleano discriminante.
      if (isRealtyWaSendErr(sent)) {
        console.error("[realty/bot] no se pudo entregar la respuesta:", sent.error);
      }
    } catch (err) {
      console.error("[realty/bot] el envío falló:", err);
    }
  }

  await logRealtyBotTurn({
    accountId: input.accountId,
    threadId: null,
    contactId: null,
    leadId: null,
    phone,
    inboundBody: String(input.text ?? "").slice(0, 2000),
    outboundBody: result.reply,
    skipReason: result.skipped,
    handoff: result.effects.handoff,
    handoffReason: result.effects.handoffReason,
    model: result.effects.model,
    inputTokens: result.effects.inputTokens,
    outputTokens: result.effects.outputTokens,
    costMicros: result.effects.costMicros,
    // `visitId` viaja DENTRO de `extracted` y no en columna propia: es lo
    // que hace demostrable en el panel "el bot agendó ESTA visita". Sin
    // esto, una visita apartada por el bot es indistinguible de una que
    // capturó una persona, y esa prueba es justo lo que convence a un dueño
    // de dejarlo encendido.
    extracted:
      result.effects.qualified || result.effects.visitId
        ? { ...(result.effects.qualified ?? {}), visitId: result.effects.visitId }
        : null,
  });

  return result;
}

/* ═══════════════════════════════════════════════════════════════════════
   BARRIDO — lo que hace que el bot funcione HOY sin tocar el webhook
   ═══════════════════════════════════════════════════════════════════════ */

export interface RealtyBotSweepResult {
  scanned: number;
  answered: number;
  skipped: number;
}

/**
 * Busca hilos con un mensaje ENTRANTE sin contestar y corre el turno.
 *
 * Es la forma honesta de tener el bot vivo sin tocar el webhook: la
 * respuesta llega con el retraso del barrido, no en el mismo segundo. El
 * día que se enganche `runRealtyBotAndReply` dentro de `ingestRealtyInbound`
 * (una línea), esto sigue sirviendo de red: recoge lo que el webhook haya
 * perdido por un reintento fallido.
 *
 * Solo mira hilos con actividad dentro de la ventana de 24 h: fuera de ella
 * el bot no puede contestar de todas formas.
 */
export async function sweepRealtyBot(
  accountId?: string,
  opts: { limit?: number; now?: Date } = {},
): Promise<RealtyBotSweepResult> {
  const now = opts.now ?? new Date();
  const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 20)));
  const windowStart = new Date(now.getTime() - REALTY_WA_WINDOW_MS);
  const out: RealtyBotSweepResult = { scanned: 0, answered: 0, skipped: 0 };

  const threads = await prisma.realtyThread.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      archived: false,
      unread: { gt: 0 },
      lastMessageAt: { gte: windowStart },
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: { id: true, accountId: true, phone: true },
  });

  for (const thread of threads) {
    out.scanned += 1;
    const last = await prisma.realtyMessage.findFirst({
      where: { accountId: thread.accountId, threadId: thread.id },
      orderBy: { createdAt: "desc" },
      select: { direction: true, body: true, createdAt: true },
    });
    // Solo si el ÚLTIMO mensaje del hilo es ENTRANTE y con texto: si ya
    // contestó una persona (o el propio bot), no hay nada que hacer.
    if (!last || last.direction !== "INBOUND" || !last.body) {
      out.skipped += 1;
      continue;
    }
    if (!realtyWaWindowOpen(last.createdAt)) {
      out.skipped += 1;
      continue;
    }
    const res = await runRealtyBotAndReply({
      accountId: thread.accountId,
      phone: thread.phone,
      text: last.body,
      now,
    });
    if (res.reply) out.answered += 1;
    else out.skipped += 1;
  }

  return out;
}

/** Gasto de hoy, para el panel. */
export async function getRealtyBotSpendToday(
  accountId: string,
  timezone: string,
  capMxn: number,
  now = new Date(),
): Promise<{ day: string; spentMxn: number; capMxn: number; turns: number; capReached: boolean }> {
  const day = growthDayInTz(now, timezone);
  const micros = await readRealtyBotSpendMicros(accountId, day);
  const safeMicros = Number.isFinite(micros) ? micros : capMxn * MICROS_PER_MXN;
  return {
    day,
    spentMxn: Math.round((safeMicros / MICROS_PER_MXN) * 100) / 100,
    capMxn,
    turns: 0,
    capReached: !realtyBotCanSpend(micros, capMxn),
  };
}

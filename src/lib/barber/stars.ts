import "server-only";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { assertBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { clientsViewScope, scopeUserFromCtx } from "@/lib/barber/own-visits";
import {
  LOYALTY_HISTORY_MAX,
  LOYALTY_LEDGER_KEY,
  barberCanSeeClient,
  barberClientScopeWhere,
  readLoyaltyLedger,
  saveBarberClientsConfig,
  withReservedPreference,
} from "@/lib/barber/clients";
import {
  STARS_LEDGER_KEY,
  STARS_LEDGER_MAX,
  readStarsLedger,
  refreshLoyalty,
  type StarAdjustment,
} from "@/lib/barber/loyalty-core";
import {
  BONUS_MAX_PER_SHOP,
  BonusValidationError,
  CARD_KEY,
  LEGACY_BONUS_ID,
  activeBonuses,
  bonusTableReady,
  cardPath,
  cardVersion,
  cheapestBonus,
  loadBonusCatalog,
  loadStarsView,
  normalizeBonusInput,
  signCardToken,
  type BonusCatalog,
  type BonusInput,
  type StarsView,
} from "@/lib/barber/stars-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — estrellas y bonos con la SESIÓN de la barbería.
 *
 * Todo lo que el panel hace sobre la tarjeta de estrellas de un cliente:
 * verla, dar o quitar una estrella a mano, marcar un bono como entregado,
 * sacar su enlace personal (o revocarlo) y editar el catálogo de bonos.
 *
 * PERMISOS (Rafael, 15-nov-2026):
 *   · crear y editar bonos ............ settings.edit (dueño/encargado)
 *   · dar/quitar estrella, entregar bono y sacar el enlace
 *                                       cash.manage (quien cobra, Recepción incluida)
 *   · el rol Barbero solo ve —y toca— las estrellas de SUS clientes: el
 *     mismo recorte de la ficha (barberClientScopeWhere).
 *
 * El barbershopId sale SIEMPRE de ctx; ninguna función lo acepta suelto.
 * ═══════════════════════════════════════════════════════════════════════
 */

export class StarsError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StarsError";
  }
}

/**
 * Motivo de «Dar / Quitar estrella»: OPCIONAL y corto (15-nov: Rafael nunca
 * pidió que fuera obligatorio). Vacío se guarda "" y el historial lo enseña
 * sin motivo (stars-core: note = reason || null). El tope de 200 se queda.
 */
export const STAR_REASON_MIN = 0;
export const STAR_REASON_MAX = 200;
export const BONUS_NOTE_MAX = 200;

/** ¿Puede tocar estrellas (dar, quitar, entregar bono, enlace)? */
export function canHandleStars(ctx: Pick<BarberContext, "role" | "user">): boolean {
  return hasBarberPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, "cash.manage");
}

async function assertClientInScope(ctx: BarberContext, clientId: string): Promise<void> {
  if (typeof clientId !== "string" || !clientId || clientId.length > 64) {
    throw new StarsError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
  }
  const n = await prisma.barberClient.count({ where: { id: clientId, barbershopId: ctx.barbershopId } });
  if (n === 0) throw new StarsError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
  // Rol Barbero: un cliente que no es suyo se ve igual que uno que no existe.
  if (barberClientScopeWhere(ctx) && !(await barberCanSeeClient(ctx, clientId))) {
    throw new StarsError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
  }
}

function staffName(ctx: BarberContext): string {
  const full = `${ctx.user.firstName ?? ""} ${ctx.user.lastName ?? ""}`.trim();
  return (full || ctx.user.email || "—").slice(0, 80);
}

/** La tarjeta como la ve la barbería (con motivos y quién). */
export async function getStaffStarsView(ctx: BarberContext, clientId: string): Promise<StarsView | null> {
  try {
    await assertClientInScope(ctx, clientId);
  } catch (e) {
    if (e instanceof StarsError) return null;
    throw e;
  }
  return staffView(ctx, clientId);
}

/**
 * La vista «staff» con el recorte del rol Barbero: en un cliente SUYO solo
 * ve el historial de sus visitas (misma regla que la ficha, clientsViewScope).
 */
function staffView(ctx: BarberContext, clientId: string): Promise<StarsView | null> {
  const scope = clientsViewScope(scopeUserFromCtx(ctx));
  return loadStarsView(prisma, {
    barbershopId: ctx.barbershopId,
    clientId,
    audience: "staff",
    onlyBarberId: scope.kind === "own" ? scope.barberId : null,
  });
}

/** Candado sobre la fila del cliente dentro de la transacción. */
async function lockClient(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  barbershopId: string,
  clientId: string,
): Promise<{ preferences: unknown } | null> {
  await tx.$queryRaw`
    SELECT "id" FROM "barber_clients"
    WHERE "id" = ${clientId} AND "barbershopId" = ${barbershopId}
    FOR UPDATE
  `;
  return tx.barberClient.findFirst({
    where: { id: clientId, barbershopId },
    select: { preferences: true },
  });
}

// ── Dar / quitar estrella a mano ───────────────────────────────────────

/**
 * Suma o resta UNA estrella con motivo. Queda en el historial con quién y
 * cuándo. Quitar exige que tenga al menos una (nunca deja negativo). El
 * recuento y la escritura van bajo el candado de la fila del cliente: dos
 * «Quitar» a la vez no dejan la tarjeta en −1.
 */
export async function adjustClientStars(
  ctx: BarberContext,
  args: { clientId: string; delta: unknown; reason: unknown },
): Promise<StarsView> {
  assertBarberPermission(ctx, "cash.manage");
  const delta = args.delta === 1 || args.delta === -1 ? (args.delta as 1 | -1) : null;
  if (delta === null) throw new StarsError(400, "INVALID_INPUT", "Solo se puede dar o quitar una estrella a la vez.");
  const reason = typeof args.reason === "string" ? args.reason.replace(/\s+/g, " ").trim() : "";
  if (reason.length > STAR_REASON_MAX) {
    throw new StarsError(400, "INVALID_INPUT", `El motivo va hasta ${STAR_REASON_MAX} caracteres.`);
  }
  await assertClientInScope(ctx, args.clientId);
  const barbershopId = ctx.barbershopId;

  await prisma.$transaction(
    async (tx) => {
      const row = await lockClient(tx, barbershopId, args.clientId);
      if (!row) throw new StarsError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
      if (delta === -1) {
        const now = (await refreshLoyalty(tx, barbershopId, [args.clientId])).get(args.clientId)?.count ?? 0;
        if (now < 1) throw new StarsError(409, "NO_STARS", "No tiene estrellas que quitar.");
      }
      const ledger = readStarsLedger(row.preferences);
      const entry: StarAdjustment = {
        id: randomUUID(),
        at: new Date().toISOString(),
        delta,
        reason,
        byUserId: ctx.barberUserId,
        byName: staffName(ctx),
      };
      await tx.barberClient.updateMany({
        where: { id: args.clientId, barbershopId },
        data: {
          preferences: withReservedPreference(row.preferences, STARS_LEDGER_KEY, {
            net: ledger.net + delta,
            entries: [entry, ...ledger.entries].slice(0, STARS_LEDGER_MAX),
          }),
        },
      });
      await refreshLoyalty(tx, barbershopId, [args.clientId]);
    },
    { maxWait: 5000, timeout: 15000 },
  );

  const view = await staffView(ctx, args.clientId);
  if (!view) throw new StarsError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
  return view;
}

// ── Marcar un bono como entregado (lo que no pasa por caja) ─────────────

/**
 * Descuenta las estrellas del bono y lo anota en la bitácora de canjes de
 * la ficha (__loyalty, la misma que ya usaba «Canjear premio»), con el id y
 * el nombre del bono. Recuento y escritura bajo candado.
 */
export async function deliverClientBonus(
  ctx: BarberContext,
  args: { clientId: string; bonusId: unknown; note?: unknown },
): Promise<StarsView> {
  assertBarberPermission(ctx, "cash.manage");
  await assertClientInScope(ctx, args.clientId);
  const barbershopId = ctx.barbershopId;
  const catalog = await loadBonusCatalog(prisma, barbershopId);
  if (!catalog.rule.enabled) {
    throw new StarsError(409, "LOYALTY_DISABLED", "La tarjeta de estrellas está apagada en esta barbería.");
  }
  const bonus = activeBonuses(catalog.bonuses).find((b) => b.id === args.bonusId);
  if (!bonus) throw new StarsError(404, "BONUS_NOT_FOUND", "Ese bono no existe o está inactivo.");
  const note =
    typeof args.note === "string" && args.note.trim() ? args.note.trim().slice(0, BONUS_NOTE_MAX) : null;

  await prisma.$transaction(
    async (tx) => {
      const row = await lockClient(tx, barbershopId, args.clientId);
      if (!row) throw new StarsError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
      const stars = (await refreshLoyalty(tx, barbershopId, [args.clientId])).get(args.clientId)?.count ?? 0;
      if (stars < bonus.cost) {
        throw new StarsError(409, "NOT_ENOUGH_STARS", `Tiene ${stars} de ${bonus.cost} estrellas para «${bonus.name}».`);
      }
      const ledger = readLoyaltyLedger(row.preferences);
      const entry = {
        at: new Date().toISOString(),
        byUserId: ctx.barberUserId,
        threshold: bonus.cost,
        reward: bonus.name,
        rewardId: bonus.id,
        appointmentId: null,
        note,
      };
      await tx.barberClient.updateMany({
        where: { id: args.clientId, barbershopId },
        data: {
          preferences: withReservedPreference(row.preferences, LOYALTY_LEDGER_KEY, {
            redeemedVisits: ledger.redeemedVisits + bonus.cost,
            redemptions: [entry, ...ledger.redemptions].slice(0, LOYALTY_HISTORY_MAX),
          }),
        },
      });
      await refreshLoyalty(tx, barbershopId, [args.clientId]);
    },
    { maxWait: 5000, timeout: 15000 },
  );

  const view = await staffView(ctx, args.clientId);
  if (!view) throw new StarsError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
  return view;
}

// ── El enlace personal de la tarjeta ───────────────────────────────────

export interface CardLink {
  /** Ruta sin dominio: /b/<slug>/tarjeta/<token>. */
  path: string;
  version: number;
}

export async function getClientCardLink(ctx: BarberContext, clientId: string): Promise<CardLink> {
  assertBarberPermission(ctx, "cash.manage");
  await assertClientInScope(ctx, clientId);
  const row = await prisma.barberClient.findFirst({
    where: { id: clientId, barbershopId: ctx.barbershopId },
    select: { preferences: true },
  });
  if (!row) throw new StarsError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
  const version = cardVersion(row.preferences);
  return { path: cardPath(ctx.barbershop.slug, signCardToken(ctx.barbershopId, clientId, version)), version };
}

/**
 * Revoca el enlace: sube la versión. El enlace viejo deja de abrir (la firma
 * ya no cuadra con la versión guardada) y se devuelve el nuevo.
 */
export async function revokeClientCard(ctx: BarberContext, clientId: string): Promise<CardLink> {
  assertBarberPermission(ctx, "cash.manage");
  await assertClientInScope(ctx, clientId);
  const barbershopId = ctx.barbershopId;
  const version = await prisma.$transaction(async (tx) => {
    const row = await lockClient(tx, barbershopId, clientId);
    if (!row) throw new StarsError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
    const next = cardVersion(row.preferences) + 1;
    await tx.barberClient.updateMany({
      where: { id: clientId, barbershopId },
      data: {
        preferences: withReservedPreference(row.preferences, CARD_KEY, {
          v: next,
          revokedAt: new Date().toISOString(),
          byUserId: ctx.barberUserId,
        }),
      },
    });
    return next;
  });
  return { path: cardPath(ctx.barbershop.slug, signCardToken(barbershopId, clientId, version)), version };
}

// ── El catálogo de bonos (Clientes → Estrellas y bonos) ─────────────────

export interface BonusEditorData {
  catalog: BonusCatalog;
  services: Array<{ id: string; name: string; price: number }>;
  maxBonuses: number;
}

export async function getBonusEditor(ctx: BarberContext): Promise<BonusEditorData> {
  assertBarberPermission(ctx, "clients.view");
  const [catalog, services] = await Promise.all([
    loadBonusCatalog(prisma, ctx.barbershopId),
    prisma.barberService.findMany({
      where: { barbershopId: ctx.barbershopId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, price: true },
    }),
  ]);
  return {
    catalog,
    services: services.map((s) => ({ id: s.id, name: s.name, price: Number(s.price) })),
    maxBonuses: BONUS_MAX_PER_SHOP,
  };
}

/**
 * Guarda el catálogo completo que manda la pantalla. No borra nada: un bono
 * que ya no se quiere se marca inactivo (los canjes viejos guardan su nombre
 * y lo que costaron, así que el historial no depende de la fila).
 *
 * Antes de pegar sql/barber_estrellas.sql solo existe el premio de siempre:
 * se puede renombrar y cambiar de costo (escribe las columnas de siempre),
 * pero no se pueden crear más → 409 «sql_pendiente».
 *
 * Después, el bono más barato activo se copia a las columnas de siempre
 * (loyaltyThreshold / loyaltyReward): así la lista de clientes («premio
 * listo»), las campañas y la Configuración siguen viendo un número coherente.
 */
export async function saveBonusCatalog(ctx: BarberContext, rawList: unknown): Promise<BonusEditorData> {
  assertBarberPermission(ctx, "settings.edit");
  const barbershopId = ctx.barbershopId;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new StarsError(400, "INVALID_INPUT", "Deja al menos un bono.");
  }
  if (rawList.length > BONUS_MAX_PER_SHOP) {
    throw new StarsError(400, "INVALID_INPUT", `Máximo ${BONUS_MAX_PER_SHOP} bonos.`);
  }
  const services = await prisma.barberService.findMany({
    where: { barbershopId },
    select: { id: true },
  });
  const serviceIds = new Set(services.map((s) => s.id));
  let list: BonusInput[];
  try {
    list = rawList.map((r, i) => normalizeBonusInput(r, i, serviceIds));
  } catch (e) {
    if (e instanceof BonusValidationError) throw new StarsError(400, "INVALID_INPUT", e.message);
    throw e;
  }
  if (!list.some((b) => b.active)) throw new StarsError(400, "INVALID_INPUT", "Deja al menos un bono activo.");

  const ready = await bonusTableReady(prisma);
  if (!ready) {
    // Solo el premio de siempre: nombre y costo a las columnas de barber_shops.
    const only = list[0];
    if (list.length > 1 || only.kind !== "service" || only.serviceId) {
      throw new StarsError(
        409,
        "SQL_PENDIENTE",
        "Para crear más bonos falta aplicar sql/barber_estrellas.sql. Mientras, puedes cambiar el nombre y las estrellas del premio actual.",
      );
    }
    const r = await saveBarberClientsConfig(ctx, { loyaltyThreshold: only.cost, loyaltyReward: only.name });
    if (!r.ok) throw new StarsError(409, "SQL_PENDIENTE", "Falta aplicar sql/barber_clientes.sql en la base de datos.");
    return getBonusEditor(ctx);
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "barber_loyalty_rewards" WHERE "barbershopId" = ${barbershopId}
    `;
    const mine = new Set(existing.map((r) => r.id));
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.id && b.id !== LEGACY_BONUS_ID && mine.has(b.id)) {
        await tx.$executeRaw`
          UPDATE "barber_loyalty_rewards"
          SET "name" = ${b.name}::text, "cost" = ${b.cost}::int, "kind" = ${b.kind}::text,
              "serviceId" = ${b.serviceId}::text, "amount" = ${b.amount}::numeric,
              "percent" = ${b.percent}::int, "description" = ${b.description}::text,
              "active" = ${b.active}::boolean, "sortOrder" = ${i}::int, "updatedAt" = NOW()
          WHERE "id" = ${b.id} AND "barbershopId" = ${barbershopId}
        `;
      } else {
        // Nuevo (o el premio de siempre que se vuelve fila): id del servidor.
        await tx.$executeRaw`
          INSERT INTO "barber_loyalty_rewards"
            ("id", "barbershopId", "name", "cost", "kind", "serviceId", "amount", "percent",
             "description", "active", "sortOrder", "createdAt", "updatedAt")
          VALUES (${randomUUID()}::text, ${barbershopId}::text, ${b.name}::text, ${b.cost}::int,
                  ${b.kind}::text, ${b.serviceId}::text, ${b.amount}::numeric, ${b.percent}::int,
                  ${b.description}::text, ${b.active}::boolean, ${i}::int, NOW(), NOW())
        `;
      }
    }
  });

  // Compatibilidad: el más barato activo es «el premio» para lo que todavía
  // lee las columnas de siempre.
  const catalog = await loadBonusCatalog(prisma, barbershopId);
  const cheap = cheapestBonus(catalog.bonuses);
  if (cheap) {
    await saveBarberClientsConfig(ctx, { loyaltyThreshold: cheap.cost, loyaltyReward: cheap.name });
  }
  return getBonusEditor(ctx);
}

// ── Respuesta de error común de las rutas ──────────────────────────────

export function starsErrorBody(e: unknown): { status: number; body: { error: string; code: string } } | null {
  if (e instanceof StarsError) return { status: e.status, body: { error: e.message, code: e.code } };
  return null;
}

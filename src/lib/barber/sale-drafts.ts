import "server-only";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { assertBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { BarberCajaError, D, money, sumMoney, toNum } from "@/lib/barber/commissions";
import { parseDiscountPct } from "@/lib/barber/cash";
import {
  SaleDraftInputError,
  normalizeSaleDraftPayload,
  saleDraftsReady,
  type SaleDraftPayload,
} from "@/lib/barber/sale-drafts-core";
import { clientsViewScope, scopeClientsWhere, scopeUserFromCtx } from "@/lib/barber/own-visits";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — notas «Por cobrar» (servidor, con sesión).
 *
 * La nota es un BORRADOR del ticket: no tiene importes, no entra al corte,
 * ni a ingresos, ni a comisiones, ni a estrellas. Se cobra con el MISMO
 * createSale de Caja (que la marca COBRADA en su transacción) y se descarta
 * sin borrarla.
 *
 *   · ver: cash.view · guardar, editar, descartar: cash.manage
 *   · todo por la barbería/sede de la sesión; el cliente pasa el mismo
 *     recorte que en Caja (rol Barbero con caja por permiso: solo suyos).
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface SaleDraftLineView {
  kind: "service" | "product";
  id: string;
  name: string;
  qty: number;
  /** Precio de HOY en el catálogo (estimado: al cobrar manda el catálogo). */
  unitPrice: number;
  /** El servicio o producto ya no está activo (al cobrar habrá que quitarlo). */
  unavailable: boolean;
}

export interface SaleDraftRow {
  id: string;
  clientId: string | null;
  clientName: string | null;
  barberId: string | null;
  barberName: string | null;
  payload: SaleDraftPayload;
  lines: SaleDraftLineView[];
  /** Estimado con los precios de hoy, ya con el descuento. */
  estimate: number;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
}

export interface SaleDraftList {
  /** false = falta sql/barber_por_cobrar.sql. */
  ready: boolean;
  drafts: SaleDraftRow[];
  /**
   * Cuántas notas abiertas hay en el alcance (la lista se recorta a las 50 más recientes;
   * esto no). Lo usa el aviso del cierre de turno.
   */
  openCount: number;
}

interface DraftRaw {
  id: string;
  clientId: string | null;
  barberId: string | null;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
}

const LIST_MAX = 50;

function inputError(e: unknown): never {
  if (e instanceof SaleDraftInputError) throw new BarberCajaError(400, "INVALID_INPUT", e.message);
  throw e;
}

/** Notas abiertas de la sede (de un cliente, si se pide), más recientes primero. */
export async function listSaleDrafts(ctx: BarberContext, opts: { clientId?: string | null } = {}): Promise<SaleDraftList> {
  assertBarberPermission(ctx, "cash.view");
  if (!(await saleDraftsReady(prisma))) return { ready: false, drafts: [], openCount: 0 };
  const barbershopId = ctx.barbershopId;
  const clientId = typeof opts.clientId === "string" && opts.clientId ? opts.clientId : null;
  const rows = clientId
    ? await prisma.$queryRaw<DraftRaw[]>`
        SELECT "id", "clientId", "barberId", "payload", "createdAt", "updatedAt", "createdByUserId"
        FROM "barber_sale_drafts"
        WHERE "barbershopId" = ${barbershopId} AND "status" = 'OPEN' AND "clientId" = ${clientId}
        ORDER BY "createdAt" DESC LIMIT ${LIST_MAX}`
    : await prisma.$queryRaw<DraftRaw[]>`
        SELECT "id", "clientId", "barberId", "payload", "createdAt", "updatedAt", "createdByUserId"
        FROM "barber_sale_drafts"
        WHERE "barbershopId" = ${barbershopId} AND "status" = 'OPEN'
        ORDER BY "createdAt" DESC LIMIT ${LIST_MAX}`;
  if (rows.length === 0) return { ready: true, drafts: [], openCount: 0 };

  // Rol Barbero con caja por permiso personal: solo notas de clientes suyos.
  const scope = scopeClientsWhere(clientsViewScope(scopeUserFromCtx(ctx)));
  const clientIds = Array.from(new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x)));
  const payloads = rows.map((r) => safePayload(r.payload));
  const serviceIds = new Set<string>();
  const productIds = new Set<string>();
  for (const p of payloads) for (const it of p.items) (it.kind === "service" ? serviceIds : productIds).add(it.id);
  const barberIds = Array.from(new Set(rows.map((r) => r.barberId).filter((x): x is string => !!x)));

  const [clients, services, products, barbers, users] = await Promise.all([
    clientIds.length
      ? prisma.barberClient.findMany({
          where: { id: { in: clientIds }, barbershopId, ...(scope ? { AND: [scope as object] } : {}) },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    serviceIds.size
      ? prisma.barberService.findMany({ where: { id: { in: [...serviceIds] }, barbershopId }, select: { id: true, name: true, price: true, isActive: true } })
      : Promise.resolve([]),
    productIds.size
      ? prisma.barberProduct.findMany({ where: { id: { in: [...productIds] }, barbershopId }, select: { id: true, name: true, price: true, isActive: true } })
      : Promise.resolve([]),
    barberIds.length
      ? prisma.barber.findMany({ where: { id: { in: barberIds }, barbershopId }, select: { id: true, name: true, nickname: true } })
      : Promise.resolve([]),
    prisma.barberUser.findMany({
      where: { id: { in: Array.from(new Set(rows.map((r) => r.createdByUserId))) }, barbershopId },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const clientById = new Map(clients.map((c) => [c.id, c.name]));
  const serviceById = new Map(services.map((x) => [x.id, x]));
  const productById = new Map(products.map((x) => [x.id, x]));
  const barberById = new Map(barbers.map((b) => [b.id, b.nickname || b.name]));
  const userById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  const drafts: SaleDraftRow[] = [];
  rows.forEach((r, i) => {
    // Recortado por alcance: una nota de un cliente que no le toca no sale.
    if (scope && (!r.clientId || !clientById.has(r.clientId))) return;
    const p = payloads[i];
    const lines: SaleDraftLineView[] = p.items.map((it) => {
      const cat = it.kind === "service" ? serviceById.get(it.id) : productById.get(it.id);
      return {
        kind: it.kind,
        id: it.id,
        name: cat?.name ?? "—",
        qty: it.qty,
        unitPrice: cat ? toNum(cat.price) : 0,
        unavailable: !cat || !cat.isActive,
      };
    });
    const gross = sumMoney(lines.filter((l) => !l.unavailable).map((l) => D(l.unitPrice).times(l.qty)));
    const off = p.discountPct ? money(gross.times(p.discountPct).dividedBy(100)) : D(p.discount ?? 0);
    drafts.push({
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientId ? clientById.get(r.clientId) ?? null : null,
      barberId: r.barberId,
      barberName: r.barberId ? barberById.get(r.barberId) ?? null : null,
      payload: p,
      lines,
      estimate: toNum(money(gross.minus(off).isNegative() ? D(0) : gross.minus(off))),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      createdByName: userById.get(r.createdByUserId) ?? "—",
    });
  });
  // Con recorte del Barbero cuenta lo que ve; sin recorte, el total exacto.
  const openCount = scope || rows.length < LIST_MAX ? drafts.length : await countOpenDrafts(barbershopId, clientId);
  return { ready: true, drafts, openCount };
}

async function countOpenDrafts(barbershopId: string, clientId: string | null): Promise<number> {
  const rows = clientId
    ? await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS "n" FROM "barber_sale_drafts" WHERE "barbershopId" = ${barbershopId} AND "status" = 'OPEN' AND "clientId" = ${clientId}`
    : await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS "n" FROM "barber_sale_drafts" WHERE "barbershopId" = ${barbershopId} AND "status" = 'OPEN'`;
  return Number(rows[0]?.n ?? 0);
}

function safePayload(raw: unknown): SaleDraftPayload {
  try {
    return normalizeSaleDraftPayload(raw);
  } catch {
    return { items: [], barberId: null, discount: null, discountPct: null, notes: null };
  }
}

/**
 * Guarda una nota nueva o edita una ABIERTA. Valida que el cliente, los
 * servicios, los productos y el barbero sean de ESTA sede.
 */
export async function saveSaleDraft(
  ctx: BarberContext,
  input: { id?: unknown; clientId?: unknown; payload?: unknown },
): Promise<{ id: string }> {
  assertBarberPermission(ctx, "cash.manage");
  if (!(await saleDraftsReady(prisma))) {
    throw new BarberCajaError(409, "DRAFTS_SQL_PENDING", "Falta aplicar sql/barber_por_cobrar.sql");
  }
  const barbershopId = ctx.barbershopId;
  let payload: SaleDraftPayload;
  try {
    payload = normalizeSaleDraftPayload(input.payload);
    if (payload.discountPct) parseDiscountPct(payload.discountPct);
  } catch (e) {
    inputError(e);
  }

  const clientId = typeof input.clientId === "string" && input.clientId ? input.clientId : null;
  if (clientId) {
    const scope = scopeClientsWhere(clientsViewScope(scopeUserFromCtx(ctx)));
    const ok = await prisma.barberClient.count({
      where: { id: clientId, barbershopId, blockedAt: null, ...(scope ? { AND: [scope as object] } : {}) },
    });
    if (!ok) throw new BarberCajaError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
  }
  if (payload.barberId) {
    const ok = await prisma.barber.count({ where: { id: payload.barberId, barbershopId, isActive: true } });
    if (!ok) throw new BarberCajaError(404, "BARBER_NOT_FOUND", "Barbero no encontrado");
  }
  const serviceIds = [...new Set(payload.items.filter((i) => i.kind === "service").map((i) => i.id))];
  const productIds = [...new Set(payload.items.filter((i) => i.kind === "product").map((i) => i.id))];
  const [svc, prod] = await Promise.all([
    serviceIds.length ? prisma.barberService.count({ where: { id: { in: serviceIds }, barbershopId, isActive: true } }) : 0,
    productIds.length ? prisma.barberProduct.count({ where: { id: { in: productIds }, barbershopId, isActive: true } }) : 0,
  ]);
  if (svc !== serviceIds.length || prod !== productIds.length) {
    throw new BarberCajaError(404, "ITEM_NOT_FOUND", "Algún servicio o producto ya no está en el catálogo");
  }

  const json = JSON.stringify(payload);
  const id = typeof input.id === "string" && input.id ? input.id : null;
  if (id) {
    const n = await prisma.$executeRaw`
      UPDATE "barber_sale_drafts"
      SET "payload" = ${json}::jsonb, "clientId" = ${clientId}::text, "barberId" = ${payload.barberId}::text,
          "updatedByUserId" = ${ctx.barberUserId}, "updatedAt" = NOW()
      WHERE "id" = ${id} AND "barbershopId" = ${barbershopId} AND "status" = 'OPEN'`;
    if (n !== 1) throw new BarberCajaError(409, "DRAFT_NOT_OPEN", "Esa nota ya se cobró o se descartó");
    return { id };
  }
  const newId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "barber_sale_drafts"
      ("id", "barbershopId", "clientId", "barberId", "payload", "status", "createdByUserId", "createdAt", "updatedAt")
    VALUES (${newId}, ${barbershopId}, ${clientId}::text, ${payload.barberId}::text, ${json}::jsonb, 'OPEN',
            ${ctx.barberUserId}, NOW(), NOW())`;
  return { id: newId };
}

/** Descarta una nota abierta (no se borra: queda DISCARDED con quién y cuándo). */
export async function discardSaleDraft(ctx: BarberContext, id: unknown): Promise<void> {
  assertBarberPermission(ctx, "cash.manage");
  if (!(await saleDraftsReady(prisma))) {
    throw new BarberCajaError(409, "DRAFTS_SQL_PENDING", "Falta aplicar sql/barber_por_cobrar.sql");
  }
  if (typeof id !== "string" || !id || id.length > 64) throw new BarberCajaError(404, "DRAFT_NOT_FOUND", "Nota no encontrada");
  const n = await prisma.$executeRaw`
    UPDATE "barber_sale_drafts"
    SET "status" = 'DISCARDED', "closedAt" = NOW(), "closedByUserId" = ${ctx.barberUserId}, "updatedAt" = NOW()
    WHERE "id" = ${id} AND "barbershopId" = ${ctx.barbershopId} AND "status" = 'OPEN'`;
  if (n !== 1) throw new BarberCajaError(409, "DRAFT_NOT_OPEN", "Esa nota ya se cobró o se descartó");
}

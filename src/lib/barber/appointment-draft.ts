import "server-only";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { BarberCajaError, isSaleCancelled, toNum } from "@/lib/barber/commissions";
import { lockAppointmentTx } from "@/lib/barber/cash";
import { saleDraftsReady, type SaleDraftLine, type SaleDraftPayload } from "@/lib/barber/sale-drafts-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — PRODUCTOS AL COBRO desde la cita (cita «B», ws6-t5).
 *
 * «Agregar producto» en la cita guarda la cera o la pomada en la nota «Por
 * cobrar» LIGADA A ESA CITA (la misma tabla barber_sale_drafts, con
 * payload.appointmentId). No es un ticket:
 *   · no toca existencias (se descuentan al cobrar, en createSale),
 *   · ni el corte, ni ingresos, ni comisiones, ni estrellas.
 * Al «Completar y cobrar», el ticket de la cita trae esos productos y la nota
 * queda COBRADA en la misma transacción (createSale + markSaleDraftChargedTx,
 * que exige que el ticket sea de ESA cita). Cancelar el ticket la reabre.
 *
 * Una sola nota abierta por cita: todo va bajo el candado de la fila de la
 * cita (el mismo que usa el cobro). Quitar el último producto la descarta
 * (nunca se borra).
 *
 * Sin «server-only» en las piezas puras; aquí sí, porque usa prisma.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const APPOINTMENT_DRAFT_MAX_QTY = 99;

export interface AppointmentDraftItem {
  productId: string;
  name: string;
  qty: number;
  /** Precio de HOY del catálogo (al cobrar manda el catálogo). */
  unitPrice: number;
  /** Existencias de hoy (avisa; no aparta nada). */
  stock: number;
  /** Ya no está activo en el catálogo. */
  unavailable: boolean;
}

export interface AppointmentDraftView {
  /** false = falta sql/barber_por_cobrar.sql. */
  ready: boolean;
  draftId: string | null;
  items: AppointmentDraftItem[];
}

interface DraftRow {
  id: string;
  payload: unknown;
}

function asPayload(raw: unknown): SaleDraftPayload {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((it) => (it && typeof it === "object" ? (it as Record<string, unknown>) : {}))
    .filter((o) => (o.kind === "product" || o.kind === "service") && typeof o.id === "string")
    .map((o) => ({ kind: o.kind as "service" | "product", id: o.id as string, qty: Math.max(1, Math.floor(Number(o.qty) || 1)) }));
  return {
    items,
    barberId: typeof r.barberId === "string" ? r.barberId : null,
    discount: null,
    discountPct: null,
    notes: null,
    appointmentId: typeof r.appointmentId === "string" ? r.appointmentId : null,
  };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function openDraftOfTx(tx: Tx | typeof prisma, barbershopId: string, appointmentId: string, lock: boolean): Promise<DraftRow | null> {
  const rows = lock
    ? await tx.$queryRaw<DraftRow[]>`
        SELECT "id", "payload" FROM "barber_sale_drafts"
        WHERE "barbershopId" = ${barbershopId} AND "status" = 'OPEN' AND ("payload"->>'appointmentId') = ${appointmentId}
        ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE`
    : await tx.$queryRaw<DraftRow[]>`
        SELECT "id", "payload" FROM "barber_sale_drafts"
        WHERE "barbershopId" = ${barbershopId} AND "status" = 'OPEN' AND ("payload"->>'appointmentId') = ${appointmentId}
        ORDER BY "createdAt" ASC LIMIT 1`;
  return rows[0] ?? null;
}

/** La nota de la cita con nombres, precios y existencias de hoy. */
export async function getAppointmentDraft(barbershopId: string, appointmentId: string): Promise<AppointmentDraftView> {
  if (!(await saleDraftsReady(prisma))) return { ready: false, draftId: null, items: [] };
  const row = await openDraftOfTx(prisma, barbershopId, appointmentId, false);
  if (!row) return { ready: true, draftId: null, items: [] };
  const lines = asPayload(row.payload).items.filter((i) => i.kind === "product");
  const products = lines.length
    ? await prisma.barberProduct.findMany({
        where: { barbershopId, id: { in: lines.map((l) => l.id) } },
        select: { id: true, name: true, price: true, stock: true, isActive: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  return {
    ready: true,
    draftId: row.id,
    items: lines.map((l) => {
      const p = byId.get(l.id);
      return {
        productId: l.id,
        name: p?.name ?? "—",
        qty: l.qty,
        unitPrice: p ? toNum(p.price) : 0,
        stock: p?.stock ?? 0,
        unavailable: !p || !p.isActive,
      };
    }),
  };
}

/** La cita: de esta sede, abierta y sin cobrar. Bajo el candado de su fila. */
async function lockOpenAppointmentTx(tx: Tx, barbershopId: string, appointmentId: string) {
  if (!(await lockAppointmentTx(tx, barbershopId, appointmentId))) {
    throw new BarberCajaError(404, "APPOINTMENT_NOT_FOUND", "Esa visita no existe.");
  }
  const appt = await tx.barberAppointment.findFirst({
    where: { id: appointmentId, barbershopId },
    select: { id: true, status: true, clientId: true, barberId: true, sales: { select: { notes: true } } },
  });
  if (!appt) throw new BarberCajaError(404, "APPOINTMENT_NOT_FOUND", "Esa visita no existe.");
  if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") {
    throw new BarberCajaError(409, "APPOINTMENT_CLOSED", "Esa visita está cancelada o el cliente no llegó.");
  }
  if (appt.sales.some((s) => !isSaleCancelled(s))) {
    throw new BarberCajaError(409, "ALREADY_CHARGED", "Esa visita ya se cobró: agrega el producto en Caja.");
  }
  return appt;
}

function requireReady(ready: boolean) {
  if (!ready) throw new BarberCajaError(409, "DRAFTS_SQL_PENDING", "Falta aplicar sql/barber_por_cobrar.sql");
}

/**
 * Agrega `qty` de un producto a la nota de la cita (la crea si no hay). Si ya
 * estaba, suma (tope 99). No aparta existencias.
 */
export async function addAppointmentDraftItem(args: {
  barbershopId: string;
  appointmentId: string;
  userId: string;
  productId: unknown;
  qty: unknown;
}): Promise<AppointmentDraftView> {
  requireReady(await saleDraftsReady(prisma));
  const productId = typeof args.productId === "string" && args.productId.length <= 64 ? args.productId : "";
  const qty = args.qty === undefined || args.qty === null ? 1 : Number(args.qty);
  if (!productId) throw new BarberCajaError(400, "INVALID_INPUT", "Elige un producto.");
  if (!Number.isInteger(qty) || qty < 1 || qty > APPOINTMENT_DRAFT_MAX_QTY) {
    throw new BarberCajaError(400, "INVALID_INPUT", `La cantidad va de 1 a ${APPOINTMENT_DRAFT_MAX_QTY}.`);
  }
  const { barbershopId, appointmentId } = args;

  await prisma.$transaction(
    async (tx) => {
      const appt = await lockOpenAppointmentTx(tx, barbershopId, appointmentId);
      const product = await tx.barberProduct.findFirst({
        where: { id: productId, barbershopId, isActive: true },
        select: { id: true },
      });
      if (!product) throw new BarberCajaError(404, "PRODUCT_NOT_FOUND", "Ese producto no está en el catálogo.");

      const draft = await openDraftOfTx(tx, barbershopId, appointmentId, true);
      const payload = draft ? asPayload(draft.payload) : asPayload({ appointmentId, barberId: appt.barberId, items: [] });
      const existing = payload.items.find((i) => i.kind === "product" && i.id === productId);
      if (existing) existing.qty = Math.min(APPOINTMENT_DRAFT_MAX_QTY, existing.qty + qty);
      else payload.items.push({ kind: "product", id: productId, qty });
      payload.appointmentId = appointmentId;
      const json = JSON.stringify(payload);

      if (draft) {
        await tx.$executeRaw`
          UPDATE "barber_sale_drafts" SET "payload" = ${json}::jsonb, "updatedByUserId" = ${args.userId}, "updatedAt" = NOW()
          WHERE "id" = ${draft.id} AND "barbershopId" = ${barbershopId} AND "status" = 'OPEN'`;
      } else {
        await tx.$executeRaw`
          INSERT INTO "barber_sale_drafts"
            ("id", "barbershopId", "clientId", "barberId", "payload", "status", "createdByUserId", "createdAt", "updatedAt")
          VALUES (${randomUUID()}, ${barbershopId}, ${appt.clientId}::text, ${appt.barberId}::text, ${json}::jsonb, 'OPEN',
                  ${args.userId}, NOW(), NOW())`;
      }
    },
    { maxWait: 5000, timeout: 15000 },
  );
  return getAppointmentDraft(barbershopId, appointmentId);
}

/** Quita un producto de la nota de la cita. Sin productos, la nota se descarta. */
export async function removeAppointmentDraftItem(args: {
  barbershopId: string;
  appointmentId: string;
  userId: string;
  productId: unknown;
}): Promise<AppointmentDraftView> {
  requireReady(await saleDraftsReady(prisma));
  const productId = typeof args.productId === "string" ? args.productId : "";
  const { barbershopId, appointmentId } = args;
  await prisma.$transaction(
    async (tx) => {
      await lockOpenAppointmentTx(tx, barbershopId, appointmentId);
      const draft = await openDraftOfTx(tx, barbershopId, appointmentId, true);
      if (!draft) throw new BarberCajaError(404, "DRAFT_ITEM_NOT_FOUND", "Ese producto no está en el cobro de la visita.");
      const payload = asPayload(draft.payload);
      const before = payload.items.length;
      payload.items = payload.items.filter((i) => !(i.kind === "product" && i.id === productId));
      if (payload.items.length === before) {
        throw new BarberCajaError(404, "DRAFT_ITEM_NOT_FOUND", "Ese producto no está en el cobro de la visita.");
      }
      if (payload.items.length === 0) {
        await tx.$executeRaw`
          UPDATE "barber_sale_drafts"
          SET "status" = 'DISCARDED', "closedAt" = NOW(), "closedByUserId" = ${args.userId}, "updatedAt" = NOW()
          WHERE "id" = ${draft.id} AND "barbershopId" = ${barbershopId} AND "status" = 'OPEN'`;
      } else {
        await tx.$executeRaw`
          UPDATE "barber_sale_drafts" SET "payload" = ${JSON.stringify(payload)}::jsonb,
            "updatedByUserId" = ${args.userId}, "updatedAt" = NOW()
          WHERE "id" = ${draft.id} AND "barbershopId" = ${barbershopId} AND "status" = 'OPEN'`;
      }
    },
    { maxWait: 5000, timeout: 15000 },
  );
  return getAppointmentDraft(barbershopId, appointmentId);
}

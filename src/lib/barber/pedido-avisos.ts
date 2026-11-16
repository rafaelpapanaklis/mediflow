// Sin `import "server-only"` a propósito: settings.ts lo importa y sus pruebas lo cargan en Node pelado.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/seo";
import { assertBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { BarberAdminError } from "@/lib/barber/branches";
import { parseOrderItems } from "@/lib/barber/tienda-core";
import {
  ORDER_NOTICE_DEFAULTS,
  ORDER_NOTICE_PANEL_PATH,
  buildOwnerOrderEmail,
  cleanNoticePhone,
  noticeRecipients,
  type OrderNoticeChannelId,
  type OrderNoticeKind,
  type OrderNoticeOrder,
  type OrderNoticeSettings,
  type OrderNoticeStatus,
} from "@/lib/barber/pedido-avisos-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — AVISOS AL DUEÑO de los pedidos de la tienda (servidor).
 * ws6-t6, 16-nov-2026 («haz el 1, 2, 3 y 4»).
 *
 * CORREO (este archivo): por cada pedido NUEVO y cuando se PAGA en línea.
 *   · A quién: a los usuarios con rol Dueño, activos, de la SEDE del pedido y
 *     de su MATRIZ (si es sucursal), sin repetir y con tope. Si no hay ninguno,
 *     al correo de la barbería (el del registro).
 *   · Con el enviador de siempre (src/lib/email.ts → Resend). Sin
 *     RESEND_API_KEY no sale nada (queda en el log), igual que el resto.
 *   · UNA vez por pedido y motivo: antes de mandar se RECLAMA una fila en
 *     barber_order_notices (INSERT … ON CONFLICT DO NOTHING). Si ya existe —el
 *     webhook de Mercado Pago reintentó, o dos peticiones a la vez— no se
 *     manda otra vez. Un correo que falla NO se reintenta: queda FAILED con el
 *     motivo (preferimos uno de menos a dos iguales).
 *   · NUNCA lanza y nunca bloquea al cliente: el pedido ya está guardado
 *     cuando esto corre (y la ruta lo llama después de responder).
 *   · Interruptor por sede en Configuración → Notificaciones
 *     ("orderNotifyEmail", nace ENCENDIDO).
 *
 * Todo depende de sql/barber_pedidos_avisos.sql. Sin él NO se manda ningún
 * aviso (no habría cómo garantizar «una sola vez») y todo lo demás sigue
 * igual. Por SQL crudo: el cliente Prisma compartido no conoce ni las columnas
 * ni la tabla (no se regenera desde una rama).
 * ═══════════════════════════════════════════════════════════════════════
 */

type QueryDb = Pick<Prisma.TransactionClient, "$queryRaw">;
type RawDb = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

// ── ¿Está pegado el SQL? ────────────────────────────────────────────────

const NOTICE_COLUMNS = ["orderNotifyEmail", "orderNotifyWhatsapp", "orderNotifyPhone"];
// Una vez visto, ya no se vuelve a preguntar en este proceso (nunca se quita solo).
let seenReady = false;

/** Las 3 columnas de barber_shops y la tabla barber_order_notices. Nunca lanza. */
export async function orderNoticesReady(db: QueryDb = prisma): Promise<boolean> {
  if (seenReady) return true;
  try {
    const rows = await db.$queryRaw<Array<{ n: number; t: boolean }>>`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'barber_shops'
            AND column_name IN ('orderNotifyEmail', 'orderNotifyWhatsapp', 'orderNotifyPhone')) AS "n",
        (to_regclass('public.barber_order_notices') IS NOT NULL) AS "t"
    `;
    const ok = Number(rows[0]?.n ?? 0) === NOTICE_COLUMNS.length && rows[0]?.t === true;
    if (ok) seenReady = true;
    return ok;
  } catch {
    return false;
  }
}

/** Solo para las pruebas: olvida lo visto. */
export function resetOrderNoticesReadyCache(): void {
  seenReady = false;
}

// ── Configuración → Notificaciones ──────────────────────────────────────

export interface OrderNoticeSettingsView extends OrderNoticeSettings {
  /** false = falta sql/barber_pedidos_avisos.sql: no se manda nada y no se puede guardar. */
  persisted: boolean;
  /** A qué correos llegaría hoy un aviso de esta sede (para decirlo en pantalla). */
  recipients: string[];
}

/** Los correos de los Dueños activos de la sede y de su matriz + el respaldo. */
async function recipientsFor(db: QueryDb, shopId: string, parentId: string | null, fallback: Array<string | null>): Promise<string[]> {
  const ids = parentId ? [shopId, parentId] : [shopId];
  const owners = await db.$queryRaw<Array<{ email: string }>>`
    SELECT "email" FROM "barber_users"
    WHERE "barbershopId" = ANY(${ids}::text[]) AND "role"::text = 'OWNER' AND "isActive" = true
    ORDER BY ("barbershopId" = ${shopId}) DESC, "createdAt" ASC
    LIMIT 20
  `;
  return noticeRecipients(owners.map((o) => o.email), fallback);
}

export async function getOrderNoticeSettings(ctx: BarberContext): Promise<OrderNoticeSettingsView> {
  const shopId = ctx.barbershopId;
  const base: OrderNoticeSettingsView = { ...ORDER_NOTICE_DEFAULTS, persisted: false, recipients: [] };
  if (!shopId) return base;
  try {
    const recipients = await recipientsFor(prisma, shopId, ctx.barbershop.parentId ?? null, [ctx.barbershop.email ?? null]);
    if (!(await orderNoticesReady(prisma))) return { ...base, recipients };
    const rows = await prisma.$queryRaw<Array<{ e: boolean; w: boolean; p: string | null }>>`
      SELECT "orderNotifyEmail" AS "e", "orderNotifyWhatsapp" AS "w", "orderNotifyPhone" AS "p"
      FROM "barber_shops" WHERE "id" = ${shopId}
    `;
    const r = rows[0];
    if (!r) return { ...base, recipients };
    return { email: r.e === true, whatsapp: r.w === true, phone: cleanNoticePhone(r.p), persisted: true, recipients };
  } catch (e) {
    console.warn("[barber/pedidos] no se pudo leer Notificaciones:", (e as Error).message);
    return base;
  }
}

export interface OrderNoticeSettingsInput {
  email?: unknown;
  whatsapp?: unknown;
  phone?: unknown;
}

/**
 * Guarda lo que llegue (cada campo es opcional). Encender el WhatsApp exige un
 * número de 10 dígitos: sin a dónde mandar, el interruptor no dice la verdad.
 */
export async function saveOrderNoticeSettings(
  ctx: BarberContext,
  input: OrderNoticeSettingsInput,
): Promise<{ ok: boolean; reason?: "sql_pendiente" | "error"; value: OrderNoticeSettings }> {
  assertBarberPermission(ctx, "settings.edit");
  const current = await getOrderNoticeSettings(ctx);
  const actual: OrderNoticeSettings = { email: current.email, whatsapp: current.whatsapp, phone: current.phone };
  if (!current.persisted) return { ok: false, reason: "sql_pendiente", value: actual };

  const next: OrderNoticeSettings = { ...actual };
  if (input.email !== undefined) next.email = input.email === true;
  if (input.whatsapp !== undefined) next.whatsapp = input.whatsapp === true;
  if (input.phone !== undefined) {
    const raw = typeof input.phone === "string" ? input.phone.trim() : "";
    if (!raw) next.phone = null;
    else {
      const clean = cleanNoticePhone(raw);
      if (!clean) throw new BarberAdminError("Escribe el WhatsApp a 10 dígitos (sin lada del país).");
      next.phone = clean;
    }
  }
  if (next.whatsapp && !next.phone) {
    throw new BarberAdminError("Para avisarte por WhatsApp escribe a qué número (10 dígitos).");
  }

  const shopId = ctx.barbershopId;
  try {
    await prisma.$executeRaw`
      UPDATE "barber_shops"
      SET "orderNotifyEmail" = ${next.email}, "orderNotifyWhatsapp" = ${next.whatsapp}, "orderNotifyPhone" = ${next.phone}
      WHERE "id" = ${shopId}
    `;
    return { ok: true, value: next };
  } catch (e) {
    console.warn("[barber/pedidos] no se pudo guardar Notificaciones:", (e as Error).message);
    return { ok: false, reason: "error", value: actual };
  }
}

// ── La base, tras una interfaz (las pruebas usan una de memoria) ────────

/** El pedido con lo que hace falta de su sede para avisar. */
export interface OrderForNotice {
  order: OrderNoticeOrder;
  barbershopId: string;
  parentId: string | null;
  shopName: string;
  branchName: string | null;
  locale: string;
  /** Correos de respaldo: el de la sede y el de la matriz. */
  fallbackEmails: Array<string | null>;
  settings: OrderNoticeSettings;
}

export interface OrderNoticeStore {
  /** ¿Está pegado sql/barber_pedidos_avisos.sql? */
  ready(): Promise<boolean>;
  loadOrder(orderId: string): Promise<OrderForNotice | null>;
  ownerEmails(o: Pick<OrderForNotice, "barbershopId" | "parentId" | "fallbackEmails">): Promise<string[]>;
  /** true = este aviso es MÍO (nadie lo había reclamado). false = ya se avisó o lo está mandando otro. */
  claim(orderId: string, kind: OrderNoticeKind, channel: OrderNoticeChannelId, barbershopId: string): Promise<boolean>;
  finish(orderId: string, kind: OrderNoticeKind, channel: OrderNoticeChannelId, status: OrderNoticeStatus, detail: string | null): Promise<void>;
}

/** La de verdad. `db` se puede cambiar por otro cliente (las pruebas del SQL usan uno propio). */
export function sqlOrderNoticeStore(db: RawDb = prisma): OrderNoticeStore {
  return {
    ready: () => orderNoticesReady(db),
    async loadOrder(orderId) {
      if (!orderId) return null;
      const rows = await db.$queryRaw<
        Array<{
          id: string;
          folio: string;
          client_name: string;
          client_phone: string;
          items: unknown;
          total: unknown;
          pay_method: string;
          paid_at: Date | null;
          barbershop_id: string;
          shop_name: string;
          branch_name: string | null;
          locale: string | null;
          parent_id: string | null;
          shop_email: string | null;
          root_email: string | null;
          notify_email: boolean;
          notify_whatsapp: boolean;
          notify_phone: string | null;
        }>
      >`
        SELECT o."id", o."folio", o."client_name", o."client_phone", o."items", o."total", o."pay_method", o."paid_at",
               o."barbershop_id",
               s."name" AS "shop_name", s."branchName" AS "branch_name", s."locale", s."parentId" AS "parent_id",
               s."email" AS "shop_email", r."email" AS "root_email",
               s."orderNotifyEmail" AS "notify_email", s."orderNotifyWhatsapp" AS "notify_whatsapp",
               s."orderNotifyPhone" AS "notify_phone"
        FROM "barber_product_orders" o
        JOIN "barber_shops" s ON s."id" = o."barbershop_id"
        LEFT JOIN "barber_shops" r ON r."id" = s."parentId"
        WHERE o."id" = ${orderId}
      `;
      const r = rows[0];
      if (!r) return null;
      return {
        order: {
          id: r.id,
          folio: r.folio,
          clientName: r.client_name,
          clientPhone: r.client_phone,
          items: parseOrderItems(r.items).map((it) => ({ name: it.name, qty: it.qty, unitPrice: it.unitPrice })),
          total: Number(r.total),
          payOnline: r.pay_method === "MERCADOPAGO",
          paid: r.paid_at !== null,
        },
        barbershopId: r.barbershop_id,
        parentId: r.parent_id,
        shopName: r.shop_name,
        branchName: r.branch_name,
        locale: r.locale ?? "es",
        fallbackEmails: [r.shop_email, r.root_email],
        settings: { email: r.notify_email === true, whatsapp: r.notify_whatsapp === true, phone: cleanNoticePhone(r.notify_phone) },
      };
    },
    ownerEmails: (o) => recipientsFor(db, o.barbershopId, o.parentId, o.fallbackEmails),
    async claim(orderId, kind, channel, barbershopId) {
      const rows = await db.$queryRaw<Array<{ order_id: string }>>`
        INSERT INTO "barber_order_notices" ("order_id", "kind", "channel", "barbershop_id", "status")
        VALUES (${orderId}, ${kind}, ${channel}, ${barbershopId}, 'SENDING')
        ON CONFLICT ("order_id", "kind", "channel") DO NOTHING
        RETURNING "order_id"
      `;
      return rows.length === 1;
    },
    async finish(orderId, kind, channel, status, detail) {
      await db.$executeRaw`
        UPDATE "barber_order_notices"
        SET "status" = ${status}, "detail" = ${detail ? detail.slice(0, 500) : null}, "updated_at" = now()
        WHERE "order_id" = ${orderId} AND "kind" = ${kind} AND "channel" = ${channel}
      `;
    },
  };
}

// ── Avisar ──────────────────────────────────────────────────────────────

export interface OrderNoticeDeps {
  store: OrderNoticeStore;
  /** El enviador de correo (src/lib/email.ts). En pruebas, un doble: nunca sale un correo real. */
  sendEmail: (p: { to: string; subject: string; html: string; text?: string }) => Promise<{ delivered: boolean }>;
  /** Raíz del sitio para armar la liga «Ver pedido». */
  siteUrl: string;
}

export interface ChannelOutcome {
  channel: OrderNoticeChannelId;
  /** sent = salió · skipped = no tocaba (con el porqué) · failed = se intentó y no salió · duplicate = ya se había avisado. */
  outcome: "sent" | "skipped" | "failed" | "duplicate";
  detail: string | null;
}

export interface OrderNoticeResult {
  /** false = no se intentó nada (sin SQL, pedido inexistente, o un error que se tragó). */
  ran: boolean;
  reason?: "sql_pendiente" | "sin_pedido" | "no_pagado" | "error";
  channels: ChannelOutcome[];
}

function defaults(over?: Partial<OrderNoticeDeps>): OrderNoticeDeps {
  return { store: over?.store ?? sqlOrderNoticeStore(), sendEmail: over?.sendEmail ?? sendEmail, siteUrl: over?.siteUrl ?? SITE_URL };
}

async function emailChannel(kind: OrderNoticeKind, o: OrderForNotice, d: OrderNoticeDeps): Promise<ChannelOutcome | null> {
  if (!o.settings.email) return null; // apagado en Notificaciones: ni se reclama
  if (!(await d.store.claim(o.order.id, kind, "EMAIL", o.barbershopId))) {
    return { channel: "EMAIL", outcome: "duplicate", detail: null };
  }
  let outcome: ChannelOutcome;
  try {
    const to = await d.store.ownerEmails(o);
    if (to.length === 0) {
      outcome = { channel: "EMAIL", outcome: "skipped", detail: "ningún dueño activo con correo" };
    } else {
      const mail = buildOwnerOrderEmail({
        kind,
        order: o.order,
        shopName: o.shopName,
        branchName: o.branchName,
        panelUrl: `${d.siteUrl.replace(/\/+$/, "")}${ORDER_NOTICE_PANEL_PATH}`,
        locale: o.locale,
      });
      let delivered = 0;
      for (const addr of to) {
        try {
          if ((await d.sendEmail({ to: addr, subject: mail.subject, html: mail.html, text: mail.text })).delivered) delivered++;
        } catch (e) {
          console.warn("[barber/pedidos] el correo del aviso falló:", (e as Error)?.message ?? e);
        }
      }
      outcome =
        delivered > 0
          ? { channel: "EMAIL", outcome: "sent", detail: `${delivered} de ${to.length}` }
          : { channel: "EMAIL", outcome: "failed", detail: `0 de ${to.length}: el enviador no lo aceptó (o no hay transporte)` };
    }
  } catch (e) {
    outcome = { channel: "EMAIL", outcome: "failed", detail: (e as Error)?.message ?? "error" };
  }
  const status: OrderNoticeStatus = outcome.outcome === "sent" ? "SENT" : outcome.outcome === "skipped" ? "SKIPPED" : "FAILED";
  await d.store.finish(o.order.id, kind, "EMAIL", status, outcome.detail).catch(() => undefined);
  return outcome;
}

/**
 * Avisa al dueño de un pedido NUEVO o recién PAGADO en línea. Idempotente por
 * (pedido, motivo, canal). NUNCA lanza.
 */
export async function notifyOwnerOfOrder(
  kind: OrderNoticeKind,
  orderId: string,
  over?: Partial<OrderNoticeDeps>,
): Promise<OrderNoticeResult> {
  try {
    const d = defaults(over);
    if (!(await d.store.ready())) return { ran: false, reason: "sql_pendiente", channels: [] };
    const o = await d.store.loadOrder(orderId);
    if (!o) return { ran: false, reason: "sin_pedido", channels: [] };
    // «Pagado» solo se avisa de un pedido que de verdad tiene fecha de pago.
    if (kind === "PAID" && !o.order.paid) return { ran: false, reason: "no_pagado", channels: [] };

    const channels: ChannelOutcome[] = [];
    const mail = await emailChannel(kind, o, d);
    if (mail) channels.push(mail);
    return { ran: true, channels };
  } catch (e) {
    console.warn(`[barber/pedidos] aviso al dueño (${kind} ${orderId}) no salió:`, (e as Error)?.message ?? e);
    return { ran: false, reason: "error", channels: [] };
  }
}

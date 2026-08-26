import "server-only";
/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — CAMPAÑAS, REACTIVACIÓN Y RESEÑAS.

   Una inmobiliaria tiene cientos de prospectos que preguntaron una vez y se
   enfriaron. La base de datos ya los tiene; lo que no existía era la forma
   de volver a hablarles sin convertirse en spam.

   🔴 LAS TRES PUERTAS QUE NADIE PUEDE SALTARSE (y por qué existen):
     1. CONSENTIMIENTO. Antes de armar la lista se releen los mensajes
        entrantes y se materializan las bajas (syncRealtyOptOutsFromInbound);
        antes de CADA envío se vuelve a preguntar. Falla cerrado.
     2. TOPE DIARIO por cuenta. Lo que tumba un número de WhatsApp no es
        mandar mucho en un mes: es mandar mucho en una tarde.
     3. DESCANSO entre campañas al mismo teléfono. Tres campañas en una
        semana es exactamente lo que hace que alguien reporte el número.
   Y el número es DEL CLIENTE: si Meta lo suspende, el que se queda sin
   WhatsApp es él, no DaleControl.

   🔴 NO SE TOCA EL TRANSPORTE. Todo sale por `sendRealtyWhatsApp`
   (src/lib/realty/whatsapp.ts), que es el único camino a Meta del vertical
   y el que cobra el cupo, decide plantilla vs texto libre y registra en el
   hilo. Este módulo NO conoce a Meta.
   ═══════════════════════════════════════════════════════════════════════ */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import type { RealtyContext } from "@/lib/realty-auth";
import {
  formatRealtyWaPrice,
  isRealtyWaSendOk,
  realtyWaTemplate,
} from "@/lib/realty/whatsapp-core";
import { isMissingRealtyGrowthTable } from "@/lib/realty/bot/core";
import {
  countRealtyCampaignSentToday,
  getRealtyGrowthSettings,
  growthDayInTz,
  lastRealtyCampaignSentAt,
  newGrowthId,
  realtyGrowthStorageReady,
  realtyOptedOutPhones,
  isRealtyOptedOut,
  syncRealtyOptOutsFromInbound,
} from "@/lib/realty/bot/growth-db";
import {
  REALTY_CAMPAIGN_BATCH_MAX,
  REALTY_CAMPAIGN_COOLDOWN_DAYS,
  REALTY_OPT_OUT_LINE,
  hasRealtyOptOutLine,
  type RealtyCampaignDTO,
  type RealtyCampaignKind,
  type RealtyCampaignRecipientDTO,
  type RealtyCampaignSegment,
  type RealtyCampaignStatus,
  type RealtyRecipientSkipReason,
} from "@/components/realty/growth/growth-shared";

export class RealtyCampaignError extends Error {
  readonly code: "NOT_FOUND" | "INVALID" | "STORAGE" | "STATE";
  constructor(code: "NOT_FOUND" | "INVALID" | "STORAGE" | "STATE", message: string) {
    super(message);
    this.name = "RealtyCampaignError";
    this.code = code;
  }
}

/**
 * Status HTTP de cada código de error. Vive aquí y no en una ruta porque un
 * archivo `route.ts` de Next solo puede exportar los verbos y su config:
 * cualquier otro export tumba la comprobación de tipos del router.
 *
 * STORAGE es 503 y no 500 a propósito: no es un fallo, es "todavía no está
 * aplicado el .sql" — un estado del que se sale corriendo un archivo.
 */
export function campaignErrorStatus(code: RealtyCampaignError["code"]): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "STORAGE":
      return 503;
    case "STATE":
      return 409;
    default:
      return 400;
  }
}

function assertStorage(ready: boolean): void {
  if (!ready) {
    throw new RealtyCampaignError(
      "STORAGE",
      "Falta aplicar sql/realty_growth.sql en la base. Escríbenos a soporte.",
    );
  }
}

function toNumber(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ═══════════════════════════════════════════════════════════════════════
   1. SEGMENTACIÓN — de quién se arma la lista
   ═══════════════════════════════════════════════════════════════════════ */

export interface RealtyAudienceRow {
  contactId: string | null;
  name: string;
  phone: string;
  /** Inmueble con el que se relaciona (para las variables de la plantilla). */
  propertyId: string | null;
  propertyTitle: string | null;
  propertyZone: string | null;
  propertyPrice: string | null;
  propertyLink: string | null;
}

export interface RealtyAudienceResult {
  eligible: RealtyAudienceRow[];
  skipped: { row: RealtyAudienceRow; reason: RealtyRecipientSkipReason }[];
}

function publicZone(p: { colonia: string | null; city: string | null; state: string | null }): string {
  return [p.colonia, p.city, p.state].filter(Boolean).join(", ");
}

function propertyLink(slug: string, p: { id: string; publicUrlSlug: string | null; isPublished: boolean }): string | null {
  if (!p.isPublished) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/i/${slug}/${p.publicUrlSlug || p.id}`;
}

/**
 * Arma la lista. NO manda nada: separa a quién SÍ y a quién NO, con el
 * motivo. Enseñar "no se le mandó a 12 personas porque pidieron baja" es lo
 * que hace que alguien confíe en el botón de enviar.
 */
export async function buildRealtyAudience(args: {
  accountId: string;
  slug: string;
  timezone: string;
  kind: RealtyCampaignKind;
  segment: RealtyCampaignSegment;
}): Promise<RealtyAudienceResult> {
  const { accountId, segment } = args;

  // 1. Materializar las bajas que llegaron por WhatsApp ANTES de mirar a
  //    nadie. Si esto falla, sigue: `realtyOptedOutPhones` falla cerrado.
  await syncRealtyOptOutsFromInbound(accountId).catch(() => 0);

  const rows: RealtyAudienceRow[] = [];

  if (args.kind === "BAJADA_PRECIO" && segment.visitedPropertyId) {
    rows.push(...(await audienceFromVisitors(accountId, args.slug, segment.visitedPropertyId)));
  } else if (args.kind === "RESENA") {
    rows.push(...(await audienceFromClosedDeals(accountId, segment.closedWithinDays ?? 60)));
  } else {
    rows.push(...(await audienceFromLeads(accountId, args.slug, segment)));
  }

  // Recorte a mano: si vienen contactIds, RECORTAN. Nunca amplían — la
  // lista del cliente no puede meter a alguien que el criterio excluyó.
  const picked = segment.contactIds && segment.contactIds.length > 0
    ? new Set(segment.contactIds)
    : null;

  const eligible: RealtyAudienceRow[] = [];
  const skipped: { row: RealtyAudienceRow; reason: RealtyRecipientSkipReason }[] = [];
  const seenPhones = new Set<string>();

  const candidates = picked ? rows.filter((r) => r.contactId && picked.has(r.contactId)) : rows;
  const phones = candidates.map((r) => r.phone).filter(Boolean);
  const optedOut = await realtyOptedOutPhones(accountId, phones);
  const lastSent = await lastRealtyCampaignSentAt(accountId, phones);
  const cooldownFloor = Date.now() - REALTY_CAMPAIGN_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

  for (const row of candidates) {
    const phone = mxTenDigits(row.phone);
    if (!phone) {
      skipped.push({ row, reason: "sinTelefono" });
      continue;
    }
    if (seenPhones.has(phone)) {
      skipped.push({ row, reason: "duplicado" });
      continue;
    }
    seenPhones.add(phone);
    if (optedOut.has(phone)) {
      skipped.push({ row: { ...row, phone }, reason: "optOut" });
      continue;
    }
    const last = lastSent.get(phone);
    if (last && last.getTime() > cooldownFloor) {
      skipped.push({ row: { ...row, phone }, reason: "duplicado" });
      continue;
    }
    eligible.push({ ...row, phone });
  }

  return { eligible, skipped };
}

/** Prospectos fríos / filtrados del CRM. */
async function audienceFromLeads(
  accountId: string,
  slug: string,
  segment: RealtyCampaignSegment,
): Promise<RealtyAudienceRow[]> {
  const colderThan = Number(segment.colderThanDays);
  const before =
    Number.isFinite(colderThan) && colderThan > 0
      ? new Date(Date.now() - colderThan * 24 * 60 * 60 * 1000)
      : null;

  const leads = await prisma.realtyLead.findMany({
    where: {
      accountId,
      // Un cierre no se reactiva y un perdido tampoco: volver a escribirle
      // a quien ya compró (o a quien dijo que no) es la definición de spam.
      stage:
        segment.stages && segment.stages.length > 0
          ? { in: segment.stages }
          : { notIn: ["CIERRE", "PERDIDO"] },
      ...(before ? { updatedAt: { lt: before } } : {}),
      ...(segment.creditKind ? { creditKind: segment.creditKind } : {}),
      ...(Number.isFinite(Number(segment.budgetMin)) && Number(segment.budgetMin) > 0
        ? { budgetMax: { gte: Number(segment.budgetMin) } }
        : {}),
      ...(Number.isFinite(Number(segment.budgetMax)) && Number(segment.budgetMax) > 0
        ? { budgetMin: { lte: Number(segment.budgetMax) } }
        : {}),
      contact: { phone: { not: null } },
    },
    orderBy: { updatedAt: "asc" },
    take: 600,
    select: {
      id: true,
      contactId: true,
      contact: { select: { id: true, name: true, phone: true } },
      property: {
        select: {
          id: true,
          title: true,
          colonia: true,
          city: true,
          state: true,
          price: true,
          rentPrice: true,
          currency: true,
          isPublished: true,
          publicUrlSlug: true,
        },
      },
    },
  });

  const zones = (segment.zones ?? []).map((z) => z.toLowerCase().trim()).filter(Boolean);
  let profileByContact = new Map<string, { zones: string[] }>();
  if (zones.length > 0) {
    const profiles = await prisma.realtySearchProfile.findMany({
      where: { accountId, contactId: { in: leads.map((l) => l.contactId) } },
      select: { contactId: true, zones: true },
    });
    profileByContact = new Map(profiles.map((p) => [p.contactId, { zones: p.zones ?? [] }]));
  }

  const out: RealtyAudienceRow[] = [];
  for (const lead of leads) {
    if (!lead.contact?.phone) continue;
    if (zones.length > 0) {
      const mine = (profileByContact.get(lead.contactId)?.zones ?? []).map((z) =>
        z.toLowerCase().trim(),
      );
      if (!mine.some((z) => zones.includes(z))) continue;
    }
    const p = lead.property;
    out.push({
      contactId: lead.contactId,
      name: lead.contact.name,
      phone: lead.contact.phone,
      propertyId: p?.id ?? null,
      propertyTitle: p?.title ?? null,
      propertyZone: p ? publicZone(p) : null,
      propertyPrice: p
        ? formatRealtyWaPrice(
            Number(p.rentPrice ?? p.price ?? 0) || Number(p.price ?? 0),
            p.currency,
          )
        : null,
      propertyLink: p ? propertyLink(slug, p) : null,
    });
  }
  return out;
}

/** Quien VISITÓ ese inmueble. Es la lista de "bajó de precio la casa que viste". */
async function audienceFromVisitors(
  accountId: string,
  slug: string,
  propertyId: string,
): Promise<RealtyAudienceRow[]> {
  const property = await prisma.realtyProperty.findFirst({
    where: { id: propertyId, accountId },
    select: {
      id: true,
      title: true,
      colonia: true,
      city: true,
      state: true,
      price: true,
      rentPrice: true,
      currency: true,
      isPublished: true,
      publicUrlSlug: true,
    },
  });
  if (!property) return [];

  const visits = await prisma.realtyVisit.findMany({
    where: {
      accountId,
      propertyId,
      // Quien la vio de verdad o iba a verla. Un NO_ASISTIO también cuenta:
      // le interesaba lo suficiente para agendar.
      status: { in: ["REALIZADA", "CONFIRMADA", "PROGRAMADA", "NO_ASISTIO"] },
      lead: { is: { contact: { phone: { not: null } } } },
    },
    orderBy: { scheduledAt: "desc" },
    take: 300,
    select: {
      lead: { select: { contactId: true, contact: { select: { name: true, phone: true } } } },
    },
  });

  const zona = publicZone(property);
  const precio = formatRealtyWaPrice(
    Number(property.rentPrice ?? property.price ?? 0) || Number(property.price ?? 0),
    property.currency,
  );
  const liga = propertyLink(slug, property);

  const out: RealtyAudienceRow[] = [];
  for (const v of visits) {
    const c = v.lead?.contact;
    if (!c?.phone || !v.lead?.contactId) continue;
    out.push({
      contactId: v.lead.contactId,
      name: c.name,
      phone: c.phone,
      propertyId: property.id,
      propertyTitle: property.title,
      propertyZone: zona,
      propertyPrice: precio,
      propertyLink: liga,
    });
  }
  return out;
}

/** Operaciones cerradas recientes — a quién se le pide la reseña. */
async function audienceFromClosedDeals(
  accountId: string,
  withinDays: number,
): Promise<RealtyAudienceRow[]> {
  const days = Math.min(365, Math.max(1, Math.floor(withinDays || 60)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deals = await prisma.realtyDeal.findMany({
    where: {
      accountId,
      status: "CERRADO",
      updatedAt: { gte: since },
      contact: { is: { phone: { not: null } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      contactId: true,
      contact: { select: { name: true, phone: true } },
      property: { select: { id: true, title: true } },
    },
  });
  const out: RealtyAudienceRow[] = [];
  for (const d of deals) {
    if (!d.contact?.phone || !d.contactId) continue;
    out.push({
      contactId: d.contactId,
      name: d.contact.name,
      phone: d.contact.phone,
      propertyId: d.property?.id ?? null,
      propertyTitle: d.property?.title ?? null,
      propertyZone: null,
      propertyPrice: null,
      propertyLink: null,
    });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   2. CRUD de campañas
   ═══════════════════════════════════════════════════════════════════════ */

export interface CreateRealtyCampaignInput {
  name: string;
  kind: RealtyCampaignKind;
  body: string;
  segment: RealtyCampaignSegment;
  propertyId?: string | null;
  scheduledAt?: Date | null;
}

/**
 * La plantilla con la que sale una campaña cuando la ventana de 24 h está
 * cerrada — que es SIEMPRE en una reactivación, por definición.
 *
 * 🔴 SE REUSA `matchAlert`, la única plantilla MARKETING que el vertical ya
 * tiene aprobada en Meta, y sus cinco variables encajan exactamente con lo
 * que dice una reactivación (nombre, inmueble, zona, precio, liga). Dar de
 * alta una plantilla nueva no es escribir código: es un trámite de días en
 * cada WABA de cada cliente, y hasta que Meta la aprueba la campaña no sale.
 * Cuando exista una plantilla propia de reseña, se cambia AQUÍ y nada más.
 *
 * RESENA no tiene plantilla que le quede: pedir una reseña no es avisar de
 * un inmueble, y mandarlo con `matchAlert` sería mentirle a Meta sobre para
 * qué se usa la plantilla. Sale SOLO dentro de la ventana de 24 h; a quien
 * la tenga cerrada se le marca `ventanaCerrada` y el panel lo explica.
 */
function templateForKind(kind: RealtyCampaignKind): string | null {
  switch (kind) {
    case "BAJADA_PRECIO":
    case "REACTIVACION":
    case "MANUAL":
      return "matchAlert";
    case "RESENA":
      return null;
  }
}

export async function createRealtyCampaign(
  ctx: RealtyContext,
  input: CreateRealtyCampaignInput,
): Promise<string> {
  assertStorage(await realtyGrowthStorageReady());
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (name.length < 3) throw new RealtyCampaignError("INVALID", "Ponle un nombre a la campaña.");

  let body = String(input.body ?? "").trim().slice(0, 900);
  if (body.length < 10) throw new RealtyCampaignError("INVALID", "Escribe el mensaje.");
  // 🔴 La salida SIEMPRE va. Si quien la escribió no la puso, se pone sola.
  if (!hasRealtyOptOutLine(body)) body = `${body}\n\n${REALTY_OPT_OUT_LINE}`;

  const audience = await buildRealtyAudience({
    accountId: ctx.accountId,
    slug: ctx.account.slug,
    timezone: ctx.account.timezone,
    kind: input.kind,
    segment: input.segment ?? {},
  });

  const campaignId = newGrowthId();
  const templateKind = templateForKind(input.kind);

  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO realty_campaigns
                 (id,"accountId",name,kind,status,"templateKind",body,"propertyId",segment,
                  "scheduledAt","createdById","createdAt","updatedAt")
               VALUES (${campaignId}, ${ctx.accountId}, ${name}, ${input.kind},
                       ${input.scheduledAt ? "PROGRAMADA" : "BORRADOR"}, ${templateKind}, ${body},
                       ${input.propertyId ?? null}, ${JSON.stringify(input.segment ?? {})}::jsonb,
                       ${input.scheduledAt ?? null}, ${ctx.realtyUserId},
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );

  await insertRecipients(ctx.accountId, campaignId, audience);
  return campaignId;
}

async function insertRecipients(
  accountId: string,
  campaignId: string,
  audience: RealtyAudienceResult,
): Promise<void> {
  const all = [
    ...audience.eligible.map((row) => ({ row, status: "PENDIENTE", reason: null as string | null })),
    ...audience.skipped.map((s) => ({ row: s.row, status: "OMITIDO", reason: s.reason })),
  ];
  for (const item of all) {
    const phone = mxTenDigits(item.row.phone) ?? item.row.phone;
    if (!phone) continue;
    const params = {
      nombre: item.row.name,
      inmueble: item.row.propertyTitle,
      zona: item.row.propertyZone,
      precio: item.row.propertyPrice,
      liga: item.row.propertyLink,
    };
    try {
      await prisma.$executeRaw(
        Prisma.sql`INSERT INTO realty_campaign_recipients
                     (id,"campaignId","accountId","contactId",phone,name,params,status,"skipReason","createdAt")
                   VALUES (${newGrowthId()}, ${campaignId}, ${accountId}, ${item.row.contactId},
                           ${phone}, ${item.row.name}, ${JSON.stringify(params)}::jsonb,
                           ${item.status}, ${item.reason}, CURRENT_TIMESTAMP)
                   ON CONFLICT ("campaignId", phone) DO NOTHING`,
      );
    } catch (err) {
      if (!isMissingRealtyGrowthTable(err)) {
        console.error("[realty/campaigns] no se pudo guardar un destinatario:", err);
      }
    }
  }
}

export async function listRealtyCampaigns(
  accountId: string,
  limit = 50,
): Promise<RealtyCampaignDTO[]> {
  try {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        name: string;
        kind: string;
        status: string;
        templateKind: string | null;
        body: string | null;
        propertyId: string | null;
        propertyTitle: string | null;
        segment: unknown;
        scheduledAt: Date | null;
        startedAt: Date | null;
        finishedAt: Date | null;
        createdAt: Date;
        total: bigint;
        pendiente: bigint;
        enviado: bigint;
        fallido: bigint;
        omitido: bigint;
      }[]
    >(
      Prisma.sql`SELECT c.id, c.name, c.kind, c.status, c."templateKind", c.body, c."propertyId",
                        p.title AS "propertyTitle", c.segment, c."scheduledAt", c."startedAt",
                        c."finishedAt", c."createdAt",
                        count(r.id) AS total,
                        count(r.id) FILTER (WHERE r.status = 'PENDIENTE') AS pendiente,
                        count(r.id) FILTER (WHERE r.status = 'ENVIADO')   AS enviado,
                        count(r.id) FILTER (WHERE r.status = 'FALLIDO')   AS fallido,
                        count(r.id) FILTER (WHERE r.status = 'OMITIDO')   AS omitido
                 FROM realty_campaigns c
                 LEFT JOIN realty_campaign_recipients r ON r."campaignId" = c.id
                 LEFT JOIN realty_properties p ON p.id = c."propertyId"
                 WHERE c."accountId" = ${accountId}
                 GROUP BY c.id, p.title
                 ORDER BY c."createdAt" DESC
                 LIMIT ${Math.min(200, Math.max(1, limit))}`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as RealtyCampaignKind,
      status: r.status as RealtyCampaignStatus,
      templateKind: r.templateKind,
      body: r.body,
      propertyId: r.propertyId,
      propertyTitle: r.propertyTitle,
      segment: (r.segment ?? {}) as RealtyCampaignSegment,
      scheduledAt: toIso(r.scheduledAt),
      startedAt: toIso(r.startedAt),
      finishedAt: toIso(r.finishedAt),
      createdAt: toIso(r.createdAt) ?? new Date().toISOString(),
      counts: {
        total: toNumber(r.total),
        pendiente: toNumber(r.pendiente),
        enviado: toNumber(r.enviado),
        fallido: toNumber(r.fallido),
        omitido: toNumber(r.omitido),
      },
    }));
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/campaigns] no se pudieron listar:", err);
    }
    return [];
  }
}

export async function listRealtyCampaignRecipients(
  accountId: string,
  campaignId: string,
  limit = 300,
): Promise<RealtyCampaignRecipientDTO[]> {
  try {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        contactId: string | null;
        name: string | null;
        phone: string;
        status: string;
        skipReason: string | null;
        error: string | null;
        sentAt: Date | null;
      }[]
    >(
      Prisma.sql`SELECT id, "contactId", name, phone, status, "skipReason", error, "sentAt"
                 FROM realty_campaign_recipients
                 WHERE "accountId" = ${accountId} AND "campaignId" = ${campaignId}
                 ORDER BY status, name
                 LIMIT ${Math.min(1000, Math.max(1, limit))}`,
    );
    return rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      name: r.name,
      phone: r.phone,
      status: r.status as RealtyCampaignRecipientDTO["status"],
      skipReason: r.skipReason as RealtyRecipientSkipReason | null,
      error: r.error,
      sentAt: toIso(r.sentAt),
    }));
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/campaigns] no se pudieron listar los destinatarios:", err);
    }
    return [];
  }
}

export async function cancelRealtyCampaign(accountId: string, campaignId: string): Promise<boolean> {
  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE realty_campaigns
               SET status = 'CANCELADA', "finishedAt" = CURRENT_TIMESTAMP,
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = ${campaignId} AND "accountId" = ${accountId}
                 AND status IN ('BORRADOR','PROGRAMADA','ENVIANDO')`,
  );
  return toNumber(n) > 0;
}

/* ═══════════════════════════════════════════════════════════════════════
   3. EL ENVÍO
   ═══════════════════════════════════════════════════════════════════════ */

export interface RealtySendResult {
  sent: number;
  failed: number;
  skipped: number;
  remainingPending: number;
  /** Por qué se detuvo antes de terminar. null = terminó la tanda. */
  stoppedBy: "topeDiario" | "cupoPlan" | "tanda" | null;
}

/**
 * Manda una TANDA. Devuelve cuántos quedan para que el panel (o el barrido)
 * vuelva a llamar. Es reentrante: correrlo dos veces NO manda dos veces al
 * mismo teléfono, porque cada fila pasa de PENDIENTE a ENVIADO.
 *
 * El ORDEN de las comprobaciones es el que importa:
 *   1. tope diario de la cuenta   ← lo primero, es lo que protege el número
 *   2. baja del destinatario      ← se vuelve a preguntar, fila por fila
 *   3. sendRealtyWhatsApp         ← él comprueba cupo del plan y ventana
 */
export async function sendRealtyCampaignBatch(args: {
  accountId: string;
  slug: string;
  timezone: string;
  campaignId: string;
  limit?: number;
  now?: Date;
}): Promise<RealtySendResult> {
  assertStorage(await realtyGrowthStorageReady());
  const now = args.now ?? new Date();
  const limit = Math.min(REALTY_CAMPAIGN_BATCH_MAX, Math.max(1, Math.floor(args.limit ?? 30)));
  const out: RealtySendResult = {
    sent: 0,
    failed: 0,
    skipped: 0,
    remainingPending: 0,
    stoppedBy: null,
  };

  const campaigns = await prisma.$queryRaw<
    { id: string; kind: string; body: string | null; templateKind: string | null; status: string }[]
  >(
    Prisma.sql`SELECT id, kind, body, "templateKind", status FROM realty_campaigns
               WHERE id = ${args.campaignId} AND "accountId" = ${args.accountId} LIMIT 1`,
  );
  const campaign = campaigns?.[0];
  if (!campaign) throw new RealtyCampaignError("NOT_FOUND", "Esa campaña no existe.");
  if (campaign.status === "CANCELADA" || campaign.status === "ENVIADA") {
    throw new RealtyCampaignError("STATE", "Esa campaña ya terminó.");
  }

  // ── 1. TOPE DIARIO ──
  const settings = await getRealtyGrowthSettings(args.accountId);
  const day = growthDayInTz(now, args.timezone);
  const sentToday = await countRealtyCampaignSentToday(args.accountId, day, args.timezone);
  let budget = settings.campaignDailyCap - sentToday;
  if (!Number.isFinite(budget) || budget <= 0) {
    out.stoppedBy = "topeDiario";
    out.remainingPending = await countPending(args.accountId, args.campaignId);
    return out;
  }

  await prisma.$executeRaw(
    Prisma.sql`UPDATE realty_campaigns
               SET status = 'ENVIANDO',
                   "startedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP),
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = ${args.campaignId} AND "accountId" = ${args.accountId}`,
  );

  const pending = await prisma.$queryRaw<
    { id: string; contactId: string | null; phone: string; name: string | null; params: unknown }[]
  >(
    Prisma.sql`SELECT id, "contactId", phone, name, params
               FROM realty_campaign_recipients
               WHERE "campaignId" = ${args.campaignId} AND "accountId" = ${args.accountId}
                 AND status = 'PENDIENTE'
               ORDER BY "createdAt"
               LIMIT ${limit}`,
  );

  const { sendRealtyWhatsApp } = await import("@/lib/realty/whatsapp");

  for (const row of pending) {
    if (budget <= 0) {
      out.stoppedBy = "topeDiario";
      break;
    }

    // ── 2. LA BAJA, OTRA VEZ. Entre armar la lista y mandar pudieron pasar
    //    días, y en esos días la persona pudo escribir BAJA.
    if (await isRealtyOptedOut(args.accountId, row.phone, "MARKETING")) {
      await markRecipient(args.accountId, row.id, "OMITIDO", { skipReason: "optOut" });
      out.skipped += 1;
      continue;
    }

    const p = (row.params ?? {}) as Record<string, string | null>;
    const body = renderCampaignBody(campaign.body ?? "", { ...p, nombre: p.nombre ?? row.name });

    // Parámetros de la plantilla, EN ORDEN y sin vacíos: Meta rechaza una
    // variable vacía y el intento se gasta igual.
    let params: string[] | null = null;
    let kind: string | null = campaign.templateKind;
    if (kind) {
      const tpl = realtyWaTemplate(kind as never);
      const candidate = [
        firstWord(p.nombre ?? row.name ?? ""),
        p.inmueble ?? "",
        p.zona ?? "",
        p.precio ?? "",
        p.liga ?? "",
      ];
      if (candidate.length !== tpl.variables.length || candidate.some((v) => !v.trim())) {
        // Sin datos para la plantilla no se puede escribir fuera de la
        // ventana. Se intenta igual (si la ventana está abierta sale como
        // texto) y si no, sendRealtyWhatsApp devuelve reason "window".
        kind = null;
      } else {
        params = candidate;
      }
    }

    const res = await sendRealtyWhatsApp({
      accountId: args.accountId,
      phone: row.phone,
      body,
      kind: kind as never,
      params,
      contactId: row.contactId,
      claimKey: `camp:${args.campaignId}:${row.id}`,
    });

    if (isRealtyWaSendOk(res)) {
      await markRecipient(args.accountId, row.id, "ENVIADO", { sent: true });
      out.sent += 1;
      budget -= 1;
    } else {
      const reason = (res as { reason?: string }).reason;
      const error = (res as { error?: string }).error ?? "No se pudo enviar";
      if (reason === "quota") {
        out.stoppedBy = "cupoPlan";
        break;
      }
      if (reason === "window") {
        await markRecipient(args.accountId, row.id, "OMITIDO", { skipReason: "ventanaCerrada" });
        out.skipped += 1;
        continue;
      }
      await markRecipient(args.accountId, row.id, "FALLIDO", { error });
      out.failed += 1;
    }
  }

  out.remainingPending = await countPending(args.accountId, args.campaignId);
  if (out.remainingPending === 0 && !out.stoppedBy) {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE realty_campaigns
                 SET status = 'ENVIADA', "finishedAt" = CURRENT_TIMESTAMP,
                     "updatedAt" = CURRENT_TIMESTAMP
                 WHERE id = ${args.campaignId} AND "accountId" = ${args.accountId}`,
    );
  } else if (out.remainingPending > 0 && !out.stoppedBy) {
    out.stoppedBy = "tanda";
  }
  return out;
}

function firstWord(name: string): string {
  const w = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return w || "Hola";
}

/** Sustituye {nombre} {inmueble} {zona} {precio} {liga} en el cuerpo. */
export function renderCampaignBody(
  body: string,
  vars: Record<string, string | null | undefined>,
): string {
  return String(body ?? "").replace(/\{(nombre|inmueble|zona|precio|liga)\}/g, (_m, key) => {
    const v = vars[key];
    if (key === "nombre") return firstWord(String(v ?? ""));
    return v ? String(v) : "";
  });
}

async function markRecipient(
  accountId: string,
  recipientId: string,
  status: "ENVIADO" | "FALLIDO" | "OMITIDO",
  extra: { skipReason?: string; error?: string; sent?: boolean },
): Promise<void> {
  try {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE realty_campaign_recipients
                 SET status = ${status},
                     "skipReason" = ${extra.skipReason ?? null},
                     error = ${extra.error ?? null},
                     "sentAt" = ${extra.sent ? new Date() : null}
                 WHERE id = ${recipientId} AND "accountId" = ${accountId}`,
    );
  } catch (err) {
    console.error("[realty/campaigns] no se pudo marcar el destinatario:", err);
  }
}

async function countPending(accountId: string, campaignId: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS n FROM realty_campaign_recipients
                 WHERE "accountId" = ${accountId} AND "campaignId" = ${campaignId}
                   AND status = 'PENDIENTE'`,
    );
    return toNumber(rows?.[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   4. BAJADA DE PRECIO — la reactivación que sale sola
   ═══════════════════════════════════════════════════════════════════════ */

export interface RealtyPriceDropResult {
  watched: number;
  drops: number;
  campaigns: string[];
}

/**
 * Compara el precio de HOY contra el último precio visto y, si BAJÓ, arma
 * la campaña para quien visitó ese inmueble.
 *
 * 🔴 POR QUÉ HAY UNA TABLA DE VIGILANCIA: `realty_properties.price` se PISA
 * al editarlo — el vertical no guarda histórico de precio y
 * `prisma/schema.prisma` está fuera de la allowlist de esta ola. Así que la
 * vigilancia lleva su propia foto (`realty_property_price_watch`). La
 * PRIMERA corrida solo toma la foto: sin precio anterior no hay bajada, y
 * fabricar una habría mandado un WhatsApp a media cartera el día del
 * estreno.
 */
export async function detectRealtyPriceDrops(args: {
  accountId: string;
  slug: string;
  timezone: string;
}): Promise<RealtyPriceDropResult> {
  const out: RealtyPriceDropResult = { watched: 0, drops: 0, campaigns: [] };
  if (!(await realtyGrowthStorageReady())) return out;

  const settings = await getRealtyGrowthSettings(args.accountId);
  if (!settings.priceDropEnabled) return out;

  const properties = await prisma.realtyProperty.findMany({
    where: { accountId: args.accountId, status: "DISPONIBLE" },
    select: {
      id: true,
      title: true,
      operation: true,
      price: true,
      rentPrice: true,
      currency: true,
    },
    take: 500,
  });

  const watch = await prisma.$queryRaw<
    { propertyId: string; lastPrice: unknown; operation: string }[]
  >(
    Prisma.sql`SELECT "propertyId", "lastPrice", operation
               FROM realty_property_price_watch WHERE "accountId" = ${args.accountId}`,
  );
  const previous = new Map(watch.map((w) => [w.propertyId, toNumber(w.lastPrice)]));

  for (const p of properties) {
    const operation = p.operation === "RENTA" ? "RENTA" : "VENTA";
    const current =
      operation === "RENTA" ? Number(p.rentPrice ?? p.price ?? 0) : Number(p.price ?? 0);
    if (!Number.isFinite(current) || current <= 0) continue;
    out.watched += 1;

    const before = previous.get(p.id);
    const dropped = before !== undefined && before > 0 && current < before;

    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO realty_property_price_watch
                   ("propertyId","accountId","lastPrice",currency,operation,"lastDropAt","lastDropFrom","checkedAt")
                 VALUES (${p.id}, ${args.accountId}, ${current}, ${p.currency}, ${operation},
                         ${dropped ? new Date() : null}, ${dropped ? before : null}, CURRENT_TIMESTAMP)
                 ON CONFLICT ("propertyId") DO UPDATE SET
                   "lastPrice" = EXCLUDED."lastPrice",
                   currency = EXCLUDED.currency,
                   operation = EXCLUDED.operation,
                   "lastDropAt" = COALESCE(EXCLUDED."lastDropAt", realty_property_price_watch."lastDropAt"),
                   "lastDropFrom" = COALESCE(EXCLUDED."lastDropFrom", realty_property_price_watch."lastDropFrom"),
                   "checkedAt" = CURRENT_TIMESTAMP`,
    );

    if (!dropped) continue;
    out.drops += 1;

    const audience = await buildRealtyAudience({
      accountId: args.accountId,
      slug: args.slug,
      timezone: args.timezone,
      kind: "BAJADA_PRECIO",
      segment: { visitedPropertyId: p.id },
    });
    if (audience.eligible.length === 0) continue;

    const antes = formatRealtyWaPrice(before ?? 0, p.currency);
    const ahora = formatRealtyWaPrice(current, p.currency);
    const body =
      `Hola {nombre}, ¿te acuerdas de {inmueble}? Bajó de precio: de ${antes} a ${ahora}. ` +
      `Si te sigue interesando, dime y te agendo una visita.\n\n${REALTY_OPT_OUT_LINE}`;

    const campaignId = newGrowthId();
    try {
      // El único parcial de la tabla evita que tres ajustes de precio en una
      // semana sean tres WhatsApps a la misma persona: si ya hay una campaña
      // viva de bajada para ese inmueble, esto choca y NO se crea otra.
      await prisma.$executeRaw(
        Prisma.sql`INSERT INTO realty_campaigns
                     (id,"accountId",name,kind,status,"templateKind",body,"propertyId",segment,
                      "createdAt","updatedAt")
                   VALUES (${campaignId}, ${args.accountId},
                           ${`Bajó de precio: ${p.title}`.slice(0, 120)}, 'BAJADA_PRECIO',
                           'BORRADOR', ${templateForKind("BAJADA_PRECIO")}, ${body}, ${p.id},
                           ${JSON.stringify({ visitedPropertyId: p.id })}::jsonb,
                           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      );
    } catch (err) {
      // Choque con el único parcial = ya hay una campaña viva. No es error.
      continue;
    }
    await insertRecipients(args.accountId, campaignId, audience);
    out.campaigns.push(campaignId);
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   5. RESEÑAS EN GOOGLE
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Después de una operación cerrada, pedir la reseña con la liga DIRECTA al
 * perfil de Google del cliente. Es el mismo cuello de autoridad del dental:
 * sin reseñas nuevas, el mapa deja de enseñarte.
 *
 * La liga se valida contra una lista blanca de dominios de Google
 * (isRealtyGoogleReviewUrl) antes de guardarse — no aquí, en la ruta: una
 * liga ajena la manda la inmobiliaria desde SU número.
 */
export async function createRealtyReviewCampaign(
  ctx: RealtyContext,
  opts: { withinDays?: number; name?: string } = {},
): Promise<string> {
  const settings = await getRealtyGrowthSettings(ctx.accountId);
  if (!settings.googleReviewUrl) {
    throw new RealtyCampaignError(
      "INVALID",
      "Primero pega la liga de tu perfil de Google en Configuración de crecimiento.",
    );
  }
  const body =
    `Hola {nombre}, gracias por confiar en ${ctx.account.name}. ` +
    `Si te sirvió lo que hicimos, ¿nos dejas una reseña? Toma menos de un minuto: ` +
    `${settings.googleReviewUrl}\n\n${REALTY_OPT_OUT_LINE}`;

  return createRealtyCampaign(ctx, {
    name: (opts.name ?? "Reseñas en Google").slice(0, 120),
    kind: "RESENA",
    body,
    segment: { closedWithinDays: opts.withinDays ?? 60 },
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   5. EL BARRIDO — lo que hace que "programada" signifique algo
   ═══════════════════════════════════════════════════════════════════════ */

export interface RealtyCampaignSweepResult {
  campaigns: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Campañas que quedaron a medias y se retoman en la siguiente vuelta. */
  pending: number;
}

/**
 * Manda lo que YA le tocaba salir.
 *
 * 🔴 POR QUÉ EXISTE: sin esto, `scheduledAt` es decoración. Una campaña se
 * podía dejar PROGRAMADA para el martes a las 10 y nadie la mandaba nunca
 * — la peor clase de error, porque la pantalla dice que está programada y
 * el dueño se entera semanas después de que su promoción no salió.
 *
 * Toma SOLO las que ya vencieron (`scheduledAt <= ahora`) y las que se
 * quedaron a medias (ENVIANDO). Las de estado BORRADOR NO entran: un
 * borrador sin fecha es algo que alguien está escribiendo, y mandarlo
 * porque pasó un cron sería exactamente el "se envió sola" que el diseño
 * de esta ola evita.
 *
 * Manda UNA TANDA por campaña y por vuelta, no la campaña entera: el tope
 * diario y el cupo del plan los sigue aplicando `sendRealtyCampaignBatch`
 * fila por fila, y repartir en varias vueltas es justo lo que protege el
 * número. Lo que quede vuelve en la siguiente.
 *
 * Es reentrante: dos vueltas seguidas no mandan dos veces a la misma
 * persona, porque cada fila pasa de PENDIENTE a ENVIADO dentro del
 * recorrido.
 */
export async function sweepRealtyCampaigns(
  accountId?: string,
  opts: { limit?: number; batch?: number; now?: Date } = {},
): Promise<RealtyCampaignSweepResult> {
  const out: RealtyCampaignSweepResult = {
    campaigns: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
  };
  if (!(await realtyGrowthStorageReady())) return out;

  const now = opts.now ?? new Date();
  const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 20)));
  const batch = Math.min(REALTY_CAMPAIGN_BATCH_MAX, Math.max(1, Math.floor(opts.batch ?? 30)));

  let rows: { id: string; accountId: string; slug: string; timezone: string }[] = [];
  try {
    // El slug y la zona salen de la CUENTA de cada campaña, no de un
    // contexto de sesión: en el camino del cron no hay sesión ninguna.
    rows = await prisma.$queryRaw<{ id: string; accountId: string; slug: string; timezone: string }[]>(
      Prisma.sql`SELECT c.id, c."accountId", a.slug, a.timezone
                 FROM realty_campaigns c
                 JOIN realty_accounts a ON a.id = c."accountId"
                 WHERE a."isActive" = true
                   AND (
                     (c.status = 'PROGRAMADA' AND c."scheduledAt" IS NOT NULL
                       AND c."scheduledAt" <= ${now})
                     OR c.status = 'ENVIANDO'
                   )
                   ${accountId ? Prisma.sql`AND c."accountId" = ${accountId}` : Prisma.empty}
                 ORDER BY c."scheduledAt" NULLS LAST
                 LIMIT ${limit}`,
    );
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/campaigns] barrido: no se pudieron listar las programadas:", err);
    }
    return out;
  }

  for (const row of rows) {
    out.campaigns += 1;
    try {
      const res = await sendRealtyCampaignBatch({
        accountId: row.accountId,
        slug: row.slug,
        timezone: row.timezone || "America/Mexico_City",
        campaignId: row.id,
        limit: batch,
        now,
      });
      out.sent += res.sent;
      out.failed += res.failed;
      out.skipped += res.skipped;
      out.pending += res.remainingPending;
    } catch (err) {
      // Una campaña que truena NO puede detener el barrido de las demás:
      // son de cuentas distintas y no tienen por qué pagar el error ajena.
      if (!(err instanceof RealtyCampaignError)) {
        console.error(`[realty/campaigns] barrido: falló la campaña ${row.id}:`, err);
      }
    }
  }

  return out;
}

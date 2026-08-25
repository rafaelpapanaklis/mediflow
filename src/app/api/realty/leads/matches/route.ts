import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkLeadsAccess,
  findSeekersForProperty,
  getLeadRoutingConfig,
  logLeadActivity,
} from "@/lib/realty/leads";
import { notifyLeadByWhatsapp } from "@/lib/realty/inbound-mail";

export const dynamic = "force-dynamic";

/**
 * GET /api/realty/leads/matches?propertyId=… — ⭐ LA DIRECCIÓN INVERSA:
 * entra un inmueble a la cartera y esto contesta "12 prospectos buscan
 * esto", con el puntaje de cada uno.
 *
 * Vive bajo /leads (y no bajo /properties) porque quien manda aquí es el
 * embudo: la cartera es de otra terminal y esta ruta es la que ella
 * consume para pintar el aviso en la ficha del inmueble.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.view");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "Falta el inmueble" }, { status: 400 });
  }
  const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 25;

  const config = await getLeadRoutingConfig(ctx.accountId);
  const result = await findSeekersForProperty(
    ctx.accountId,
    propertyId,
    {
      role: ctx.role,
      realtyUserId: ctx.realtyUserId,
      permissionsOverride: ctx.user.permissionsOverride,
    },
    { tolerancePct: config.matchTolerancePct, limit },
  );
  if (!result) return NextResponse.json({ error: "Inmueble no encontrado" }, { status: 404 });

  return NextResponse.json({
    property: result.property,
    matches: result.matches,
    total: result.matches.length,
    tolerancePct: config.matchTolerancePct,
  });
}

const NotifySchema = z.object({
  propertyId: z.string().min(1).max(40),
  /** A quién avisarle. Vacío = a todos los que hicieron match y aceptan. */
  leadIds: z.array(z.string().max(40)).max(200).optional(),
});

/**
 * POST — "avísales de este inmueble".
 *
 * 🔴 RESPETA notifyByWhatsapp del perfil de búsqueda: a quien no lo activó
 * NO se le manda nada, aunque haya hecho match perfecto. El envío real lo
 * hace T6 (ver el stub tipado en src/lib/realty/inbound-mail.ts); hoy esto
 * devuelve honestamente cuántos QUEDARON LISTOS y cuántos se saltaron, y no
 * finge que salió un mensaje.
 */
export async function POST(req: Request) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.edit");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = NotifySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const config = await getLeadRoutingConfig(ctx.accountId);
  const result = await findSeekersForProperty(
    ctx.accountId,
    parsed.data.propertyId,
    {
      role: ctx.role,
      realtyUserId: ctx.realtyUserId,
      permissionsOverride: ctx.user.permissionsOverride,
    },
    { tolerancePct: config.matchTolerancePct },
  );
  if (!result) return NextResponse.json({ error: "Inmueble no encontrado" }, { status: 404 });

  const only = parsed.data.leadIds?.length ? new Set(parsed.data.leadIds) : null;
  const targets = result.matches.filter(
    (m) => m.seeker.leadId && (!only || only.has(m.seeker.leadId)),
  );

  let sent = 0;
  let optOut = 0;
  let pending = 0;
  const skipped: { leadId: string; reason: string }[] = [];

  for (const m of targets) {
    const leadId = m.seeker.leadId as string;
    if (!m.seeker.notifyByWhatsapp) {
      optOut += 1;
      skipped.push({ leadId, reason: "OPT_OUT" });
      continue;
    }
    const contact = await prisma.realtyContact.findFirst({
      where: { id: m.seeker.contactId, accountId: ctx.accountId },
      select: { phone: true, name: true },
    });
    const res = await notifyLeadByWhatsapp({
      accountId: ctx.accountId,
      leadId,
      contactId: m.seeker.contactId,
      phone: contact?.phone ?? null,
      contactName: contact?.name ?? m.seeker.name,
      source: "match",
      propertyId: result.property.id,
      propertyTitle: result.property.title,
      reason: "MATCH_NUEVA_PROPIEDAD",
      assignedUserId: null,
      assignedUserName: null,
    });
    if (res.sent) {
      sent += 1;
      await logLeadActivity(
        ctx.accountId,
        leadId,
        "WHATSAPP",
        `Aviso del inmueble ${result.property.title}`,
        ctx.realtyUserId,
      );
    } else {
      pending += 1;
      skipped.push({ leadId, reason: res.skippedReason ?? "SKIPPED" });
    }
  }

  return NextResponse.json({
    candidates: targets.length,
    sent,
    optOut,
    pending,
    skipped: skipped.slice(0, 50),
    /** true = el emisor de WhatsApp todavía no está conectado (T6). */
    senderMissing: sent === 0 && pending > 0,
  });
}

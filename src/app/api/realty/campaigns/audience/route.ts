// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/campaigns/audience → vista previa de la lista
//
// Devuelve a quién SÍ y a quién NO, con el motivo de cada exclusión. No
// escribe nada.
//
// Existe para que el botón "Enviar" nunca sea un salto de fe: antes de
// mandar, se ve "van 34, se omiten 12 (8 pidieron baja, 4 ya recibieron una
// campaña este mes)". Enseñar el motivo es lo que hace que alguien confíe
// en el tope y en la baja, en vez de sospechar que el sistema no los aplica.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_CAMPAIGNS_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import { buildRealtyAudience } from "@/lib/realty/campaigns";
import { getRealtyGrowthSettings, countRealtyCampaignSentToday, growthDayInTz } from "@/lib/realty/bot/growth-db";
import {
  REALTY_CAMPAIGN_KINDS,
  maskRealtyPhone,
  type RealtyCampaignKind,
  type RealtyCampaignSegment,
} from "@/components/realty/growth/growth-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.view",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;
  const { ctx } = gate;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = REALTY_CAMPAIGN_KINDS.includes(body?.kind as RealtyCampaignKind)
    ? (body?.kind as RealtyCampaignKind)
    : "MANUAL";

  const audience = await buildRealtyAudience({
    accountId: ctx.accountId,
    slug: ctx.account.slug,
    timezone: ctx.account.timezone,
    kind,
    segment: (body?.segment ?? {}) as RealtyCampaignSegment,
  });

  // Cuánto cabe HOY: el tope diario menos lo que ya salió. Es el número que
  // de verdad decide cuántos de los elegibles se van a ir en esta tanda.
  const settings = await getRealtyGrowthSettings(ctx.accountId);
  const sentToday = await countRealtyCampaignSentToday(
    ctx.accountId,
    growthDayInTz(new Date(), ctx.account.timezone),
    ctx.account.timezone,
  );
  const remainingToday = Number.isFinite(sentToday)
    ? Math.max(0, settings.campaignDailyCap - sentToday)
    : 0;

  return NextResponse.json({
    // 🔴 El teléfono sale ENMASCARADO. La vista previa es para contar y
    // revisar, no para exportar la libreta: quien necesite el número
    // completo lo tiene en la ficha del contacto, con su permiso.
    eligible: audience.eligible.map((r) => ({
      contactId: r.contactId,
      name: r.name,
      phone: maskRealtyPhone(r.phone),
      propertyTitle: r.propertyTitle,
    })),
    skipped: audience.skipped.map((s) => ({
      name: s.row.name,
      phone: maskRealtyPhone(s.row.phone),
      reason: s.reason,
    })),
    counts: {
      eligible: audience.eligible.length,
      skipped: audience.skipped.length,
      remainingToday,
      dailyCap: settings.campaignDailyCap,
    },
  });
}

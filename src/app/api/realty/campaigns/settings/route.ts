// ═══════════════════════════════════════════════════════════════════════
// GET   /api/realty/campaigns/settings → ajustes de crecimiento
// PATCH /api/realty/campaigns/settings → guardarlos
// POST  /api/realty/campaigns/settings → crear la campaña de RESEÑAS
//
// Aquí vive la liga de Google. Se valida contra LISTA BLANCA de dominios de
// Google antes de guardarla, y no con un "que empiece con https":
//
// 🔴 Esa liga se le manda a los clientes DESDE EL NÚMERO DE WHATSAPP DE LA
// INMOBILIARIA. Si alguien pega ahí una liga de phishing, el que la abre es
// el cliente y el que la mandó es el número del negocio. Un dominio ajeno
// no es un caso raro: es la forma de convertir el producto en un repartidor
// de estafas.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_CAMPAIGNS_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import {
  getRealtyGrowthSettings,
  realtyGrowthStorageReady,
  saveRealtyGrowthSettings,
} from "@/lib/realty/bot/growth-db";
import {
  RealtyCampaignError,
  campaignErrorStatus,
  createRealtyReviewCampaign,
} from "@/lib/realty/campaigns";
import {
  REALTY_CAMPAIGN_DAILY_CAP_MAX,
  isRealtyGoogleReviewUrl,
} from "@/components/realty/growth/growth-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.view",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const [settings, storageReady] = await Promise.all([
    getRealtyGrowthSettings(gate.ctx.accountId),
    realtyGrowthStorageReady(),
  ]);
  return NextResponse.json({ settings, storageReady });
}

export async function PATCH(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  if (!(await realtyGrowthStorageReady())) {
    return NextResponse.json({ error: "Falta aplicar sql/realty_growth.sql." }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const patch: Parameters<typeof saveRealtyGrowthSettings>[1] = {};

  if (body.googleReviewUrl !== undefined) {
    const raw = String(body.googleReviewUrl ?? "").trim();
    if (!raw) {
      patch.googleReviewUrl = null;
    } else if (!isRealtyGoogleReviewUrl(raw)) {
      return NextResponse.json(
        {
          error:
            "Esa liga no es de Google. Pega la de tu perfil (g.page, maps.app.goo.gl o google.com/maps).",
          field: "googleReviewUrl",
        },
        { status: 400 },
      );
    } else {
      patch.googleReviewUrl = raw;
    }
  }
  if (body.reviewsEnabled !== undefined) patch.reviewsEnabled = body.reviewsEnabled === true;
  if (body.priceDropEnabled !== undefined) patch.priceDropEnabled = body.priceDropEnabled === true;
  if (body.campaignDailyCap !== undefined) {
    const n = Number(body.campaignDailyCap);
    if (!Number.isFinite(n) || n < 0 || n > REALTY_CAMPAIGN_DAILY_CAP_MAX) {
      return NextResponse.json(
        {
          error: `El tope diario va de 0 a ${REALTY_CAMPAIGN_DAILY_CAP_MAX} mensajes.`,
          field: "campaignDailyCap",
        },
        { status: 400 },
      );
    }
    patch.campaignDailyCap = Math.floor(n);
  }

  // Encender reseñas sin liga es encender un botón que no puede hacer nada.
  if (patch.reviewsEnabled === true) {
    const current = await getRealtyGrowthSettings(gate.ctx.accountId);
    const url = patch.googleReviewUrl ?? current.googleReviewUrl;
    if (!url) {
      return NextResponse.json(
        { error: "Pega primero la liga de tu perfil de Google.", field: "googleReviewUrl" },
        { status: 400 },
      );
    }
  }

  const settings = await saveRealtyGrowthSettings(gate.ctx.accountId, patch);
  return NextResponse.json({ settings });
}

/** Arma la campaña de reseñas con las operaciones cerradas recientes. */
export async function POST(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const body = (await req.json().catch(() => null)) as { withinDays?: unknown } | null;
  const raw = Number(body?.withinDays);
  const withinDays = Number.isFinite(raw) && raw > 0 ? Math.min(365, Math.floor(raw)) : 60;

  try {
    const campaignId = await createRealtyReviewCampaign(gate.ctx, { withinDays });
    return NextResponse.json({ ok: true, campaignId }, { status: 201 });
  } catch (err) {
    if (err instanceof RealtyCampaignError) {
      return NextResponse.json({ error: err.message }, { status: campaignErrorStatus(err.code) });
    }
    console.error("[api/realty/campaigns/settings] POST:", err);
    return NextResponse.json({ error: "No se pudo armar la campaña." }, { status: 500 });
  }
}

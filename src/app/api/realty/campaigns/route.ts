// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/campaigns → las campañas de la cuenta
// POST /api/realty/campaigns → crear una
//
// Crear NO manda nada: arma la lista y la deja en BORRADOR (o PROGRAMADA si
// trae fecha). Mandar es otro acto, con su propio botón y su propia ruta.
// Separarlo es lo que evita el "se envió sola" que nadie quiso.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_CAMPAIGNS_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import {
  RealtyCampaignError,
  campaignErrorStatus,
  createRealtyCampaign,
  listRealtyCampaigns,
} from "@/lib/realty/campaigns";
import {
  REALTY_CAMPAIGN_KINDS,
  type RealtyCampaignKind,
  type RealtyCampaignSegment,
} from "@/components/realty/growth/growth-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.view",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const campaigns = await listRealtyCampaigns(gate.ctx.accountId, 50);
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const kind = REALTY_CAMPAIGN_KINDS.includes(body.kind as RealtyCampaignKind)
    ? (body.kind as RealtyCampaignKind)
    : "MANUAL";

  // La fecha se acepta solo hacia ADELANTE: programar en el pasado es
  // "mandar ya" disfrazado, y el barrido lo tomaría en la siguiente vuelta
  // sin que nadie lo haya decidido.
  let scheduledAt: Date | null = null;
  if (typeof body.scheduledAt === "string" && body.scheduledAt.trim()) {
    const d = new Date(body.scheduledAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Esa fecha no se entiende." }, { status: 400 });
    }
    if (d.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "Esa fecha ya pasó." }, { status: 400 });
    }
    scheduledAt = d;
  }

  try {
    const id = await createRealtyCampaign(gate.ctx, {
      name: String(body.name ?? ""),
      kind,
      body: String(body.body ?? ""),
      segment: (body.segment ?? {}) as RealtyCampaignSegment,
      propertyId: typeof body.propertyId === "string" ? body.propertyId : null,
      scheduledAt,
    });
    return NextResponse.json({ ok: true, campaignId: id }, { status: 201 });
  } catch (err) {
    if (err instanceof RealtyCampaignError) {
      return NextResponse.json({ error: err.message }, { status: campaignErrorStatus(err.code) });
    }
    console.error("[api/realty/campaigns] POST:", err);
    return NextResponse.json({ error: "No se pudo crear la campaña." }, { status: 500 });
  }
}

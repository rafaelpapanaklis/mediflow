// ═══════════════════════════════════════════════════════════════════════
// GET    /api/realty/campaigns/[campaignId] → sus destinatarios
// POST   /api/realty/campaigns/[campaignId] → mandar UNA TANDA
// DELETE /api/realty/campaigns/[campaignId] → cancelarla
//
// El envío es por TANDAS y devuelve cuántos quedan. No es una limitación
// técnica: es el diseño. Una cuenta que manda 400 WhatsApps de golpe una
// tarde es una cuenta a la que Meta le restringe el número, y el número es
// del cliente. La tanda respeta el tope diario, vuelve a preguntar por la
// baja fila por fila, y el panel llama otra vez si el dueño quiere seguir.
//
// Es REENTRANTE: llamarlo dos veces no manda dos veces a la misma persona,
// porque cada fila pasa de PENDIENTE a ENVIADO dentro del mismo recorrido.
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
  cancelRealtyCampaign,
  listRealtyCampaignRecipients,
  sendRealtyCampaignBatch,
} from "@/lib/realty/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_req: NextRequest, { params }: { params: { campaignId: string } }) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.view",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const recipients = await listRealtyCampaignRecipients(
    gate.ctx.accountId,
    params.campaignId,
    300,
  );
  return NextResponse.json({ recipients });
}

export async function POST(req: NextRequest, { params }: { params: { campaignId: string } }) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;
  const { ctx } = gate;

  const body = (await req.json().catch(() => null)) as { limit?: unknown } | null;
  const rawLimit = Number(body?.limit);

  try {
    const result = await sendRealtyCampaignBatch({
      accountId: ctx.accountId,
      slug: ctx.account.slug,
      timezone: ctx.account.timezone,
      campaignId: params.campaignId,
      limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 30,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RealtyCampaignError) {
      return NextResponse.json({ error: err.message }, { status: campaignErrorStatus(err.code) });
    }
    console.error("[api/realty/campaigns/:id] POST:", err);
    return NextResponse.json({ error: "No se pudo enviar la tanda." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { campaignId: string } }) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const ok = await cancelRealtyCampaign(gate.ctx.accountId, params.campaignId);
  if (!ok) {
    return NextResponse.json(
      { error: "Esa campaña no existe o ya terminó." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}

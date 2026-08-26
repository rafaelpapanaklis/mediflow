// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/campaigns/price-drops → "bajó de precio la casa que viste"
//
// La reactivación más rentable del vertical, y la única que sale sola:
// compara el precio de hoy contra la última foto y, si BAJÓ, arma una
// campaña para quien VISITÓ ese inmueble. Alguien que ya fue a verla y no
// la compró por el precio es la persona con más probabilidad de volver.
//
// 🔴 LA PRIMERA CORRIDA NO MANDA NADA. Solo toma la foto: sin precio
// anterior no hay bajada, y fabricar una habría disparado un WhatsApp a
// media cartera el día del estreno.
//
// Arma la campaña en BORRADOR — no la manda. Quién y cuándo lo decide una
// persona desde el panel.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_CAMPAIGNS_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import { detectRealtyPriceDrops } from "@/lib/realty/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;
  const { ctx } = gate;

  const result = await detectRealtyPriceDrops({
    accountId: ctx.accountId,
    slug: ctx.account.slug,
    timezone: ctx.account.timezone,
  });

  return NextResponse.json({ ok: true, ...result });
}

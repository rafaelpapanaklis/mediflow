// ═══════════════════════════════════════════════════════════════════════
// GET   /api/realty/affiliates → el panel del socio
// POST  /api/realty/affiliates → darse de alta (genera el código)
// PATCH /api/realty/affiliates → guardar a dónde se le paga
//
// La feature es `affiliates`, que YA existe en plan-shared.ts y hoy solo
// trae el plan INMOBILIARIA. No se inventó una llave nueva: una llave que
// no está en `realty_plan_configs` deja a TODAS las cuentas fuera hasta que
// alguien corra un UPDATE.
//
// El permiso es `billing.manage` (OWNER, no MANAGER): el programa de socios
// es dinero que entra a la cuenta y la CLABE a la que se paga. Un asesor no
// tiene por qué poder cambiar a dónde se manda ese dinero.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_AFFILIATES_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import {
  RealtyAffiliateError,
  ensureRealtyAffiliate,
  getRealtyAffiliateSummary,
  realtyAffiliateLink,
  saveRealtyAffiliatePayoutInfo,
} from "@/lib/realty/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await openRealtyGrowthGate({
    permission: "billing.manage",
    feature: REALTY_AFFILIATES_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const summary = await getRealtyAffiliateSummary(gate.ctx.accountId);
  return NextResponse.json({ summary });
}

export async function POST() {
  const gate = await openRealtyGrowthGate({
    permission: "billing.manage",
    feature: REALTY_AFFILIATES_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  try {
    const affiliate = await ensureRealtyAffiliate(gate.ctx.accountId);
    return NextResponse.json({
      ok: true,
      code: affiliate.code,
      link: realtyAffiliateLink(affiliate.code),
    });
  } catch (err) {
    if (err instanceof RealtyAffiliateError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.code === "STORAGE" ? 503 : 409 },
      );
    }
    console.error("[api/realty/affiliates] POST:", err);
    return NextResponse.json({ error: "No se pudo dar de alta." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "billing.manage",
    feature: REALTY_AFFILIATES_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const body = (await req.json().catch(() => null)) as { payoutInfo?: unknown } | null;
  const payoutInfo = typeof body?.payoutInfo === "string" ? body.payoutInfo : "";

  const ok = await saveRealtyAffiliatePayoutInfo(gate.ctx.accountId, payoutInfo);
  if (!ok) {
    return NextResponse.json(
      { error: "Primero genera tu código de socio." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}

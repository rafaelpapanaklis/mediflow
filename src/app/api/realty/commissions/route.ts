import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { getDealsScreen, payBeneficiaryPeriod } from "@/app/api/realty/deals/service";
import { realtyApiError } from "@/lib/realty/team";

// /api/realty/commissions
// GET  ?period=AAAA-MM → el recibo del periodo (devengado y pagado por
//                        beneficiario) y el ranking. Es la misma consulta que
//                        /api/realty/deals para que las dos pantallas no
//                        puedan discrepar.
// POST                 → marcar pagado TODO lo pendiente de un beneficiario
//                        en el periodo. body { realtyUserId?, party?, periodKey }

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const screen = await getDealsScreen(ctx, req.nextUrl.searchParams.get("period"));
    return NextResponse.json(
      {
        periodKey: screen.periodKey,
        timezone: screen.timezone,
        receipt: screen.receipt,
        ranking: screen.ranking,
        totals: screen.totals,
        canManage: screen.canManage,
        selfOnly: screen.selfOnly,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return realtyApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await payBeneficiaryPeriod(ctx, {
      realtyUserId: typeof body.realtyUserId === "string" ? body.realtyUserId : null,
      party: typeof body.party === "string" ? body.party : null,
      externalName: typeof body.externalName === "string" ? body.externalName : null,
      periodKey: typeof body.periodKey === "string" ? body.periodKey : "",
    });
    const screen = await getDealsScreen(ctx, typeof body.periodKey === "string" ? body.periodKey : null);
    return NextResponse.json({ ...result, receipt: screen.receipt, deals: screen.deals });
  } catch (err) {
    return realtyApiError(err);
  }
}

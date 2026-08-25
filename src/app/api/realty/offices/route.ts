import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { createOffice, getOfficesOverview } from "@/lib/realty/offices";
import { assertRealtyArea, realtyApiError } from "@/lib/realty/team";

// /api/realty/offices — oficinas (sucursales) de la inmobiliaria.
// GET  → { offices, limit, stats, unassignedProperties, totals }
// POST → alta con dirección y mapa. Respeta maxOffices del plan y explica en
//        qué plan caben más, con el precio leído de realty_plan_configs.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const data = await getOfficesOverview(ctx);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return realtyApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    const offices = await createOffice(ctx, body);
    return NextResponse.json({ offices }, { status: 201 });
  } catch (err) {
    return realtyApiError(err);
  }
}

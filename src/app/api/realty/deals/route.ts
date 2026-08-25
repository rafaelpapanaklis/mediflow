import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { createDeal, getDealsScreen } from "@/app/api/realty/deals/service";
import { realtyApiError } from "@/lib/realty/team";

// /api/realty/deals — operaciones cerradas (ventas y rentas).
// GET  ?period=AAAA-MM → la pantalla completa de Comisiones para ese periodo.
// POST                 → registrar una operación. Al CERRAR, el inmueble pasa
//                        a VENDIDO o RENTADO; la despublicación de portales
//                        la dispara ESE cambio de estatus, no esta ruta.
//
// Quien solo tiene commissions.view (el asesor) recibe ÚNICAMENTE las
// operaciones donde tiene parte: el recorte es del servidor.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const data = await getDealsScreen(ctx, req.nextUrl.searchParams.get("period"));
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return realtyApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    const deal = await createDeal(ctx, body);
    return NextResponse.json({ deal }, { status: 201 });
  } catch (err) {
    return realtyApiError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { assertRealtyArea, getOffboardImpact, offboardMember, realtyApiError } from "@/lib/realty/team";

// /api/realty/team/[id]/baja — dar de baja a un asesor.
//
// GET  → el CONTEO de lo que se lleva por delante: inmuebles, prospectos,
//        visitas agendadas, pendientes, llaves sin devolver y comisiones sin
//        pagar. Es lo que la pantalla enseña ANTES de confirmar.
// POST → la ejecuta. body { reassignToUserId?: string | null }.
//        null = todo cae en la bandeja general, sin asesor. Es una decisión
//        válida y explícita, no un descuido.
//
// La regla de negocio completa (los inmuebles SIGUEN publicados, la ficha se
// apaga pero su fila sobrevive para el 301, etc.) está escrita una sola vez
// en src/lib/realty/team.ts.

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const impact = await getOffboardImpact(ctx, params.id);
    return NextResponse.json(impact, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return realtyApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const reassignToUserId =
      typeof body.reassignToUserId === "string" && body.reassignToUserId
        ? body.reassignToUserId
        : null;
    const result = await offboardMember(ctx, params.id, { reassignToUserId });
    return NextResponse.json(result);
  } catch (err) {
    return realtyApiError(err);
  }
}

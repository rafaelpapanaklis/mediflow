import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { assertRealtyArea, getTeamContext, inviteMember, realtyApiError } from "@/lib/realty/team";

// /api/realty/team — el equipo de la inmobiliaria.
// GET  → { members, seats, agentPagesEnabled, multiOfficeEnabled }
// POST → alta por correo. Devuelve la contraseña temporal UNA vez (o null si
//        la persona ya tenía login DaleControl y solo se ligó).
//
// El candado es de aquí: cada función del service llama assertRealtyPermission
// otra vez. Esconder el menú NO es control de acceso.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const data = await getTeamContext(ctx);
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
    const result = await inviteMember(ctx, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return realtyApiError(err);
  }
}

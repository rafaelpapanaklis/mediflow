import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { assertRealtyArea, realtyApiError, setMemberPermissions } from "@/lib/realty/team";

// PUT /api/realty/team/[id]/permissions
// body { permissions: string[] } = el conjunto EFECTIVO COMPLETO que debe
// quedarle a esa persona. NUNCA un delta.
//
// El service decide si eso se guarda como [] (herencia del rol) o como
// override completo, y frena el caso de dejar a la inmobiliaria sin nadie que
// pueda administrar el equipo.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    const member = await setMemberPermissions(ctx, params.id, body.permissions);
    return NextResponse.json({ member });
  } catch (err) {
    return realtyApiError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { assertRealtyArea, realtyApiError, setMemberOfficeAccess } from "@/lib/realty/team";

// PUT /api/realty/team/[id]/offices — body { officeIds: string[] }
// Reparte el acceso de una persona a las oficinas (RealtyUserOfficeAccess).
// Exige offices.manage, no team.manage: es una llave de sede.
//
// OWNER y MANAGER ven TODAS las oficinas por su rol (getAccessibleOfficeIds),
// así que las filas no les cambian nada — se guardan igual para que bajarlos
// a AGENT no los deje sin acceso a nada de golpe.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    const member = await setMemberOfficeAccess(ctx, params.id, body.officeIds);
    return NextResponse.json({ member });
  } catch (err) {
    return realtyApiError(err);
  }
}

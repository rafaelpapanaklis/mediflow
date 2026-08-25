import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { assertRealtyArea, realtyApiError, saveAgentProfile } from "@/lib/realty/team";

// PUT /api/realty/team/[id]/perfil — ficha PÚBLICA del asesor
// (RealtyAgentProfile): foto, biografía, zonas, especialidades, credenciales
// (EC0110.02, AMPI, registro estatal con su vencimiento) y redes.
//
// Cada quien puede editar SU ficha; para la de alguien más hace falta
// team.manage (lo comprueba el service).
//
// La consume la web pública en /i/[slug]/agentes/[agente]. La forma de los
// Json credentials/socials está documentada en src/lib/realty/team.ts y es
// el contrato con esa pantalla.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    const member = await saveAgentProfile(ctx, params.id, body);
    return NextResponse.json({ member });
  } catch (err) {
    return realtyApiError(err);
  }
}

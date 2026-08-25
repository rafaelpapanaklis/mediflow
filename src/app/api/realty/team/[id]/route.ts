import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { assertRealtyArea, realtyApiError, updateMember } from "@/lib/realty/team";

// PATCH /api/realty/team/[id] — nombre, rol, alta/baja y el interruptor de
// "mostrar en la web".
//
// El CORREO no se edita aquí a propósito: es la identidad de acceso y
// cambiarlo obliga a mover también la cuenta de Supabase (el dental ya se
// quemó con eso). Se da de baja y se vuelve a dar de alta.
//
// La BAJA con reasignación de cartera va en /api/realty/team/[id]/baja: es
// una operación con consecuencias que exige enseñar antes qué se lleva.

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    const member = await updateMember(ctx, params.id, body);
    return NextResponse.json({ member });
  } catch (err) {
    return realtyApiError(err);
  }
}

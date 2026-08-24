import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { updateMember } from "@/lib/barber/team";

// PATCH  /api/barber/team/members/[id] — nombre, rol, ficha ligada, alta/baja.
// DELETE /api/barber/team/members/[id] — baja (isActive:false). No se borra
//        la fila: quedan ventas, cortes de caja y tickets firmados por ella.
// El CORREO no se edita aquí: es la identidad de acceso (ver team.ts).

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const member = await updateMember(ctx, params.id, body);
    return NextResponse.json({ member });
  } catch (err) {
    return barberApiError(err, "team/members/[id]:PATCH");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const member = await updateMember(ctx, params.id, { isActive: false });
    return NextResponse.json({ member });
  } catch (err) {
    return barberApiError(err, "team/members/[id]:DELETE");
  }
}

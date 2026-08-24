import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { updateBarberProfile } from "@/lib/barber/team";

// PATCH /api/barber/team/barbers/[id] — edita la ficha (datos y esquema de
// pago). Dar de baja es isActive:false: una ficha con citas y comisiones
// detrás no se borra.

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const barber = await updateBarberProfile(ctx, params.id, body);
    return NextResponse.json({ barber });
  } catch (err) {
    return barberApiError(err, "team/barbers/[id]:PATCH");
  }
}

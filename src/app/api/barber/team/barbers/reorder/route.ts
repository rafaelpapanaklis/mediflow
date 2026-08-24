import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { reorderBarbers } from "@/lib/barber/team";

// POST /api/barber/team/barbers/reorder — { barbershopId, ids: [] }
// El orden vale para la agenda y para la mini-web (sortOrder es uno solo).

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.ids)) {
      return NextResponse.json({ error: "ids requerido" }, { status: 400 });
    }
    await reorderBarbers(ctx, body.barbershopId, body.ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return barberApiError(err, "team/barbers/reorder:POST");
  }
}

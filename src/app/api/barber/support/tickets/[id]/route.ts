import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { getTicketDetail, setTicketClosed } from "@/lib/barber/support";

// GET   /api/barber/support/tickets/[id] — hilo completo con ligas firmadas.
// PATCH /api/barber/support/tickets/[id] — { closed: boolean }. Los estados
//       intermedios (IN_PROGRESS / WAITING_REPLY) los mueve DaleControl.

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const detail = await getTicketDetail(ctx, params.id);
    return NextResponse.json(detail);
  } catch (err) {
    return barberApiError(err, "support/tickets/[id]:GET");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body || typeof body.closed !== "boolean") {
      return NextResponse.json({ error: "closed requerido" }, { status: 400 });
    }
    const detail = await setTicketClosed(ctx, params.id, body.closed);
    return NextResponse.json(detail);
  } catch (err) {
    return barberApiError(err, "support/tickets/[id]:PATCH");
  }
}

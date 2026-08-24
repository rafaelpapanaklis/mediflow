import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { createTicket, listTickets } from "@/lib/barber/support";

// /api/barber/support/tickets — lado BARBERÍA.
// Soporte no se gatea por plan (está en todos), sí por permiso: support.view
// para leer, support.manage para abrir y responder.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const tickets = await listTickets(ctx);
    return NextResponse.json({ tickets });
  } catch (err) {
    return barberApiError(err, "support/tickets:GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const ticket = await createTicket(ctx, body);
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err) {
    return barberApiError(err, "support/tickets:POST");
  }
}

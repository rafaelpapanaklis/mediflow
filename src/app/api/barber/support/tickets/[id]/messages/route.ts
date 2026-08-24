import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { addMessage } from "@/lib/barber/support";

// POST /api/barber/support/tickets/[id]/messages — { body, attachments }
// Los adjuntos llegan como metadatos ya subidos por
// /api/barber/support/attachments y se RE-VALIDAN contra el barbershopId del
// ticket: nadie adjunta el archivo de otra barbería aunque adivine el path.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const detail = await addMessage(ctx, params.id, body);
    return NextResponse.json(detail, { status: 201 });
  } catch (err) {
    return barberApiError(err, "support/tickets/[id]/messages:POST");
  }
}

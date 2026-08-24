import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { setMemberPermissions } from "@/lib/barber/team";

// PUT /api/barber/team/members/[id]/permissions
// body { permissions: string[] } = el conjunto EFECTIVO COMPLETO que debe
// quedarle a esa persona (nunca un delta). El service decide si eso se
// guarda como [] (herencia del rol) o como override completo, y bloquea el
// caso de dejar a la barbería sin nadie que administre el equipo.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const member = await setMemberPermissions(ctx, params.id, body.permissions);
    return NextResponse.json({ member });
  } catch (err) {
    return barberApiError(err, "team/members/[id]/permissions:PUT");
  }
}

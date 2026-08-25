import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { deleteOffice, getOfficeDeleteImpact, updateOffice } from "@/lib/realty/offices";
import { assertRealtyArea, realtyApiError } from "@/lib/realty/team";

// /api/realty/offices/[id]
// GET    → qué se lleva por delante borrarla (inmuebles y personas dentro).
// PATCH  → editar, cerrar/abrir y nombrar principal. Marcar principal quita
//          la anterior EN LA MISMA transacción: dos principales dejan el
//          orden de getAccessibleOfficeIds al azar.
// DELETE → solo si está VACÍA y no es la principal. Con inmuebles dentro se
//          cierra (isActive:false), porque borrarla los dejaría con officeId
//          NULL y nadie sabría de dónde salieron.

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const impact = await getOfficeDeleteImpact(ctx, params.id);
    return NextResponse.json(impact, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return realtyApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    const offices = await updateOffice(ctx, params.id, body);
    return NextResponse.json({ offices });
  } catch (err) {
    return realtyApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    assertRealtyArea(ctx, "equipo");
    const offices = await deleteOffice(ctx, params.id);
    return NextResponse.json({ offices });
  } catch (err) {
    return realtyApiError(err);
  }
}

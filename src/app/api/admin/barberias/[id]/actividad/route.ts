import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { actividadDeBarberias } from "@/lib/barber/uso/actividad";

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/barberias/[id]/actividad?mes=YYYY-MM — uso del panel de una
// barbería por mes (entradas, pantallas, clics, por usuario y por día).
//
// Solo admins de DaleControl: el MISMO guard que la pestaña de uso del dental
// (isAdminAuthed, sesión en BD con revocación). Una barbería no llega aquí
// (no tiene sesión de admin), y los ids que se consultan salen del servidor:
// la sede pedida y, si es una matriz, sus sucursales — nunca de la URL más
// allá del [id] de la ficha.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const shop = await prisma.barbershop.findUnique({
      where: { id: params.id },
      select: { id: true, parentId: true, branches: { select: { id: true } } },
    });
    if (!shop) return NextResponse.json({ error: "Barbería no encontrada" }, { status: 404 });

    // Matriz → ella y sus sucursales (como el consumo de WhatsApp de la ficha).
    // Sucursal → solo ella.
    const ids = shop.parentId === null ? [shop.id, ...shop.branches.map((b) => b.id)] : [shop.id];
    const data = await actividadDeBarberias(ids, req.nextUrl.searchParams.get("mes"));
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/admin/barberias/[id]/actividad error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

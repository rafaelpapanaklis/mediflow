import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Siempre dinámico — Next.js tenía que evitar prerenderizar esta ruta en build
// (falla si la DB no está disponible en el paso de build, ej. local sin env vars).
export const dynamic = "force-dynamic";

// Devuelve anuncios activos dentro de su ventana startsAt/endsAt.
// Pensado para consumirse desde el dashboard (cualquier user logueado).
export async function GET() {
  try {
    const now = new Date();
    const announcements = await prisma.adminAnnouncement.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, message: true, type: true, createdAt: true },
    });
    return NextResponse.json(announcements);
  } catch (err) {
    // Si la tabla admin_announcements aún no existe en la DB, devolvemos
    // lista vacía para no romper el dashboard del usuario.
    console.error("[announcements/active] failed:", err);
    return NextResponse.json([]);
  }
}

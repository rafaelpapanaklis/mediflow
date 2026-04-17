import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Devuelve anuncios activos dentro de su ventana startsAt/endsAt.
// Pensado para consumirse desde el dashboard (cualquier user logueado).
export async function GET() {
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
}

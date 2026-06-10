import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

// Siempre dinámico — Next.js tenía que evitar prerenderizar esta ruta en build
// (falla si la DB no está disponible en el paso de build, ej. local sin env vars).
export const dynamic = "force-dynamic";

// Query global cacheada 60s en el data cache (compartido entre requests e
// instancias): el banner no depende de la sesión y lo pide cada dashboard en
// cada carga. Tag "announcements" listo para revalidateTag() desde el CRUD
// admin cuando se edite un anuncio.
const getActiveAnnouncements = unstable_cache(
  async () => {
    const now = new Date();
    return prisma.adminAnnouncement.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, message: true, type: true, createdAt: true },
    });
  },
  ["announcements-active"],
  { revalidate: 60, tags: ["announcements"] },
);

// Devuelve anuncios activos dentro de su ventana startsAt/endsAt.
// Pensado para consumirse desde el dashboard (cualquier user logueado).
export async function GET() {
  try {
    const announcements = await getActiveAnnouncements();
    // La respuesta no lee cookies ni varía por usuario → cacheable también
    // en el edge de Vercel.
    return NextResponse.json(announcements, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    // Si la tabla admin_announcements aún no existe en la DB, devolvemos
    // lista vacía para no romper el dashboard del usuario. Sin header de
    // cache: no queremos fijar el fallo en el edge.
    console.error("[announcements/active] failed:", err);
    return NextResponse.json([]);
  }
}

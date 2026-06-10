import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Catálogo CUMS: dataset global y casi inmutable (solo cambia con un import
// masivo) → cache 24h por combinación q/group/limit (los args forman la key).
// Tag "cums" por si un import futuro quiere revalidateTag().
const searchCums = unstable_cache(
  async (q: string, group: string, limit: number) => {
    const where: Record<string, unknown> = {};
    if (group) where.grupoTerapeutico = group;
    if (q) {
      where.OR = [
        { clave: { contains: q, mode: "insensitive" } },
        { descripcion: { contains: q, mode: "insensitive" } },
      ];
    }

    return prisma.cumsItem.findMany({
      where,
      take: limit,
      orderBy: [{ descripcion: "asc" }],
    });
  },
  ["catalogs-cums"],
  { revalidate: 60 * 60 * 24, tags: ["cums"] },
);

/**
 * GET /api/catalogs/cums?q=&group=&limit=
 *
 * Catálogo CUMS GLOBAL (no clinicId). Auth básica.
 */
export async function GET(req: NextRequest) {
  await getCurrentUser();

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const group = (sp.get("group") ?? "").trim();
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);

  const items = await searchCums(q, group, limit);

  return NextResponse.json({ items, count: items.length });
}

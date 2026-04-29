import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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

  const where: Record<string, unknown> = {};
  if (group) where.grupoTerapeutico = group;
  if (q) {
    where.OR = [
      { clave: { contains: q, mode: "insensitive" } },
      { descripcion: { contains: q, mode: "insensitive" } },
    ];
  }

  const items = await prisma.cumsItem.findMany({
    where,
    take: limit,
    orderBy: [{ descripcion: "asc" }],
  });

  return NextResponse.json({ items, count: items.length });
}

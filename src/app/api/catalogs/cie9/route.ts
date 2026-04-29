import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalogs/cie9?q=&category=&limit=
 *
 * Catálogo CIE-9-MC GLOBAL.
 */
export async function GET(req: NextRequest) {
  await getCurrentUser();

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const category = (sp.get("category") ?? "").trim();
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (q) {
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const codes = await prisma.cie9Code.findMany({
    where,
    take: limit,
    orderBy: [{ code: "asc" }],
  });

  return NextResponse.json({ codes, count: codes.length });
}

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalogs/cie10?q=&chapter=&limit=
 *
 * Catálogo CIE-10 GLOBAL (no tiene clinicId). Auth básica para evitar
 * scrapping anónimo, pero el catálogo es estándar OMS público.
 */
export async function GET(req: NextRequest) {
  await getCurrentUser(); // gate: solo usuarios autenticados de cualquier clínica

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const chapter = (sp.get("chapter") ?? "").trim();
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);

  const where: Record<string, unknown> = {};
  if (chapter) where.chapter = chapter;
  if (q) {
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const codes = await prisma.cie10Code.findMany({
    where,
    take: limit,
    orderBy: [{ code: "asc" }],
  });

  return NextResponse.json({ codes, count: codes.length });
}

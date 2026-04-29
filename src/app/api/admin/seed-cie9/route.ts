import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CIE9_ESSENTIALS } from "@/lib/seeds/cie9-essentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/seed-cie9 — carga catálogo CIE-9-MC essentials.
 * Solo SUPER_ADMIN. Idempotente.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }
  const result = await prisma.cie9Code.createMany({
    data: CIE9_ESSENTIALS,
    skipDuplicates: true,
  });
  return NextResponse.json({ seeded: result.count, totalInSeed: CIE9_ESSENTIALS.length });
}

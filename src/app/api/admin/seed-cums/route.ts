import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CUMS_ESSENTIALS } from "@/lib/seeds/cums-essentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/seed-cums — carga el catálogo CUMS essentials.
 * Solo SUPER_ADMIN. Idempotente vía createMany skipDuplicates.
 *
 * Tabla GLOBAL — catálogo SSA público.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  const result = await prisma.cumsItem.createMany({
    data: CUMS_ESSENTIALS,
    skipDuplicates: true,
  });

  return NextResponse.json({
    seeded: result.count,
    totalInSeed: CUMS_ESSENTIALS.length,
  });
}

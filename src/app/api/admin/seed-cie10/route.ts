import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CIE10_ESSENTIALS } from "@/lib/seeds/cie10-essentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/seed-cie10 — carga el catálogo CIE-10 essentials.
 * Solo SUPER_ADMIN. Idempotente vía createMany skipDuplicates.
 *
 * NO es multi-tenant: la tabla cie10_codes es GLOBAL (catálogo OMS público).
 * Solo el SUPER_ADMIN del SaaS puede ejecutar el seed.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  const result = await prisma.cie10Code.createMany({
    data: CIE10_ESSENTIALS,
    skipDuplicates: true,
  });

  return NextResponse.json({
    seeded: result.count,
    totalInSeed: CIE10_ESSENTIALS.length,
  });
}

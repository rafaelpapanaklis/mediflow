import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { CIE10_ESSENTIALS } from "@/lib/seeds/cie10-essentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/seed-cie10 — carga el catálogo CIE-10 essentials.
 * Solo admin de plataforma (cookie admin_token, isAdminAuthed). Idempotente
 * vía createMany skipDuplicates.
 *
 * NO es multi-tenant: la tabla cie10_codes es GLOBAL (catálogo OMS público).
 * Solo el admin de plataforma puede ejecutar el seed.
 */
export async function POST() {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { CUMS_ESSENTIALS } from "@/lib/seeds/cums-essentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/seed-cums — carga el catálogo CUMS essentials.
 * Solo admin de plataforma (cookie admin_token, isAdminAuthed).
 * Idempotente vía createMany skipDuplicates.
 *
 * Tabla GLOBAL — catálogo SSA público.
 */
export async function POST() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

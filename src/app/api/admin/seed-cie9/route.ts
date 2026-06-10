import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { CIE9_ESSENTIALS } from "@/lib/seeds/cie9-essentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/seed-cie9 — carga catálogo CIE-9-MC essentials.
 * Solo admin de plataforma (cookie admin_token, isAdminAuthed). Idempotente.
 */
export async function POST() {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await prisma.cie9Code.createMany({
    data: CIE9_ESSENTIALS,
    skipDuplicates: true,
  });
  return NextResponse.json({ seeded: result.count, totalInSeed: CIE9_ESSENTIALS.length });
}

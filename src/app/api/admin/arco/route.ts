import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/arco — solicitudes ARCO ANÓNIMAS (clinicId NULL), las que
 * llegan del aviso de privacidad sin patientId. Solo el admin de plataforma
 * (AdminUser, cookie admin_token): ningún usuario de clínica las ve (A3,
 * auditoría 30-sep-2026). Las de cada clínica las atiende la clínica.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.arcoRequest.findMany({
    where: { clinicId: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json(rows);
}

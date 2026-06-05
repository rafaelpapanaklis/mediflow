import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { AffiliateStatus } from "@prisma/client";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

const AFFILIATE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;

// GET /api/admin/affiliates[?status=PENDING]
// Affiliate es GLOBAL (sin clinicId): el admin de plataforma ve TODOS los
// afiliados. `status` filtra opcionalmente. Incluye el número de clínicas
// referidas para el panel de revisión.
export async function GET(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = (AFFILIATE_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as AffiliateStatus)
    : undefined;

  const affiliates = await prisma.affiliate.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { clinics: true } } },
  });
  return NextResponse.json(affiliates);
}

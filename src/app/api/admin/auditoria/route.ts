import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { queryAuditLogs } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

// Super admin de plataforma: token global. NO hay aislamiento por clínica aquí
// — puede ver TODAS o filtrar por `clinicId` opcional.
function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const result = await queryAuditLogs({
    clinicId: sp.get("clinicId") || undefined,
    userId: sp.get("userId") || undefined,
    role: sp.get("role") || undefined,
    action: sp.get("action") || undefined,
    entityType: sp.get("entityType") || undefined,
    entityId: sp.get("entityId") || undefined,
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
    q: sp.get("q") || undefined,
    page: parseInt(sp.get("page") || "1", 10) || 1,
    pageSize: parseInt(sp.get("pageSize") || "50", 10) || 50,
  });

  return NextResponse.json(result);
}

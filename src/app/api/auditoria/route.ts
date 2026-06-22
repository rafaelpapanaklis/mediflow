import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { queryAuditLogs } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

// Bitácora de la CLÍNICA (panel /dashboard). Solo ADMIN/dueño. El clinicId se
// FUERZA al de la sesión — nunca se acepta del query (aislamiento multi-tenant).
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const result = await queryAuditLogs({
    clinicId: ctx.clinicId, // FORZADO — ignora cualquier clinicId del query.
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

import { NextResponse } from "next/server";
import { getSupplierContext } from "@/lib/supplier-auth";
import { getSupplierDashboardData } from "@/lib/suppliers/dashboard";

export const dynamic = "force-dynamic";

// GET /api/proveedores/dashboard → KPIs del proveedor en sesión.
export async function GET() {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }

  const data = await getSupplierDashboardData(ctx.supplierId);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

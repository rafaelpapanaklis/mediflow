import { NextResponse } from "next/server";
import { getDentalLabContext } from "@/lib/lab-auth";
import { getDentalLabDashboardData } from "@/lib/laboratorios/dashboard";

export const dynamic = "force-dynamic";

// GET /api/laboratorios/dashboard → KPIs del laboratorio en sesión.
// labId SIEMPRE desde la sesión (getDentalLabContext), nunca desde el request.
export async function GET() {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }

  const data = await getDentalLabDashboardData(ctx.labId);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

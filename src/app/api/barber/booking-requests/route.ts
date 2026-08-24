import { NextRequest, NextResponse } from "next/server";
import {
  assertBarberPermission,
  getAccessibleBranchIds,
  getBarberContext,
} from "@/lib/barber-auth";
import { listBookingRequests } from "@/lib/barber/booking";

/**
 * GET /api/barber/booking-requests — bandeja de solicitudes (lado panel).
 *
 *   ?scope=pendientes (default) | resueltas
 *
 * Sesión de barbería, permiso `requests.manage`, y las sedes SIEMPRE de
 * getAccessibleBranchIds(ctx) — nunca de la query. El endpoint no acepta un
 * barbershopId por ningún lado.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    assertBarberPermission(ctx, "requests.manage");
  } catch {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const barbershopIds = await getAccessibleBranchIds(ctx);
    const scope = req.nextUrl.searchParams.get("scope") === "resueltas"
      ? "resueltas"
      : "pendientes";
    const requests = await listBookingRequests({ barbershopIds, scope });
    return NextResponse.json({ requests, scope, count: requests.length });
  } catch (err) {
    console.error("[barber/booking-requests] error:", err);
    return NextResponse.json({ error: "No pudimos cargar las solicitudes" }, { status: 500 });
  }
}

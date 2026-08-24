import { NextRequest, NextResponse } from "next/server";
import {
  assertBarberPermission,
  getAccessibleBranchIds,
  getBarberContext,
} from "@/lib/barber-auth";
import { isRequestActionError, resolveBookingRequest } from "@/lib/barber/booking";

/**
 * PATCH /api/barber/booking-requests/[id] — aceptar o rechazar.
 *
 *   { accion: "aceptar" }  → PENDING → CONFIRMED
 *   { accion: "rechazar" } → PENDING → CANCELLED
 *
 * La cita ya existe y ya aparta el hueco desde que el cliente reservó: esto
 * solo cambia el estado. La transición se valida contra la máquina de
 * estados del vertical (canTransition), no a mano.
 */

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    assertBarberPermission(ctx, "requests.manage");
  } catch {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const accion = body?.accion;
    if (accion !== "aceptar" && accion !== "rechazar") {
      return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
    }

    const barbershopIds = await getAccessibleBranchIds(ctx);
    const result = await resolveBookingRequest({
      barbershopIds,
      appointmentId: params.id,
      action: accion,
    });

    if (isRequestActionError(result)) {
      return result.code === "notFound"
        ? NextResponse.json({ error: "No encontramos esa solicitud" }, { status: 404 })
        : NextResponse.json({ error: "Esa solicitud ya se resolvió" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    console.error("[barber/booking-requests/:id] error:", err);
    return NextResponse.json({ error: "No pudimos guardar el cambio" }, { status: 500 });
  }
}

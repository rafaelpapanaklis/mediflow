import { NextResponse } from "next/server";
import { assertBarberPermission, getBarberContext, type BarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, barberGateErrorPayload } from "@/lib/barber/gating";

/**
 * Helpers de /api/barber/affiliates/*. No es una ruta (no se llama route.ts).
 *
 * REGLA DE ORO DEL VERTICAL: ocultar el menú no es gating. TODA ruta del
 * programa de socios pasa por aquí, y aquí se exige, en este orden:
 *   1. sesión de barbería            → 401
 *   2. permiso de rol billing.manage → 403
 *   3. feature "affiliates" del plan → 402 / 403 con el plan que sí la trae
 *
 * PERMISO: se reusa billing.manage ("Suscripción y pagos DaleControl", OWNER
 * por default) porque el programa es dinero de la barbería frente a
 * DaleControl. Una clave propia (affiliates.view / affiliates.manage) exige
 * tocar src/lib/barber/permissions.ts, que está fuera de la allowlist de
 * esta ola — queda anotado en ORQUESTA.md.
 *
 * La ruta PÚBLICA de la liga (r/[code]) NO usa estos helpers a propósito:
 * quien toca un link compartido en WhatsApp no tiene sesión.
 */

export interface BarberAffiliatesAuth {
  ctx: BarberContext;
}

export async function requireBarberAffiliates(): Promise<BarberAffiliatesAuth | NextResponse> {
  const ctx = await getBarberContext();
  if (!ctx) {
    return NextResponse.json({ error: "No autorizado", code: "UNAUTHENTICATED" }, { status: 401 });
  }
  try {
    assertBarberPermission(ctx, "billing.manage");
    await assertBarberFeature(ctx, "affiliates");
    return { ctx };
  } catch (err) {
    return affiliatesErrorResponse(err);
  }
}

/** Errores de gate (plan/rol) a JSON; lo demás, 500 sin filtrar detalles. */
export function affiliatesErrorResponse(err: unknown): NextResponse {
  const gate = barberGateErrorPayload(err);
  if (gate) return NextResponse.json(gate.body, { status: gate.status });
  console.error("[barber afiliados]", err);
  return NextResponse.json(
    { error: "Algo falló en el programa de socios. Intenta de nuevo.", code: "INTERNAL" },
    { status: 500 },
  );
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

import { NextResponse } from "next/server";
import { getBarberContext, assertBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, type BarberPermissionKey } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { BarberMembershipError } from "@/lib/barber/memberships";
import { BarberPaymentsError } from "@/lib/barber/payments";

/**
 * Puerta compartida de las APIs de esta ola (membresías, anticipos y pagos
 * del cliente final). NO es una ruta: el guion bajo la deja fuera del
 * enrutador de Next.
 *
 * Tres candados, en este orden:
 *   1. Sesión de barbería  → barbershopId sale SIEMPRE de aquí, jamás del body.
 *   2. Feature del plan    → "memberships" y "deposits" son Avanzado+.
 *   3. Permiso del rol     → assertBarberPermission (punto único del contrato).
 */
export type BarberFeatureKey = "memberships" | "deposits";

/**
 * Ojo con el shape: el repo compila con `strict: false`, así que TypeScript
 * NO estrecha uniones discriminadas por `ok`. Por eso es UNA interfaz con
 * los dos campos opcionales y no `{ok:true}|{ok:false}`.
 */
export interface GuardResult {
  ok: boolean;
  ctx?: BarberContext;
  res?: NextResponse;
}

export async function requireBarberApi(opts: {
  permission: BarberPermissionKey;
  feature?: BarberFeatureKey;
}): Promise<GuardResult> {
  const ctx = await getBarberContext();
  if (!ctx) {
    return { ok: false, res: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  if (opts.feature) {
    const plan = await getBarberPlan(ctx.barbershop.plan);
    if (plan.features[opts.feature] !== true) {
      return {
        ok: false,
        res: NextResponse.json(
          {
            error:
              opts.feature === "memberships"
                ? "Las membresías están disponibles desde el plan Avanzado."
                : "Los anticipos están disponibles desde el plan Avanzado.",
            code: "PLAN_REQUIRED",
          },
          { status: 402 },
        ),
      };
    }
  }

  try {
    assertBarberPermission(ctx, opts.permission);
  } catch {
    return { ok: false, res: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }

  return { ok: true, ctx };
}

/** Traduce los errores tipados de la ola a respuestas JSON coherentes. */
export function barberApiError(err: unknown): NextResponse {
  if (err instanceof BarberMembershipError || err instanceof BarberPaymentsError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof BarberForbiddenError) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  console.error("[barber/membresias] error inesperado:", err);
  return NextResponse.json({ error: "Algo salió mal. Intenta de nuevo." }, { status: 500 });
}

/** Body JSON seguro (nunca truena por un cuerpo malformado). */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

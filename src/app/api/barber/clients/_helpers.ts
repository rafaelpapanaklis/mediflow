import { NextResponse } from "next/server";
import {
  assertBarberPermission,
  getBarberContext,
  BarberForbiddenError,
  type BarberContext,
  type BarberPermissionKey,
} from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";

/**
 * Puerta ÚNICA de /api/barber/clients/*.
 *
 * Tres candados, en este orden:
 *   1. Sesión de barbería (getBarberContext). De aquí sale el barbershopId
 *      que usa TODA lectura y TODA escritura; el body y el query no
 *      participan jamás.
 *   2. Feature del plan (`clients` en barber_plan_configs).
 *   3. Permiso del rol (assertBarberPermission — el punto único del vertical;
 *      esta ola NO inventa su propio check).
 *
 * Devuelve o el contexto, o la NextResponse de corte ya armada. El caller
 * hace `if ("response" in gate) return gate.response;`.
 */
export type BarberGate =
  | { ctx: BarberContext }
  | { response: NextResponse };

export async function gateBarberClients(
  permission: BarberPermissionKey,
): Promise<BarberGate> {
  const ctx = await getBarberContext();
  if (!ctx) {
    return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  const plan = await getBarberPlan(ctx.barbershop.plan);
  if (plan.features.clients !== true) {
    return {
      response: NextResponse.json(
        { error: "Tu plan no incluye la agenda de clientes." },
        { status: 403 },
      ),
    };
  }

  try {
    assertBarberPermission(ctx, permission);
  } catch (e) {
    if (e instanceof BarberForbiddenError) {
      return { response: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
    }
    throw e;
  }

  return { ctx };
}

/** ¿El usuario tiene ADEMÁS este permiso? (para acciones extra dentro de una ruta). */
export function alsoHas(ctx: BarberContext, permission: BarberPermissionKey): boolean {
  try {
    assertBarberPermission(ctx, permission);
    return true;
  } catch {
    return false;
  }
}

/** JSON del body, tolerante: un cuerpo vacío o roto es {} y no un 500. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Error 500 con el mensaje ya saneado (nunca se filtra el stack al cliente). */
export function serverError(scope: string, e: unknown): NextResponse {
  console.error(`[api/barber/clients/${scope}]`, e);
  return NextResponse.json({ error: "Algo salió mal. Inténtalo otra vez." }, { status: 500 });
}

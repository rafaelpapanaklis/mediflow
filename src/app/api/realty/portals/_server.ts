import { NextResponse } from "next/server";
import {
  RealtyForbiddenError,
  assertRealtyPermission,
  getRealtyContext,
  type RealtyContext,
} from "@/lib/realty-auth";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";

// ═══════════════════════════════════════════════════════════════════════
// Puerta común de /api/realty/portals/**.
//
// Tres candados, siempre los tres y siempre en este orden:
//   1. SESIÓN  → getRealtyContext (de ahí sale el accountId; jamás del body)
//   2. PLAN    → featureKey "portalsFeed" (el plan PROPIETARIO no lo trae)
//   3. PERMISO → "portals.manage" (OWNER y MANAGER por default)
//
// Esconder el item del menú NO es control de acceso: quien escriba la URL
// a mano llegaría igual. Esto es el corte de verdad.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Devuelve el CONTEXTO cuando pasa, o la propia NextResponse de corte.
 *
 * 🔴 No es una unión discriminada por un campo `ok`: el tsconfig del repo
 * tiene `strict: false`, y sin strict TypeScript NO estrecha una unión por
 * el valor de una propiedad — `if (!guard.ok)` deja el tipo tal cual y el
 * acceso a `guard.response` ni siquiera compila. Con `instanceof` sí.
 *
 * Uso:
 *   const guard = await requirePortalsAccess();
 *   if (guard instanceof NextResponse) return guard;
 *   // a partir de aquí `guard` es el RealtyContext
 */
export type PortalsGuardResult = NextResponse | RealtyContext;

export async function requirePortalsAccess(): Promise<PortalsGuardResult> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // MODO de la cuenta, sacado del MISMO campo `modes` del contrato que usa
  // la página. Hoy portales se ve en los tres modos, así que no corta a
  // nadie; está aquí para que el día que el contrato lo restrinja, el
  // candado no se quede solo en la pantalla.
  const item = REALTY_NAV_ITEMS.find((i) => i.key === "portales");
  if (item && !navItemAllowsMode(item, ctx.mode)) {
    return NextResponse.json({ error: "No disponible para esta cuenta" }, { status: 403 });
  }
  if (!realtyPlanHasFeature(ctx.plan, "portalsFeed")) {
    return NextResponse.json(
      { error: "Tu plan no incluye la publicación en portales.", code: "plan_required" },
      { status: 403 },
    );
  }
  try {
    assertRealtyPermission(ctx, "portals.manage");
  } catch (e) {
    if (e instanceof RealtyForbiddenError) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    throw e;
  }
  return ctx;
}

/** Cuerpo JSON tolerante: un body vacío o roto no es un 500. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Error de servidor SIN filtrar el mensaje: en una API de panel el detalle
 * puede traer nombres de tabla y de columna. El log se queda con todo.
 */
export function serverError(scope: string, err: unknown): NextResponse {
  const code = (err as { code?: string })?.code;
  if (code === "P2021" || code === "42P01" || code === "P2022" || code === "42703") {
    // sql/realty.sql todavía no aplicado en esta base.
    return NextResponse.json(
      { error: "La base de datos del vertical no está migrada.", code: "schema_not_migrated" },
      { status: 503 },
    );
  }
  console.error(`[api/realty/portals] ${scope}`, err);
  return NextResponse.json({ error: "Algo falló de nuestro lado." }, { status: 500 });
}

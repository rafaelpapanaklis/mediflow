import { NextResponse } from "next/server";
import { getResolvedPlans } from "@/lib/plans";
import { getAuthContext } from "@/lib/auth-context";
import { applyClinicOverrides } from "@/lib/billing/plan-overrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/plans — público. Devuelve los planes ya resueltos (precio
 * mensual/anual, bullets de marketing, límites y permisos por módulo) leídos
 * de la tabla `plan_configs` (con caché + fallback). Lo consumen los client
 * components que muestran precios sin importar nada hardcodeado
 * (subscription-tab, paso 3 del registro, etc.).
 *
 * Con sesión, el plan PROPIO de la clínica sale con sus condiciones conservadas
 * (una Clínica de antes de los planes de sep-2026 ve $1,719 y sus topes, que es
 * lo que de verdad paga); los demás planes salen con las condiciones vigentes.
 * Sin sesión (registro, landing) = lista de precios a secas. Nunca falla por la
 * sesión: ante cualquier problema se devuelve la lista pública.
 */
export async function GET() {
  const plans = await getResolvedPlans();

  let clinic: any = null;
  try {
    clinic = (await getAuthContext())?.clinic ?? null;
  } catch {
    clinic = null;
  }

  return NextResponse.json({
    plans: clinic ? plans.map((p) => applyClinicOverrides(p, clinic)) : plans,
  });
}

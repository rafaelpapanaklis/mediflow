// ═══════════════════════════════════════════════════════════════════════
// Guardia de las rutas de calculadoras. El guion bajo lo saca del router de
// Next: no es una ruta, es el candado que las demás importan.
//
// CUATRO candados, en este orden:
//   1. Sesión      → el accountId sale SIEMPRE de aquí, jamás del body.
//   2. Feature     → el plan tiene que incluir "calculators".
//   3. Permiso     → "calculators.use" (usar las calculadoras).
//   4. Permiso del DATO que se toca → leads.view, leads.edit, properties.view.
//
// 🔴 El cuarto candado NO es redundante, y esta es la razón exacta:
// `permissionsOverride` REEMPLAZA los defaults del rol, no se suma a ellos
// (ver resolveRealtyPermissions). O sea que un dueño puede dejarle a alguien
// el override `["calculators.use"]` a secas —un practicante, alguien de
// marketing— pensando que le da una calculadora. Si estas rutas pidieran solo
// ese permiso, con él vendrían de regalo la libreta de contactos completa, la
// escritura en la bitácora de cualquier prospecto y el conteo del inventario.
// Pedir además el permiso del dato cierra ese hueco sin quitarle nada a nadie:
// los CUATRO roles por defecto que traen `calculators.use` traen también
// `leads.view`, `leads.edit` y `properties.view`.
//
// El mismo trío que hace la página. Ahí decide qué se pinta; aquí, qué se
// ejecuta: el navegador nunca es la última palabra.
//
// UNA interfaz con campos opcionales y NO una unión discriminada: el repo
// compila con `strict: false` y TypeScript no estrecha por el campo `ok`.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import {
  assertRealtyPermission,
  getRealtyContext,
  type RealtyContext,
} from "@/lib/realty-auth";
import type { RealtyPermissionKey } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";

export interface CalcGuardResult {
  ok: boolean;
  res?: NextResponse;
  ctx?: RealtyContext;
}

/**
 * @param ademas Permiso del DATO que la ruta va a tocar, además de
 *               "calculators.use". Omitirlo solo vale para rutas que no leen
 *               ni escriben datos de la cuenta.
 */
export async function requireCalcApi(ademas?: RealtyPermissionKey): Promise<CalcGuardResult> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return { ok: false, res: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  if (!realtyPlanHasFeature(ctx.plan, "calculators")) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Tu plan no incluye las calculadoras.", code: "PLAN_REQUIRED" },
        { status: 402 },
      ),
    };
  }
  try {
    assertRealtyPermission(ctx, "calculators.use");
    if (ademas) assertRealtyPermission(ctx, ademas);
  } catch {
    return { ok: false, res: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }
  return { ok: true, ctx };
}

import "server-only";
// ═══════════════════════════════════════════════════════════════════════
// Puerta ÚNICA de las rutas de WhatsApp del vertical INMUEBLES.
//
// Las cinco comprobaciones que TODA ruta de aquí necesita, en un solo sitio
// para que ninguna se le olvide a nadie:
//   1. sesión de inmuebles (el accountId sale de aquí, jamás del request);
//   2. permiso del rol (whatsapp.view para leer, whatsapp.send para mandar);
//   3. FEATURE del plan — WhatsApp vive solo en ASESOR e INMOBILIARIA. Se
//      comprueba por la feature `whatsapp`, NUNCA por el id del plan: los
//      planes se editan sin redeploy y un `plan === "ASESOR"` a mano se
//      queda viejo el día que alguien mueva la escalera;
//   4. suscripción activa;
//   5. cuenta activa.
//
// Esconder el menú NO es control de acceso: quien escriba la URL a mano
// llegaría igual. El recorte real es este.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { getRealtyContext, type RealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { isRealtySubscriptionActive, realtyPlanHasFeature } from "@/lib/realty/plan-shared";

export const REALTY_WA_FEATURE = "whatsapp";

export interface RealtyWaGateOk {
  ok: true;
  ctx: RealtyContext;
}
export interface RealtyWaGateErr {
  ok: false;
  response: NextResponse;
}
export type RealtyWaGate = RealtyWaGateOk | RealtyWaGateErr;

/**
 * 🔴 Guarda de tipo EXPLÍCITA y no `if (gate.ok)`. El repo compila con
 * `strict: false` y ahí TypeScript NO estrecha una unión por un booleano
 * discriminante: sin esto, `gate.ctx` no compila en la rama buena.
 */
export function isRealtyWaGateOk(gate: RealtyWaGate): gate is RealtyWaGateOk {
  return gate.ok === true;
}

export async function openRealtyWaGate(permission: RealtyPermissionKey): Promise<RealtyWaGate> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  if (!hasRealtyPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, permission)) {
    return { ok: false, response: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }

  if (!realtyPlanHasFeature(ctx.plan, REALTY_WA_FEATURE)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Tu plan no incluye WhatsApp.", reason: "plan" },
        { status: 403 },
      ),
    };
  }

  if (!isRealtySubscriptionActive(ctx.account)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "La suscripción no está activa.", reason: "subscription" },
        { status: 403 },
      ),
    };
  }

  if (!ctx.account.isActive) {
    return {
      ok: false,
      response: NextResponse.json({ error: "La cuenta está desactivada." }, { status: 403 }),
    };
  }

  return { ok: true, ctx };
}

/** Autoriza al cron de Vercel. Sin CRON_SECRET configurado NO se abre. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

import "server-only";
// ═══════════════════════════════════════════════════════════════════════
// Puerta ÚNICA de las rutas de CRECIMIENTO del vertical INMUEBLES
// (campañas · socios · bot · investigación de inquilino).
//
// Las cinco comprobaciones que TODA ruta del área necesita, en un solo
// sitio para que ninguna se le olvide a nadie:
//   1. sesión de inmuebles (el accountId sale de aquí, JAMÁS del request);
//   2. permiso del rol;
//   3. FEATURE del plan — por la feature, NUNCA por el id del plan;
//   4. suscripción activa;
//   5. cuenta activa.
//
// Esconder una pantalla NO es control de acceso: quien escriba la URL a
// mano llegaría igual. El recorte real es este.
//
// ⚠️ POR QUÉ VIVE BAJO bot/ Y NO EN src/app/api/realty/_server.ts: la
// allowlist de esta terminal cubre cuatro carpetas de API hermanas
// (campaigns, affiliates, bot, screening) pero ningún archivo común arriba
// de ellas; bot/ es la única CARPETA que esta terminal posee dentro de
// src/lib/realty/. Es un módulo de servidor puro: moverlo el día que haya
// un lugar mejor es cambiar la ruta del import.
//
// 🔴 SOBRE LAS FEATURES QUE SE USAN: `campaigns`, `bot` y `screening` NO
// existen en REALTY_FEATURES (plan-shared.ts), y plan-shared.ts está fuera
// de la allowlist de esta terminal. Inventar una llave nueva ahí dejaría a
// TODAS las cuentas fuera hasta correr un UPDATE sobre realty_plan_configs
// — el mismo razonamiento por el que barber reusó `whatsappInbox` para sus
// campañas. Así que se reusan las que YA existen y YA describen la puerta
// correcta:
//   · bot y campañas → `whatsappInbox` (es WhatsApp saliente: sin Inbox no
//     hay ni a quién contestarle ni con qué número mandar);
//   · investigación de inquilino → `rentals` (cuelga del contrato de renta,
//     y está en los tres planes: es ingreso que NO depende del plan);
//   · socios → `affiliates`, que YA existe y YA está en INMOBILIARIA.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { getRealtyContext, type RealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { isRealtySubscriptionActive, realtyPlanHasFeature } from "@/lib/realty/plan-shared";

/** Feature del plan que abre cada área de crecimiento. */
export const REALTY_BOT_FEATURE = "whatsappInbox";
export const REALTY_CAMPAIGNS_FEATURE = "whatsappInbox";
export const REALTY_SCREENING_FEATURE = "rentals";
export const REALTY_AFFILIATES_FEATURE = "affiliates";

export interface RealtyGrowthGateOk {
  ok: true;
  ctx: RealtyContext;
}
export interface RealtyGrowthGateErr {
  ok: false;
  response: NextResponse;
}
export type RealtyGrowthGate = RealtyGrowthGateOk | RealtyGrowthGateErr;

/**
 * 🔴 Guarda de tipo EXPLÍCITA y no `if (gate.ok)`. El repo compila con
 * `strict: false` y ahí TypeScript NO estrecha una unión por un booleano
 * discriminante: sin esto, `gate.ctx` no compila en la rama buena.
 */
export function isRealtyGrowthGateOk(gate: RealtyGrowthGate): gate is RealtyGrowthGateOk {
  return gate.ok === true;
}

export async function openRealtyGrowthGate(args: {
  permission: RealtyPermissionKey;
  feature: string;
}): Promise<RealtyGrowthGate> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  if (
    !hasRealtyPermission(
      { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
      args.permission,
    )
  ) {
    return { ok: false, response: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }

  if (!realtyPlanHasFeature(ctx.plan, args.feature)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Tu plan no incluye esta función.", reason: "plan", code: "PLAN_REQUIRED" },
        { status: 402 },
      ),
    };
  }

  if (!isRealtySubscriptionActive(ctx.account)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "La suscripción no está al corriente.", reason: "subscription" },
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

/**
 * Autoriza al cron/barrido. Sin CRON_SECRET configurado NO se abre — mismo
 * criterio que `cronAuthorized` de las rutas de WhatsApp del vertical.
 */
export function realtyGrowthCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

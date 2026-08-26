import { NextResponse } from "next/server";
import {
  RealtyForbiddenError,
  assertRealtyPermission,
  getRealtyContext,
  type RealtyContext,
  type RealtyPermissionKey,
} from "@/lib/realty-auth";
import {
  RealtyGateError,
  assertRealtyFeature,
  assertRealtySubscription,
  realtyGateErrorBody,
} from "@/lib/realty/gating";
import { getRealtyPlans } from "@/lib/realty/plans";
import { BROKER_MODES_MLS } from "@/components/realty/mls/mls-contract";

/**
 * PUERTA ÚNICA de la bolsa inmobiliaria.
 *
 * 🔴 Aquí importa más que en ningún otro módulo del vertical, porque es el
 * único sitio donde una petición puede acabar leyendo datos de otra
 * cuenta. Los CINCO cortes, en este orden y sin excepciones:
 *
 *   1. SESIÓN        → 401. De aquí sale el accountId, y de ningún otro
 *                      lado. Nunca del body, nunca del query.
 *   2. SUSCRIPCIÓN   → 402. El layout del panel no corta (hueco conocido
 *                      del vertical, documentado en gating.ts), así que
 *                      cada endpoint lo cablea. Una cuenta impaga no se
 *                      pasea por el inventario de las que sí pagan.
 *   3. MODO          → 404. Un rentista (OWNER) no comercializa para
 *                      terceros: la bolsa no existe para él. 404 y no 403
 *                      porque para esa cuenta la sección literalmente no
 *                      está — el mismo criterio que `assertRealtyArea`.
 *   4. FEATURE       → 402 con el código FEATURE_LOCKED. Se gatea por
 *                      `mls`, JAMÁS por `plan.id === "INMOBILIARIA"`.
 *   5. PERMISO       → 403.
 *
 * ── POR QUÉ 402 Y NO 403 EN LA FEATURE ─────────────────────────────────
 * El contrato escrito del vertical (gating.ts §3) dice 402 Payment
 * Required: no es que no tengas permiso, es que tu plan no lo incluye. La
 * mayoría de las rutas viejas devuelve 403 por inercia; `calc/_guard.ts`
 * ya devuelve 402. Esta ruta sigue el contrato y estrena
 * `realtyGateErrorBody`, que además manda el plan al que hay que subir.
 * La UI decide por CÓDIGO, jamás leyendo el texto.
 *
 * ── POR QUÉ properties.* Y NO UN PERMISO mls.* NUEVO ───────────────────
 * `permissionsOverride` REEMPLAZA los defaults del rol en vez de sumarse.
 * Una llave nueva no la tendría NADIE con override puesto, y esa gente se
 * quedaría fuera en silencio, sin un mensaje que explique por qué. La
 * bolsa es inventario: leerla es `properties.view` y compartir lo propio
 * es `properties.edit`.
 */
export type RealtyMlsGate = { ctx: RealtyContext } | { response: NextResponse };

export async function gateMls(permission: RealtyPermissionKey): Promise<RealtyMlsGate> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  try {
    assertRealtySubscription(ctx.account);
  } catch (e) {
    if (e instanceof RealtyGateError) {
      return { response: NextResponse.json(realtyGateErrorBody(e), { status: 402 }) };
    }
    throw e;
  }

  if (!BROKER_MODES_MLS.includes(ctx.mode)) {
    return {
      response: NextResponse.json(
        { error: "Esta sección no existe en tu tipo de cuenta.", code: "MODE_LOCKED" },
        { status: 404 },
      ),
    };
  }

  try {
    // El catálogo se pasa para que el mensaje diga a qué plan subir y
    // cuánto cuesta, con el precio LEÍDO de la tabla. Cero precios en el
    // código.
    assertRealtyFeature(ctx.plan, "mls", await getRealtyPlans());
  } catch (e) {
    if (e instanceof RealtyGateError) {
      return { response: NextResponse.json(realtyGateErrorBody(e), { status: 402 }) };
    }
    throw e;
  }

  try {
    assertRealtyPermission(ctx, permission);
  } catch (e) {
    if (e instanceof RealtyForbiddenError) {
      return {
        response: NextResponse.json(
          { error: "No tienes permiso para hacer eso.", code: "FORBIDDEN" },
          { status: 403 },
        ),
      };
    }
    throw e;
  }

  return { ctx };
}

/** Body JSON tolerante: un cuerpo vacío o roto es {} y no un 500. */
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

/**
 * 404 de la bolsa. UN SOLO mensaje para "no existe", "ya no se comparte" y
 * "es de otra cuenta y no te toca". Distinguirlos sería un oráculo: con
 * mensajes distintos, probar ids al azar te dice cuáles existen.
 */
export function mlsNotFound(): NextResponse {
  return NextResponse.json(
    { error: "Esa ficha ya no está en la bolsa.", code: "NOT_FOUND" },
    { status: 404 },
  );
}

export function mlsBadRequest(error: string, code?: string): NextResponse {
  return NextResponse.json({ error, code: code ?? "BAD_REQUEST" }, { status: 400 });
}

/** 500 con el mensaje saneado. El stack va al log del servidor, nunca al navegador. */
export function mlsApiError(scope: string, e: unknown): NextResponse {
  console.error(`[api/realty/mls/${scope}]`, e);
  return NextResponse.json({ error: "Algo salió mal. Inténtalo otra vez." }, { status: 500 });
}

/** Entero de un query param, con suelo y techo. */
export function intParam(value: string | null, fallback: number, min = 1, max = 100000): number {
  const n = Number(value ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Número libre (precios) o undefined. No fuerza suelo: un 0 es un 0. */
export function numParam(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** El valor solo si está en la lista permitida. Nada llega crudo a Prisma. */
export function enumParam<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

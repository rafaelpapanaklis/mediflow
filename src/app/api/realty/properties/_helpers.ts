import { NextResponse } from "next/server";
import {
  RealtyForbiddenError,
  assertRealtyPermission,
  getRealtyContext,
  type RealtyContext,
  type RealtyPermissionKey,
} from "@/lib/realty-auth";
import { RealtyStorageFullError, formatRealtyBytes } from "@/lib/realty/media";

/**
 * PUERTA ÚNICA de las APIs de la cartera y de los propietarios.
 *
 * Las tres comprobaciones en un solo lugar y en este orden:
 *   1. SESIÓN   → 401. De aquí sale el accountId, y de ningún otro lado.
 *   2. PLAN     → 403. La feature `properties` gatea la cartera.
 *   3. PERMISO  → 403, vía assertRealtyPermission (punto único del vertical).
 *
 * Que esté centralizado no es estética: una ruta nueva que se olvide de
 * uno de los tres cortes es una fuga entre inquilinos, y con quince rutas
 * en este módulo la probabilidad de olvidarse es alta.
 */
export type RealtyGate = { ctx: RealtyContext } | { response: NextResponse };

interface GateOptions {
  /** false para los propietarios: su item del contrato tiene featureKey null. */
  requirePlanFeature?: boolean;
}

export async function gateRealty(
  permission: RealtyPermissionKey,
  options: GateOptions = {},
): Promise<RealtyGate> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  const requireFeature = options.requirePlanFeature !== false;
  if (requireFeature && ctx.plan.features.properties !== true) {
    return {
      response: NextResponse.json(
        { error: "Tu plan todavía no incluye la cartera de inmuebles.", code: "PLAN_LOCKED" },
        { status: 403 },
      ),
    };
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

export function notFound(): NextResponse {
  return NextResponse.json({ error: "Ese inmueble ya no existe." }, { status: 404 });
}

/**
 * Error 500 con el mensaje ya saneado. El stack va al log del servidor y
 * NUNCA al navegador: una traza filtra rutas, nombres de tabla y a veces
 * fragmentos de la consulta.
 *
 * La falta de cupo se traduce aquí, en un solo sitio, para que las cinco
 * rutas que suben archivos den exactamente el mismo mensaje y el mismo
 * código (la UI decide por CÓDIGO, jamás leyendo el texto).
 */
export function realtyApiError(scope: string, e: unknown): NextResponse {
  if (e instanceof RealtyStorageFullError) {
    const libre = Math.max(0, e.quotaBytes - e.usedBytes);
    return NextResponse.json(
      {
        error:
          `Este archivo ocupa ${formatRealtyBytes(e.incomingBytes)} y solo te quedan ` +
          `${formatRealtyBytes(libre)} libres de ${formatRealtyBytes(e.quotaBytes)}. ` +
          "Borra archivos que ya no ocupes o mejora tu plan.",
        code: "STORAGE_FULL",
        used: e.usedBytes,
        quota: e.quotaBytes,
      },
      { status: 413 },
    );
  }
  console.error(`[api/realty/${scope}]`, e);
  return NextResponse.json({ error: "Algo salió mal. Inténtalo otra vez." }, { status: 500 });
}

/** Entero de un query param, con tope y suelo. */
export function intParam(value: string | null, fallback: number, min = 1, max = 100000): number {
  const n = Number(value ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** "1" → true, "0" → false, cualquier otra cosa → null (sin filtro). */
export function boolParam(value: string | null): boolean | null {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

/** El valor solo si está en la lista permitida. Nada llega crudo a Prisma. */
export function enumParam<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

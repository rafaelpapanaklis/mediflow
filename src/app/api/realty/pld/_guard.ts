// ═══════════════════════════════════════════════════════════════════════
// PUERTA ÚNICA de las rutas de cumplimiento antilavado.
//
// Las tres comprobaciones, en este orden, en un solo sitio:
//   1. SESIÓN  → 401. De aquí sale el accountId, y de ningún otro lado.
//   2. FEATURE → 403. `pld` gatea el módulo. 🔴 POR FEATURE, NUNCA POR EL
//      ID DEL PLAN: hoy la trae solo INMOBILIARIA, pero un `plan === "…"`
//      se rompe el día que se venda un complemento, y se rompe callado.
//   3. PERMISO → 403, vía assertRealtyPermission (punto único del vertical).
//
// 🔴 NO se reutiliza `gateRealty` de src/app/api/realty/properties/_helpers.ts
// por dos razones: esa puerta exige la feature `properties` con el nombre
// escrito en duro, y vive en la carpeta de otra terminal. Copiar 30 líneas
// es más barato que acoplar dos módulos que se despliegan por separado.
//
// Esconder el item del menú NO es control de acceso: quien escriba la URL
// llegaría igual. Por eso los mismos tres cortes se repiten en la página.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import {
  RealtyForbiddenError,
  assertRealtyPermission,
  getRealtyContext,
  type RealtyContext,
  type RealtyPermissionKey,
} from "@/lib/realty-auth";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { RealtyStorageFullError, formatRealtyBytes } from "@/lib/realty/media";
import { nombreDeUsuario } from "@/lib/realty/pld/bitacora";

export type PldGate = { ctx: RealtyContext; nombreUsuario: string } | { response: NextResponse };

export async function gatePld(permission: RealtyPermissionKey): Promise<PldGate> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  if (!realtyPlanHasFeature(ctx.plan, "pld")) {
    return {
      response: NextResponse.json(
        {
          error: "Tu plan todavía no incluye el módulo de cumplimiento antilavado.",
          code: "PLAN_LOCKED",
        },
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

  return { ctx, nombreUsuario: nombreDeUsuario(ctx.user) };
}

/** Body JSON tolerante: un cuerpo vacío o roto es {} y no un 500. */
export async function leerJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function malaPeticion(mensaje: string): NextResponse {
  return NextResponse.json({ error: mensaje }, { status: 400 });
}

export function noEncontrado(mensaje = "Eso ya no existe."): NextResponse {
  return NextResponse.json({ error: mensaje }, { status: 404 });
}

/**
 * Error 500 con el mensaje ya saneado. El stack va al log del servidor y
 * NUNCA al navegador: una traza filtra rutas, nombres de tabla y a veces
 * fragmentos de la consulta — y en este módulo la consulta lleva el RFC y
 * el domicilio de un tercero.
 */
export function errorPld(scope: string, e: unknown): NextResponse {
  if (e instanceof RealtyStorageFullError) {
    const libre = Math.max(0, e.quotaBytes - e.usedBytes);
    return NextResponse.json(
      {
        error:
          `Este archivo ocupa ${formatRealtyBytes(e.incomingBytes)} y solo te quedan ` +
          `${formatRealtyBytes(libre)} libres de ${formatRealtyBytes(e.quotaBytes)}. ` +
          "Borra archivos que ya no ocupes o mejora tu plan.",
        code: "STORAGE_FULL",
      },
      { status: 413 },
    );
  }
  console.error(`[api/realty/pld/${scope}]`, e);
  return NextResponse.json({ error: "Algo salió mal. Inténtalo otra vez." }, { status: 500 });
}

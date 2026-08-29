/**
 * DaleControl INSTITUCIONAL — la puerta de TODOS los endpoints del vertical.
 *
 * SERVIDOR. Existe para que ningún route handler vuelva a escribir a mano
 * la secuencia "sesión → permiso → 401/403". Repetirla en nueve archivos es
 * cómo se llega a que el décimo se salte el `assert` y nadie lo note: el
 * endpoint funciona perfectamente, solo que para todo el mundo.
 *
 * Uso, siempre igual:
 *
 *   const g = await eduApiGuard("padron.manage");
 *   if ("response" in g) return g.response;
 *   const ctx = g.ctx;                       // ← el institutionId sale de AQUÍ
 *
 * 🔴 El ctx que devuelve es la ÚNICA fuente del institutionId. Ningún
 * endpoint lo lee del body ni del query: un institutionId de fuera es una
 * escuela leyendo el padrón de otra.
 */
import { NextResponse } from "next/server";
import { getEduContext, type EduContext } from "@/lib/edu-auth";
import { assertEduPermission, EduForbiddenError, type EduPermissionKey } from "@/lib/edu/permissions";
import { EduPadronError } from "@/lib/edu/padron";

export type EduApiGuard = { ctx: EduContext } | { response: NextResponse };

export async function eduApiGuard(permission: EduPermissionKey): Promise<EduApiGuard> {
  const ctx = await getEduContext();
  if (!ctx) {
    return {
      response: NextResponse.json(
        { error: "Tu sesión caducó. Vuelve a entrar." },
        { status: 401 },
      ),
    };
  }

  try {
    assertEduPermission(ctx, permission);
  } catch (err) {
    if (err instanceof EduForbiddenError) {
      return {
        response: NextResponse.json(
          { error: `Tu cuenta no tiene el permiso ${err.permission}.` },
          { status: 403 },
        ),
      };
    }
    throw err;
  }

  return { ctx };
}

/**
 * Cuerpo JSON, o `{}` si no viene o no se puede leer.
 *
 * No revienta con un body vacío a propósito: un PATCH sin cuerpo (como el
 * de "cerrar esta supervisión") es legítimo, y las validaciones de cada
 * campo ya viven en padron-core.ts.
 */
export async function eduReadJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Traduce un error a respuesta.
 *
 * Los EduPadronError llevan su propio status y un mensaje escrito para una
 * persona ("La matrícula A-01 ya está en uso"), así que se devuelven tal
 * cual. Cualquier otro error se registra en el servidor y sale como 500 con
 * un texto genérico: el detalle de un fallo de base de datos no se le
 * enseña a un navegador.
 */
export function eduApiError(err: unknown, where: string): NextResponse {
  if (err instanceof EduPadronError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof EduForbiddenError) {
    return NextResponse.json(
      { error: `Tu cuenta no tiene el permiso ${err.permission}.` },
      { status: 403 },
    );
  }
  console.error(`[instituto] ${where} falló:`, err);
  return NextResponse.json(
    { error: "No se pudo completar la operación. Intenta de nuevo." },
    { status: 500 },
  );
}

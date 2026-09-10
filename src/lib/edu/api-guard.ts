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
import { eduMensajeP2002, EDU_TEMP_PASSWORD_ERROR } from "@/lib/edu/api-guard-core";

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

  // ── 🔴 H-03 · LA CONTRASEÑA TEMPORAL TAMBIÉN CIERRA LA API ────────────
  // El gate de `mustChangePassword` vivía SOLO en el layout del panel
  // (src/app/instituto/(panel)/layout.tsx), y un layout no protege una API:
  // quien tuviera la temporal en la mano —y la dirección se queda con 40 en
  // una tarde de altas— podía llamar directo a POST .../expediente o
  // .../recetas y firmar una nota clínica con el nombre de un alumno que
  // nunca ha entrado al sistema.
  //
  // Va ANTES del permiso a propósito: no es una cuestión de qué puede hacer
  // esta cuenta, sino de que la cuenta todavía no es de quien dice ser. Un
  // 403 con el motivo se lee mejor que un 403 de permiso que confundiría.
  //
  // La allowlist NO se comprueba aquí porque no hace falta: las tres rutas
  // exentas (cambiar contraseña, cerrar sesión, ¿es de instituto?) no pasan
  // por este guardia — resuelven la sesión ellas mismas. Están escritas, con
  // su motivo, en EDU_API_RUTAS_SIN_GUARD (api-guard-core.ts), y la prueba
  // edu-api-guard.test.ts recorre src/app/api/instituto entera para que
  // ninguna ruta nueva se salte el guardia sin quedar declarada.
  if (ctx.user.mustChangePassword) {
    return {
      response: NextResponse.json({ error: EDU_TEMP_PASSWORD_ERROR }, { status: 403 }),
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
  // ── H-107 · EL CHOQUE DE ÍNDICE ÚNICO SE LEE ──────────────────────────
  // Cinco escrituras del padrón son check-then-act (leer "¿existe ya esta
  // matrícula?" y escribir después), con su índice único detrás haciendo de
  // red. Cuando dos personas de dirección dan de alta a la vez, la segunda
  // recibía «No se pudo completar la operación» —el 500 genérico de abajo—
  // mientras la primera había leído «La matrícula ENDO-2026-07 ya está en
  // uso». El índice hacía bien su trabajo y el mensaje lo tiraba a la basura.
  //
  // 409 y no 500: no falló el servidor, se adelantó otra persona.
  if ((err as { code?: string })?.code === "P2002") {
    const target = (err as { meta?: { target?: unknown } })?.meta?.target;
    return NextResponse.json({ error: eduMensajeP2002(target) }, { status: 409 });
  }
  console.error(`[instituto] ${where} falló:`, err);
  return NextResponse.json(
    { error: "No se pudo completar la operación. Intenta de nuevo." },
    { status: 500 },
  );
}

import "server-only";

/**
 * EL PUENTE entre la sesión y el servicio de bloqueos — WS1-T2.
 *
 * Lo comparten las cuatro rutas de `/api/settings/bloqueos/*`. Existe para que
 * el `clinicId`, el rol y el permiso se resuelvan UNA sola vez y del mismo
 * modo: cuatro rutas armando su propio contexto son cuatro sitios donde se
 * puede olvidar el `clinicId` de la sesión y aceptar el del cuerpo.
 */

import { NextResponse, type NextRequest } from "next/server";
import { loadClinicSession, type ClinicSession } from "@/lib/agenda/api-helpers";
import { hasPermission } from "@/lib/auth/permissions";
import { extractAuditMeta } from "@/lib/audit";
import { BloqueoError, ctxDeSesion, type BloqueoCtx } from "./core-ctx";
import { esTablaAusente } from "./consulta.server";

export type { BloqueoCtx };
export { ctxDeSesion };

/**
 * La sesión convertida en contexto, o la respuesta de error lista para
 * devolver.
 *
 * `soloLectura`: GET solo exige `agenda.view` (quien abre la rejilla tiene que
 * poder ver POR QUÉ un hueco está cerrado — si no, llama por teléfono). Las
 * escrituras exigen además `agenda.bloqueos`.
 */
export async function contextoDeBloqueos(
  opciones: { soloLectura?: boolean } = {},
): Promise<{ ctx: BloqueoCtx; session: ClinicSession } | NextResponse> {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const usuario = {
    role: session.user.role,
    permissionsOverride: session.user.permissionsOverride ?? [],
  };

  if (!hasPermission(usuario, "agenda.view")) {
    return NextResponse.json({ error: "Permiso requerido: agenda.view" }, { status: 403 });
  }

  const puedeGestionar = hasPermission(usuario, "agenda.bloqueos");
  if (!opciones.soloLectura && !puedeGestionar) {
    return NextResponse.json({ error: "Permiso requerido: agenda.bloqueos" }, { status: 403 });
  }

  // 🔴 De la SESIÓN, nunca del cuerpo ni de la query.
  return { session, ctx: ctxDeSesion(session) };
}

/** El cuerpo JSON, o `{}` si no vino o no se entiende. */
export async function cuerpoJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export { extractAuditMeta };

/**
 * `BloqueoError` → respuesta HTTP. Cualquier otra cosa se relanza: un fallo
 * que no previmos tiene que salir en los logs como un 500 de verdad, no
 * disfrazado de 400 con un mensaje inventado.
 */
export function respuestaDeError(err: unknown): NextResponse {
  if (err instanceof BloqueoError) {
    return NextResponse.json({ error: err.codigo, mensaje: err.message }, { status: err.status });
  }
  // 🔴 LA VENTANA ENTRE LA INTEGRACIÓN Y EL SQL. El .sql de esta tarea lo
  // aplica Rafael A MANO, así que entre que el código se integra y él lo pega
  // la tabla no existe. LEER se degrada a «no hay bloqueos» (ver
  // consulta.server.ts), pero ESCRIBIR no se puede degradar: fingir que se
  // guardó dejaría a la clínica creyendo que cerró el 25 de diciembre. Se
  // dice qué falta y quién lo aplica, en vez de un 500 mudo que acaba en un
  // ticket de soporte.
  if (esTablaAusente(err)) {
    return NextResponse.json(
      {
        error: "SQL_PENDIENTE",
        mensaje:
          "Los bloqueos de agenda todavía no están activados en esta base. " +
          "Falta aplicar sql/agenda-bloqueos.sql; avisa a soporte.",
      },
      { status: 503 },
    );
  }
  throw err;
}

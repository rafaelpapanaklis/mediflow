/**
 * Las acciones de agenda de Sabina (WS1-T2), en un solo sitio para la
 * confirmación en dos fases (ws1-t1).
 *
 * ── CÓMO SE ENCHUFA ─────────────────────────────────────────────────────
 *
 *  fase 1 · el motor corre la herramienta como cualquier otra, por
 *           `correrHerramienta`. Si `datos.estado === "propuesta"`, guarda
 *           `datos.propuesta` del lado del SERVIDOR (atada a clínica y usuario,
 *           de un solo uso, con caducidad) y le da un id. Nada se escribe.
 *
 *  fase 2 · el usuario toca «Confirmar» (otra petición, con ese id):
 *             1. `revalidarPropuestaAgenda(ctx, propuesta)` con el ctx de ESA
 *                petición. Si `vigente: false`, no se ejecuta: se enseña
 *                `resultado` (otra hora, otra pregunta, sin permiso…).
 *             2. se ejecuta `propuesta.peticion` contra el route handler real
 *                (`POST /api/appointments`, `PATCH|DELETE /api/appointments/:id`).
 *             3. `interpretarRespuestaAgenda(propuesta, status, cuerpo)` da la
 *                frase. Con `reintentar: true`, se vuelve a proponer.
 *
 *  🔴 La propuesta nunca se reconstruye con lo que mande el navegador: se usa la
 *  guardada en el servidor.
 *
 * ── POR QUÉ NO ESTÁN EN `CATALOGO_SABINA` ───────────────────────────────
 * Hasta que exista la fase 2, exponerlas al modelo sería ofrecerle proponer
 * cosas que nadie puede confirmar, con un prompt que hoy le dice «solo lees».
 * Además el catálogo de lectura tiene sus pruebas de contrato (diez
 * herramientas, todas con datos sembrados); estas tienen las suyas en
 * `__tests__/agenda-acciones.test.ts`. Engancharlas es de ws1-t1.
 */

import { correrHerramienta } from "./base";
import { agendarCita } from "./agendar-cita";
import { cancelarCita } from "./cancelar-cita";
import { proponerHorarios } from "./proponer-horarios";
import { reagendarCita } from "./reagendar-cita";
import type { AccionAgenda, DatosAccionAgenda, PropuestaAgenda } from "./agenda-comun";
import type { SabinaCtx, SabinaResultado, SabinaTool } from "../tipos";

/** Las cuatro, en el orden en que conviene presentárselas al modelo. */
export const HERRAMIENTAS_AGENDA: SabinaTool[] = [proponerHorarios, agendarCita, reagendarCita, cancelarCita];

const ACCIONES: Record<AccionAgenda, SabinaTool> = {
  agendar_cita: agendarCita,
  reagendar_cita: reagendarCita,
  cancelar_cita: cancelarCita,
};

export type Revalidacion =
  | { vigente: true; propuesta: PropuestaAgenda }
  | { vigente: false; resultado: SabinaResultado<DatosAccionAgenda> };

/**
 * ¿Sigue valiendo la propuesta en el momento de confirmar?
 *
 * Vuelve a correr la MISMA herramienta con los ids ya resueltos, con la sesión
 * de quien confirma. Vale solo si sale otra vez la MISMA tarjeta: misma
 * petición, la cita como estaba (`esperado`) y los mismos avisos, frase y
 * detalle. Si entretanto salió el recordatorio o cambió el sillón, lo que el
 * usuario vio ya no es verdad y tiene que ver la tarjeta nueva. Así lo que se comprueba al
 * confirmar es exactamente lo que se comprobó al proponer: permiso, rol,
 * visibilidad, horario, sillón, solape y estado — y no una segunda copia de
 * esas reglas que con el tiempo diga otra cosa.
 *
 * No sustituye al servidor: entre esta lectura y la escritura puede entrar otra
 * cita; para eso está el 409 de la constraint y `interpretarRespuestaAgenda`.
 */
export async function revalidarPropuestaAgenda(ctx: SabinaCtx, propuesta: PropuestaAgenda): Promise<Revalidacion> {
  const tool = ACCIONES[propuesta?.accion];
  if (!tool || propuesta.revalidar?.herramienta !== propuesta.accion) {
    return { vigente: false, resultado: { ok: false, motivo: "error", detalle: "propuesta_invalida" } };
  }
  const resultado = (await correrHerramienta(tool, ctx, propuesta.revalidar.parametros)) as SabinaResultado<DatosAccionAgenda>;
  if (resultado.ok === true) {
    const datos = (resultado as { datos: DatosAccionAgenda }).datos;
    if (datos.estado === "propuesta") {
      const nueva = datos.propuesta;
      const misma = (["peticion", "esperado", "avisos", "detalle", "frase"] as const).every(
        (campo) => canonico(nueva[campo]) === canonico(propuesta[campo]),
      );
      if (misma) return { vigente: true, propuesta: nueva };
    }
  }
  return { vigente: false, resultado };
}

/**
 * JSON con las claves ordenadas: la propuesta guardada puede volver de un
 * `jsonb` con otro orden de claves, y eso no la hace distinta.
 */
function canonico(valor: unknown): string {
  return JSON.stringify(valor ?? null, (_clave, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

export { agendarCita, cancelarCita, proponerHorarios, reagendarCita };
export { interpretarRespuestaAgenda, type RespuestaInterpretada } from "./agenda-respuestas";
export { resolverCita, resolverDoctor, resolverPaciente } from "./agenda-resolvedores";
export type { DatosAccionAgenda, PreguntaAgenda, PropuestaAgenda } from "./agenda-comun";
export type { DatosProponerHorarios } from "./proponer-horarios";

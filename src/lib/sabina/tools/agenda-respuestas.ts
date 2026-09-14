/**
 * Qué devolvió el endpoint, en UNA frase para el usuario — la fase 2 de las
 * acciones de agenda.
 *
 * La confirmación (ws1-t1) ejecuta `propuesta.peticion` contra el route handler
 * y le pasa aquí el status y el cuerpo. Las tablas de errores son las del MAPA
 * (§1–§3) contra el código de hoy, incluidos los códigos que añadió #248
 * (`missing_reason`, `appointment_in_past`, `patient_archived`,
 * `appointment_not_movable`).
 *
 * Tres familias que NO se pueden confundir:
 *  · «no tienes permiso» → 403. `"forbidden"` es el ROL; `"Permiso requerido: X"`
 *    es la KEY que quitó el administrador. Frases distintas.
 *  · «ya hay una cita ahí» → 409 `appointment_overlap`. `reintentar: true`: se
 *    recalculan horas y se vuelve a proponer, nunca «ya quedó».
 *  · «no se pudo» → 400 / 500. 🔴 El texto interno (`error` de un 500 puede ser el
 *    mensaje de Prisma) jamás se repite.
 *
 * Pura: sin base, sin red.
 */

import { ALL_PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { PropuestaAgenda } from "./agenda-comun";

export type MotivoRespuesta =
  | "hecho"
  | "sin_sesion"
  | "sin_permiso"
  | "solape"
  | "no_encontrado"
  | "regla"
  | "sillon_no_disponible"
  | "transicion_invalida"
  | "datos"
  | "error_sistema";

export interface RespuestaInterpretada {
  ok: boolean;
  motivo: MotivoRespuesta;
  /** Lista para decirla tal cual. */
  frase: string;
  /** `true` si lo correcto es recalcular horas y proponer de nuevo (solape). */
  reintentar: boolean;
  /**
   * `true` si el fallo es de CÓMO armó Sabina la petición (400), no del usuario:
   * hay que registrarlo como fallo de Sabina.
   */
  falloDeSabina: boolean;
}

const VERBO: Record<PropuestaAgenda["accion"], { hecho: string; infinitivo: string }> = {
  agendar_cita: { hecho: "Listo, quedó agendada", infinitivo: "agendar" },
  reagendar_cita: { hecho: "Listo, la cita quedó movida", infinitivo: "mover la cita" },
  cancelar_cita: { hecho: "Listo, la cita quedó cancelada", infinitivo: "cancelar la cita" },
};

const ESTADOS: Record<string, string> = {
  PENDING: "pendiente",
  SCHEDULED: "agendada",
  CONFIRMED: "confirmada",
  CHECKED_IN: "llegó",
  IN_CHAIR: "en sillón",
  IN_PROGRESS: "en consulta",
  COMPLETED: "completada",
  CHECKED_OUT: "salió",
  CANCELLED: "cancelada",
  NO_SHOW: "no asistió",
};

export function interpretarRespuestaAgenda(
  propuesta: Pick<PropuestaAgenda, "accion" | "frase" | "permiso">,
  status: number,
  body: unknown,
): RespuestaInterpretada {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, any>;
  const error = typeof b.error === "string" ? b.error : "";
  const verbo = VERBO[propuesta.accion];
  const r = (motivo: MotivoRespuesta, frase: string, extra: Partial<RespuestaInterpretada> = {}): RespuestaInterpretada => ({
    ok: false, motivo, frase, reintentar: false, falloDeSabina: false, ...extra,
  });

  if (status >= 200 && status < 300) {
    const aviso = b.scheduleWarning && typeof b.scheduleWarning.message === "string" ? ` ${b.scheduleWarning.message}` : "";
    return { ok: true, motivo: "hecho", frase: `${verbo.hecho}.${aviso}`, reintentar: false, falloDeSabina: false };
  }

  // `loadClinicSession` atrapa también las redirecciones de 2FA y de plan
  // vencido y las devuelve como 401: la frase no puede dar por hecho que fue la sesión.
  if (status === 401) {
    return r("sin_sesion", "No pude comprobar tu acceso (la sesión se cerró, falta la verificación en dos pasos o el plan está suspendido). No se guardó nada.");
  }

  if (status === 403) {
    const key = /^Permiso requerido: (.+)$/.exec(error)?.[1];
    if (key) {
      const nombre = (ALL_PERMISSIONS as Record<string, string>)[key as PermissionKey] ?? key;
      return r("sin_permiso", `No tienes el permiso «${nombre}»; lo da el administrador en Equipo. No se guardó nada.`);
    }
    if (error === "not_your_appointment") return r("sin_permiso", "Esa cita es de otro doctor; solo puedes mover las tuyas.");
    if (error === "override_not_allowed_for_role") {
      return r("sin_permiso", "No se pudo guardar: la petición llevaba un permiso especial que Sabina no debe usar.", { falloDeSabina: true });
    }
    if (error === "forbidden" && typeof b.reason === "string") {
      return r("sin_permiso", "A estas alturas solo un administrador puede cancelar esa cita. No se canceló.");
    }
    return r("sin_permiso", `Tu rol no permite ${verbo.infinitivo}. No se guardó nada.`);
  }

  if (status === 409 && error === "appointment_overlap") {
    // Nunca el nombre de `conflictingAppointment`: la ruta solo lo enmascara si
    // el paciente es restringido, y a un DOCTOR le revelaría quién ocupa el
    // sillón de otro doctor. Basta con decir que está ocupado.
    return r("solape", "Esa hora se ocupó mientras tanto: ya hay otra cita ahí. No se guardó; te busco otra hora.", { reintentar: true });
  }

  if (status === 409 && error === "invalid_transition") {
    const de = /de (\w+) a/.exec(typeof b.reason === "string" ? b.reason : "")?.[1];
    return r("transicion_invalida", `Esa cita ya está ${de ? `«${ESTADOS[de] ?? de.toLowerCase()}»` : "cerrada"}; no se puede ${verbo.infinitivo}.`);
  }

  // Las reglas de #248 traen su frase en `reason`, escrita para enseñarse tal cual.
  if (["missing_reason", "appointment_in_past", "patient_archived", "appointment_not_movable"].includes(error)) {
    const frase = typeof b.reason === "string" && b.reason ? b.reason : "La cita no cumple las reglas de la agenda.";
    return r("regla", `${frase} No se guardó.`, { falloDeSabina: error === "missing_reason" });
  }

  if (status === 404) {
    if (error === "patient_not_found") return r("no_encontrado", "No encuentro a ese paciente entre los que puedes ver. No se guardó nada.");
    if (error === "doctor_not_found") return r("no_encontrado", "Ese doctor ya no está disponible para agendar. No se guardó nada.");
    if (error === "resource_not_found") return r("no_encontrado", "Ese sillón ya no está activo. No se guardó nada.");
    return r("no_encontrado", "No encuentro esa cita. No se guardó nada.");
  }

  if (status === 422 && error === "resource_unavailable") {
    return r(
      "sillon_no_disponible",
      b.reason === "resource_closed_this_day"
        ? "Ese sillón no trabaja ese día. No se guardó; te busco otra hora."
        : "Ese sillón no atiende a esa hora. No se guardó; te busco otra hora.",
      { reintentar: true },
    );
  }

  if (status === 400) {
    return r("datos", `No pude ${verbo.infinitivo}: me faltó un dato al armar la petición. No se guardó nada.`, { falloDeSabina: true });
  }

  return r("error_sistema", `No se pudo ${verbo.infinitivo} por un error del sistema; no se guardó nada. Inténtalo en un momento.`);
}

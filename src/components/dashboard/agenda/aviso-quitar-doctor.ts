/**
 * ws1-t11 · P2 v2 — ¿se puede SOLTAR esta cita en la columna «Sin doctor»? (agenda nueva y clásica)
 *
 * Devuelve la clave del aviso (i18n `agenda.sinDoctor.avisos.*`) si el servidor la rechazaría, o `null` si se
 * puede. Así la tarjeta no va y vuelve con un error genérico («No se pudo reagendar»):
 *  · una teleconsulta nunca es «Sin doctor» (D11; 400 `teleconsult_requires_doctor`);
 *  · una cita en consulta no se queda sin doctor (409);
 *  · un DOCTOR no deja SU cita «Sin doctor»: eso es de recepción (P1 v2, m6: 403 `not_your_appointment`).
 *
 * Solo mira el caso «tenía doctor y se le quita». Puro: se prueba solo.
 */
import { esEstadoQueExigeDoctor } from "@/lib/agenda/sin-doctor";

export type AvisoQuitarDoctor =
  | "agenda.sinDoctor.avisos.teleconsulta"
  | "agenda.sinDoctor.avisos.enConsulta"
  | "agenda.sinDoctor.avisos.doctorPropia";

export function avisoAlQuitarDoctor(
  original: { doctor?: { id: string } | null; status: string; isTeleconsult?: boolean | null },
  nuevoDoctorId: string | null,
  rol?: string | null,
): AvisoQuitarDoctor | null {
  const antes = original.doctor?.id ?? null;
  if (nuevoDoctorId !== null || antes === null) return null;
  if (original.isTeleconsult === true) return "agenda.sinDoctor.avisos.teleconsulta";
  if (esEstadoQueExigeDoctor(String(original.status))) return "agenda.sinDoctor.avisos.enConsulta";
  if (rol === "DOCTOR") return "agenda.sinDoctor.avisos.doctorPropia";
  return null;
}

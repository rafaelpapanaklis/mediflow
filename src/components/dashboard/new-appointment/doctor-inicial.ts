/**
 * ws1-t11 · fase 2 · P2 — con qué doctor abre «Nueva cita» (decisión D1 del plan).
 *
 *  · El clic en la columna o el hueco de un doctor trae ese doctor: el clic ya lo eligió.
 *  · El clic en la columna «Sin doctor» trae `initialSlot.doctorId === null`: «Sin doctor».
 *  · Un candidato explícito (el tratante de «Agendar próxima», el doctor del plan…) se usa
 *    si puede recibir citas (lo de siempre, ws1-t10).
 *  · Sin preferencia (los botones genéricos «Nueva cita»): «Sin doctor».
 *
 * Mientras no se pegue `sql/cita-sin-doctor.sql` (`sinDoctorDisponible` falso), la opción no
 * existe y todo queda como hoy: el primer candidato que reciba citas, o el primero de la lista.
 *
 * El `<select>` necesita un string: «Sin doctor» viaja como `OPCION_SIN_DOCTOR` y se convierte
 * en `null` justo antes del POST (`doctorIdParaEnviar`).
 */
import { FILTRO_SIN_DOCTOR } from "@/lib/agenda/sin-doctor";

/** Valor de la opción «Sin doctor» en los selectores. No es un id de la base (es el del filtro de la agenda). */
export const OPCION_SIN_DOCTOR: string = FILTRO_SIN_DOCTOR;

export function esOpcionSinDoctor(v: string | null | undefined): boolean {
  return v === OPCION_SIN_DOCTOR;
}

export function doctorInicialDeNuevaCita(args: {
  /** `initialSlot.doctorId`: `null` = se hizo clic en la columna «Sin doctor»; `undefined` = no vino. */
  delHueco: string | null | undefined;
  /** Los demás candidatos en orden (`initialDoctorId`, `initialDoctorIds`). */
  candidatos: ReadonlyArray<string | null | undefined>;
  /** Quien puede recibir citas (las opciones del selector). */
  lista: ReadonlyArray<string>;
  sinDoctorDisponible: boolean;
}): string {
  const { delHueco, candidatos, lista, sinDoctorDisponible } = args;
  if (sinDoctorDisponible && delHueco === null) return OPCION_SIN_DOCTOR;
  for (const id of [delHueco, ...candidatos]) if (id && lista.includes(id)) return id;
  if (sinDoctorDisponible) return OPCION_SIN_DOCTOR;
  return lista[0] ?? "";
}

/** Lo que va en el cuerpo del POST/PATCH: `null` = «Sin doctor»; "" = no se eligió nada (el 400 de siempre). */
export function doctorIdParaEnviar(v: string): string | null {
  return esOpcionSinDoctor(v) ? null : v;
}

/** El id real (o `null`) para las cuentas de la pantalla: rejilla, bloqueos, choques. */
export function doctorRealDe(v: string): string | null {
  return v && !esOpcionSinDoctor(v) ? v : null;
}

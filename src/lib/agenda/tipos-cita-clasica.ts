/**
 * WS1-T4 ronda 6 · G6 — tipos de cita que ofrece la agenda CLÁSICA
 * (/dashboard/appointments) según el giro de la clínica.
 *
 * La lista nació multi-especialidad. En una clínica DENTAL no se ofrecen
 * «Nutrición» ni «Psicología»; las demás categorías ven la lista de siempre.
 * No se borra ninguna opción: solo se deja de OFRECER en dental.
 *
 * Archivo puro. La categoría la pasa el servidor (page.tsx, de la sesión).
 */

/** La lista de siempre, en su orden. Son los textos que se guardan en `Appointment.type`. */
export const TIPOS_CITA_CLASICA: readonly string[] = [
  "Consulta general", "Primera vez", "Revisión / Control", "Limpieza dental", "Extracción",
  "Endodoncia", "Ortodoncia", "Implante", "Cirugía", "Nutrición", "Psicología", "Seguimiento", "Otro",
];

/** Tipos que NO se ofrecen en una clínica dental. */
const FUERA_EN_DENTAL: readonly string[] = ["Nutrición", "Psicología"];

/**
 * Los tipos que se pintan en el selector.
 *
 * @param categoria  `Clinic.category`, del servidor. Sin ella, la lista entera.
 * @param tipoActual el tipo que YA tiene la cita que se edita. Si quedó fuera
 *                   de la lista (una cita vieja de «Nutrición» en una clínica
 *                   dental, o un tipo que puso el bot) se añade al final: si no,
 *                   el selector enseñaría otra opción y al guardar le cambiaría
 *                   el tipo a la cita sin que nadie lo pidiera.
 */
export function tiposDeCitaParaCategoria(
  categoria: string | null | undefined,
  tipoActual?: string | null,
): string[] {
  const lista = categoria === "DENTAL"
    ? TIPOS_CITA_CLASICA.filter((t) => !FUERA_EN_DENTAL.includes(t))
    : [...TIPOS_CITA_CLASICA];
  if (tipoActual && !lista.includes(tipoActual)) lista.push(tipoActual);
  return lista;
}

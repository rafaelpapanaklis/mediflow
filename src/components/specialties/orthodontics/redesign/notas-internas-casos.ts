// Las «Notas internas» que ve recepción (ws1-t8 · N-P5, N3-P4). PURO.
//
// Recepción ve las notas de TODOS los casos vivos del paciente, no solo las del último: la nota «no llamarle después de
// las 6» puede estar en el caso anterior. Con un solo caso no se rotula; con varios, cada bloque dice a qué caso
// pertenece, con la fecha en la ZONA DE LA CLÍNICA y el mes en el idioma de la interfaz.

const ZONA_POR_DEFECTO = "America/Mexico_City";

/** «5 oct 2026» / «Oct 5, 2026»: el día en que se abrió el caso EN LA CLÍNICA (un caso abierto a las 19:00 del 5 no es del 6). */
export function fechaCortaDeCaso(abiertoIso: string, locale: string, timeZone: string | null | undefined): string {
  const d = new Date(abiertoIso);
  if (Number.isNaN(d.getTime())) return "";
  const formato = (tz: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(d);
  try {
    return formato(timeZone || ZONA_POR_DEFECTO);
  } catch {
    return formato(ZONA_POR_DEFECTO); // una zona que Intl no conoce no tumba la ficha
  }
}

export interface BloqueDeNotas {
  caseId: string | null;
  etiquetaCaso?: string;
}

/**
 * @param etiquetar recibe la fecha de apertura (ISO) y devuelve el rótulo ya traducido («caso abierto el 5 oct 2026»).
 */
export function bloquesDeNotas(
  casos: ReadonlyArray<{ id: string; abierto: string }> | undefined,
  casoId: string | null,
  etiquetar: (abiertoIso: string) => string,
): BloqueDeNotas[] {
  const lista = casos && casos.length > 0 ? casos : casoId ? [{ id: casoId, abierto: "" }] : [];
  if (lista.length === 0) return [{ caseId: null }];
  return lista.map((c) => ({ caseId: c.id, ...(lista.length > 1 ? { etiquetaCaso: etiquetar(c.abierto) } : {}) }));
}

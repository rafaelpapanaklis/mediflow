// Las «Notas internas» que ve recepción (ws1-t8 · N-P5). PURO.
//
// Recepción ve las notas de TODOS los casos vivos del paciente, no solo las del último: la nota «no llamarle después de
// las 6» puede estar en el caso anterior. Con un solo caso no se rotula; con varios, cada bloque dice a qué caso
// pertenece.

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «caso abierto el 5 oct 2026». La fecha de calendario no lleva zona: se pinta tal cual viene (YYYY-MM-DD…). */
export function etiquetaDeCaso(abiertoIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(abiertoIso ?? "");
  if (!m) return "caso";
  return `caso abierto el ${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

export interface BloqueDeNotas {
  caseId: string | null;
  etiquetaCaso?: string;
}

export function bloquesDeNotas(
  casos: ReadonlyArray<{ id: string; abierto: string }> | undefined,
  casoId: string | null,
): BloqueDeNotas[] {
  const lista = casos && casos.length > 0 ? casos : casoId ? [{ id: casoId, abierto: "" }] : [];
  if (lista.length === 0) return [{ caseId: null }];
  return lista.map((c) => ({ caseId: c.id, ...(lista.length > 1 ? { etiquetaCaso: etiquetaDeCaso(c.abierto) } : {}) }));
}

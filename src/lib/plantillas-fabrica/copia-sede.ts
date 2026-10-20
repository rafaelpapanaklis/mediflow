// Plantillas de documentos que viajan a una sede nueva (ws1-t8 · N-P10). PURO.
//
// La sede nueva recibe una COPIA de las plantillas de la sede de origen. Las que la clínica escribió llevan por autor
// al dueño de la sede nueva; las de fábrica (sin autor) siguen SIN autor, porque sin autor son «de fábrica» y solo
// así la sede nueva puede ofrecer «Volver a la de fábrica» en sus consentimientos.

export interface PlantillaParaCopiar {
  name: string;
  body: string;
  isActive: boolean;
  createdById: string | null;
}

export function plantillasParaSedeNueva<K extends string>(
  filas: readonly PlantillaParaCopiar[],
  kind: K,
  destinoId: string,
  destinoOwnerUserId: string,
) {
  return filas.map((f) => ({
    name: f.name,
    body: f.body,
    isActive: f.isActive,
    kind,
    clinicId: destinoId,
    createdById: f.createdById ? destinoOwnerUserId : null,
  }));
}

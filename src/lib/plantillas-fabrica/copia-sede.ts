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

/**
 * Las plantillas con imágenes del editor nuevo llevan claves de la carpeta de la
 * sede de ORIGEN (`documentos/<origen>/…`); en la sede nueva darían 404. Antes de
 * copiarlas, cada imagen se copia a la carpeta de la sede nueva y el cuerpo se
 * reescribe con las claves nuevas (`copiar`, que en el servidor es
 * `copiarImagenesEntreClinicas`). Una por una y solo las que traen imágenes: es
 * trabajo del bucket, no de la base.
 */
export async function conImagenesDeLaSedeNueva<T extends { body: string }>(
  filas: readonly T[],
  copiar: (body: string) => Promise<string>,
): Promise<T[]> {
  const salida: T[] = [];
  for (const f of filas) salida.push(f.body.includes("data-archivo") ? { ...f, body: await copiar(f.body) } : f);
  return salida;
}

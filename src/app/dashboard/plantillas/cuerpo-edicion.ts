// Lo que el editor de Plantillas MANDA al guardar una edición (ws1-t8 · N-P3 y N-P4). PURO: sin React, para que lo
// ejecuten las pruebas.
//
// Regla: solo viaja lo que la persona cambió respecto de lo que cargó al abrir el editor. Así una pestaña que se abrió
// hace rato y guarda «sin tocar nada» no revierte lo que otra persona guardó mientras tanto (el texto, la liga a
// procedimientos…); y el servidor, que compara contra lo vigente, no tiene que adivinar qué se quiso cambiar.

import { SECCIONES_SOAP, type CuerpoSoap } from "@/lib/orthodontics/plantillas-nota";

/** Notas de ortodoncia: el nombre y el SOAP solo si cambiaron. */
export function cuerpoEdicionNotaOrto(
  cargada: { name: string; soap: CuerpoSoap },
  editada: { name: string; soap: CuerpoSoap },
): { name?: string; soap?: CuerpoSoap } {
  return {
    ...(editada.name !== cargada.name ? { name: editada.name } : {}),
    ...(SECCIONES_SOAP.some((s) => editada.soap[s] !== cargada.soap[s]) ? { soap: editada.soap } : {}),
  };
}

const mismaLiga = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Indicaciones y constancia: nombre, texto y liga a procedimientos, cada uno solo si cambió. */
export function cuerpoEdicionHoja(
  cargada: { nombre: string; cuerpo: string; procedureIds: readonly string[] },
  editada: { nombre: string; cuerpo: string; procedureIds: readonly string[] },
  conLiga: boolean,
): { nombre?: string; cuerpo?: string; procedureIds?: string[] } {
  return {
    ...(editada.nombre !== cargada.nombre ? { nombre: editada.nombre } : {}),
    ...(editada.cuerpo !== cargada.cuerpo ? { cuerpo: editada.cuerpo } : {}),
    ...(conLiga && !mismaLiga(editada.procedureIds, cargada.procedureIds) ? { procedureIds: [...editada.procedureIds] } : {}),
  };
}

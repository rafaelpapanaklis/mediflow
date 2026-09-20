// «Usar una plantilla» a mitad de escribir. PURO (sin DOM) para poder probarlo.
//
// La regla, la misma en toda la app: lo que el doctor ya escribió NO se pisa.
// Con la hoja vacía la plantilla la rellena; con texto, la plantilla se AÑADE
// debajo y se avisa. Nunca se pregunta «¿reemplazar?»: un clic de más en una
// consulta es justo cómo se pierde una nota.
//
// El resultado vuelve al editor y de ahí al servidor, que lo sanea con la lista
// blanca al guardar: aquí no se sanea ni se confía en nada.

export interface HojaCombinada {
  html: string;
  /** `true` = había texto y la plantilla fue debajo (para avisarlo). */
  anadida: boolean;
}

/**
 * @param escritoHtml  el `innerHTML` del editor
 * @param escritoTexto su `textContent`: un `<p><br></p>` tiene HTML pero no texto
 * @param plantillaHtml la plantilla ya rellenada por el servidor
 */
export function combinarConPlantilla(escritoHtml: string, escritoTexto: string, plantillaHtml: string): HojaCombinada {
  if (!escritoTexto.trim()) return { html: plantillaHtml, anadida: false };
  return { html: `${escritoHtml}${plantillaHtml}`, anadida: true };
}

// Textos de la vista «sin caso» de la pestaña Ortodoncia según si el paciente tiene casos MIGRADOS del sistema anterior.
// Funciones puras para poder probarlos: un paciente con solo casos migrados no «no tiene caso de ortodoncia» —
// no tiene caso ACTIVO, y sí tiene historia de otro sistema.

/** «1 caso anterior migrado» / «3 casos anteriores migrados». */
export function casosAnterioresMigrados(n: number): string {
  return n === 1 ? "1 caso anterior migrado" : `${n} casos anteriores migrados`;
}

export function tituloSinCaso(nombre: string, migrados: number): string {
  return migrados > 0
    ? `Sin caso activo · tiene ${casosAnterioresMigrados(migrados)}`
    : `${nombre} no tiene caso de ortodoncia`;
}

export function pistaSinCaso(migrados: number, desdeConsulta: boolean): string {
  if (desdeConsulta) {
    return "La consulta de ortodoncia se registra en la hoja de control de su caso. Ábrele uno y después registra el control.";
  }
  if (migrados > 0) {
    return "Su historia del sistema anterior está debajo, solo lectura. Al abrir un caso nuevo se registran el diagnóstico y el plan de tratamiento; después aparecen aquí sus controles, sus fotos, el cobro y la retención.";
  }
  return "Al abrirlo se registran el diagnóstico y el plan de tratamiento. Después aparecen aquí sus controles, sus fotos, el cobro y la retención.";
}

export function etiquetaAbrirCaso(migrados: number): string {
  return migrados > 0 ? "Abrir caso nuevo" : "Abrir caso de ortodoncia";
}

/** La línea bajo el título del botón «Abrir caso de ortodoncia»: qué pasa al pulsarlo (ws1-t10). */
export const LINEA_DEL_BOTON_ABRIR_CASO = "Diagnóstico, datos del caso y plan de pago, en una sola ventana.";

/** ws1-t10 (D): lo que dice la vista «sin caso» entre que el caso se abre y llega la ficha refrescada. */
export const TITULO_CASO_ABIERTO = "Caso abierto";
export const PISTA_CASO_ABIERTO = "Estamos cargando su ficha de ortodoncia: en unos segundos aparecen el plan, los controles y el cobro.";

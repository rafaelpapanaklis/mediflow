// Tablero de Ortodoncia → «Casos con diagnóstico o plan incompleto»: el contador y la lista salen de la MISMA
// consulta (`cargarCasosIncompletos`), pero la lista recortaba a 5 sin decirlo: contador 6, lista 5 (revisión de
// Chrome, ws1-t9 #8). Ahora la lista enseña hasta LIMITE_LISTA_INCOMPLETOS y, si hay más, lo dice y enlaza a todos.
//
// PURO: sin React ni Prisma.

export const LIMITE_LISTA_INCOMPLETOS = 10;

export function recorteDeIncompletos<T>(casos: readonly T[], limite = LIMITE_LISTA_INCOMPLETOS): {
  visibles: T[];
  ocultos: number;
  /** «Mostrando 10 de 14» cuando se recorta; null cuando la lista trae todos (contador = lista). */
  leyenda: string | null;
} {
  const visibles = casos.slice(0, limite);
  const ocultos = casos.length - visibles.length;
  return {
    visibles,
    ocultos,
    leyenda: ocultos > 0 ? `Mostrando ${visibles.length} de ${casos.length}` : null,
  };
}

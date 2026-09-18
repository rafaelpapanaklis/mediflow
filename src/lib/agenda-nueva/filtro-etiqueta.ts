/**
 * Qué dice el botón del filtro de doctores y unidades de la barra de la
 * agenda nueva.
 *
 * Rafael (ws1-t3): «donde dice todos los doctores y unidades borra la letra y
 * solo deja el icono de filtrar». Así que, sin filtro, el botón es SOLO el
 * ícono: la letra visible desaparece. Pero un ícono suelto no dice qué filtra
 * ni qué está marcado, y «nada se esconde» (Ley 3): el nombre completo va
 * siempre en `title` y `aria-label`, y en cuanto hay algo desmarcado el botón
 * enseña la selección («Dra. Díaz · 2 unidades»), que es lo que la
 * recepcionista necesita ver sin abrir nada.
 *
 * Sin React a propósito: lo prueba `test:agenda-nueva-filtro` en node.
 */

export interface EstadoDelFiltro {
  /** ¿La clínica tiene unidades dentales en la agenda? */
  hayUnidades: boolean;
  /** ¿No hay nada desmarcado? */
  todoMarcado: boolean;
  /** Doctores marcados (visibles). */
  nDocs: number;
  /** Nombre corto del único doctor marcado, si es exactamente uno. */
  nombreUnico?: string | null;
  /** Unidades marcadas (visibles) y unidades que hay en total. */
  nUnidades: number;
  nUnidadesTotal: number;
}

export interface TextoDelFiltro {
  /** Lo que se pinta junto al ícono. `null` = solo el ícono. */
  visible: string | null;
  /** El nombre accesible del botón (`title` y `aria-label`). Nunca vacío. */
  accesible: string;
}

/** Qué filtra el botón, para el globo y el lector de pantalla. */
export function nombreDelFiltro(hayUnidades: boolean): string {
  return hayUnidades ? "Filtrar doctores y unidades" : "Filtrar doctores";
}

/** La selección en corto: «Dra. Díaz», «2 doctores · 1 unidad», «Ningún doctor». */
export function resumenDeSeleccion(e: EstadoDelFiltro): string {
  const parteDocs =
    e.nDocs === 0
      ? "Ningún doctor"
      : e.nDocs === 1
        ? (e.nombreUnico ?? "1 doctor")
        : `${e.nDocs} doctores`;

  if (!e.hayUnidades || e.nUnidades === e.nUnidadesTotal) return parteDocs;

  const parteUnidades =
    e.nUnidades === 0 ? "ninguna unidad" : e.nUnidades === 1 ? "1 unidad" : `${e.nUnidades} unidades`;

  return `${parteDocs} · ${parteUnidades}`;
}

export function textoDelFiltro(e: EstadoDelFiltro): TextoDelFiltro {
  const nombre = nombreDelFiltro(e.hayUnidades);
  if (e.todoMarcado) {
    return { visible: null, accesible: `${nombre}: todos` };
  }
  const resumen = resumenDeSeleccion(e);
  return { visible: resumen, accesible: `${nombre}: ${resumen}` };
}

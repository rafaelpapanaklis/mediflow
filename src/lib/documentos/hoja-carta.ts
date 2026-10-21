// Las medidas de la hoja Carta en que se escriben y se imprimen los documentos
// (plantillas, notas de evolución, consentimientos). Es el ÚNICO sitio donde
// viven: el editor las lee para dibujar los saltos de hoja en pantalla, la hoja
// de lectura para medir, y el generador de PDF (ola 2) las escribe en `@page`.
// Si pantalla y papel miden distinto, no coinciden; por eso no hay copias.
//
// Todo en píxeles CSS a 96 ppp (una carta de 8.5 × 11 in = 816 × 1056 px),
// exactamente lo que enseña la maqueta aprobada el 20-oct-2026
// (`--hoja-ancho`, `--m-sup`, `--m-lat`, `--cab-alto`, `--pie-alto`…).
//
// PURO: sin DOM, sin React, sin Next. Lo prueba `__tests__/hoja-carta.test.ts`.

/** Píxeles CSS por pulgada. */
export const PPP = 96;

export interface MedidasHoja {
  /** Ancho y alto del papel, en px. */
  ancho: number;
  alto: number;
  /** Margen superior: del borde al membrete. */
  margenSuperior: number;
  /** Márgenes izquierdo y derecho (iguales). */
  margenLateral: number;
  /** Margen inferior: el pie de página («clínica · tipo · Página n de m») cabe dentro de él. */
  margenInferior: number;
  /** Alto del membrete de la clínica, que va en TODAS las hojas (decisión 3 de Rafael). */
  membreteAlto: number;
  /** Alto del pie de página, dibujado dentro del margen inferior. */
  pieAlto: number;
  /** La «mesa» gris que se ve entre dos hojas en pantalla (no existe en papel). */
  mesaEntre: number;
}

/** Carta, 8.5 × 11 in. Las medidas de la maqueta, una por una. */
export const HOJA_CARTA: Readonly<MedidasHoja> = Object.freeze({
  ancho: 816,
  alto: 1056,
  margenSuperior: 72,
  margenLateral: 86,
  margenInferior: 72,
  membreteAlto: 96,
  pieAlto: 28,
  mesaEntre: 28,
});

/** Lo que cabe de texto en cada hoja, de alto: del final del membrete al principio del margen inferior. */
export function altoUtil(h: Readonly<MedidasHoja> = HOJA_CARTA): number {
  return h.alto - h.margenSuperior - h.membreteAlto - h.margenInferior;
}

/** Ancho del texto: el papel menos los dos márgenes laterales. */
export function anchoUtil(h: Readonly<MedidasHoja> = HOJA_CARTA): number {
  return h.ancho - 2 * h.margenLateral;
}

/** Variables CSS (`--hoja-*`) para el `style` del contenedor de la hoja; el CSS las lee y nunca repite el número. */
export function variablesCssHoja(h: Readonly<MedidasHoja> = HOJA_CARTA): Record<string, string> {
  return {
    "--hoja-ancho": `${h.ancho}px`,
    "--hoja-alto": `${h.alto}px`,
    "--hoja-m-sup": `${h.margenSuperior}px`,
    "--hoja-m-lat": `${h.margenLateral}px`,
    "--hoja-m-inf": `${h.margenInferior}px`,
    "--hoja-cab-alto": `${h.membreteAlto}px`,
    "--hoja-pie-alto": `${h.pieAlto}px`,
    "--hoja-mesa-entre": `${h.mesaEntre}px`,
  };
}

/** Píxeles CSS a pulgadas con tres decimales («0.896in»), para `@page` del PDF. */
export function pxAPulgadas(px: number): string {
  return `${(Math.round((px / PPP) * 1000) / 1000).toString().replace(/^0\./, ".")}in`;
}

/**
 * Lo que el generador de PDF (P5, ola 2) escribe en `@page`: tamaño carta y los
 * márgenes de la hoja. El pie va en los cuadros de margen (`@bottom-left` /
 * `@bottom-right`), dentro del margen inferior, como en pantalla.
 */
export function paginaPdf(h: Readonly<MedidasHoja> = HOJA_CARTA): { tamano: "letter"; margen: string } {
  return {
    tamano: "letter",
    margen: `${pxAPulgadas(h.margenSuperior)} ${pxAPulgadas(h.margenLateral)} ${pxAPulgadas(h.margenInferior)} ${pxAPulgadas(h.margenLateral)}`,
  };
}

// ── Paginación: dónde cortar entre bloques ──────────────────────────────────

/** Un bloque de primer nivel ya medido en pantalla (alto con sus márgenes). */
export interface BloqueMedido {
  /** Alto en px, márgenes incluidos. */
  alto: number;
  /** Es el nodo «Nueva página»: lo que sigue empieza en otra hoja. */
  saltoManual?: boolean;
}

export interface Paginado {
  /** Índices de los bloques ANTES de los cuales empieza una hoja nueva (ordenados, sin repetir). */
  saltosAntesDe: number[];
  /** Cuántas hojas quedan. Siempre ≥ 1. */
  paginas: number;
  /** Lo que sobra en la última hoja, para rellenarla y que el papel termine donde termina. */
  relleno: number;
}

/**
 * Reparte bloques en hojas. Corta ENTRE bloques, nunca dentro de uno: un
 * párrafo más alto que el hueco que queda se va entero a la siguiente hoja (y
 * si es más alto que una hoja, se queda solo en la suya y se desborda; el PDF
 * sí lo parte). Un «Nueva página» cierra la hoja aunque sobre sitio, salvo que
 * sea lo último del documento: no se abre una hoja vacía.
 *
 * `extraPrimera` es lo que ocupa en la primera hoja el bloque paciente/doctor
 * y el título, que no son bloques del editor.
 */
export function paginar(
  bloques: readonly BloqueMedido[],
  opciones: { altoUtil?: number; extraPrimera?: number } = {},
): Paginado {
  const limite = opciones.altoUtil ?? altoUtil();
  const extra = Math.max(0, opciones.extraPrimera ?? 0);
  const saltos: number[] = [];
  let usado = extra;
  for (let i = 0; i < bloques.length; i++) {
    const b = bloques[i];
    const alto = Math.max(0, b.alto || 0);
    if (b.saltoManual) {
      usado += alto;
      saltos.push(i + 1);
      usado = 0;
      continue;
    }
    if (usado > 0 && usado + alto > limite) {
      saltos.push(i);
      usado = 0;
    }
    usado += alto;
  }
  // Un «Nueva página» al final no abre una hoja vacía.
  if (saltos.length && saltos[saltos.length - 1] >= bloques.length) saltos.pop();
  return { saltosAntesDe: saltos, paginas: saltos.length + 1, relleno: Math.max(0, limite - usado) };
}

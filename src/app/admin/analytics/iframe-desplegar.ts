// Hoja de estilos que se inyecta DENTRO del iframe del visor de heatmap, y sólo
// ahí. Nunca toca el panel de verdad: se añade al <head> del contentDocument.
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────────
// El escenario (heatmap-stage.tsx) mide el ALTO DEL CONTENIDO de la página con
// body.scrollHeight / body.offsetHeight / documentElement.offsetHeight. Esas tres
// medidas son content-driven, pero el armazón del panel NO deja que el contenido
// crezca: la columna de trabajo de `src/app/dashboard/layout.tsx` lleva
// `lg:max-h-screen lg:overflow-y-auto`, es decir `max-height:100vh` + su PROPIA
// barra de scroll a partir de 1024 px. Dentro de un iframe, `100vh` es el alto
// del iframe, así que la página nunca es más alta que su ventana: las tres
// medidas devuelven el alto del iframe (el PROBE_H de sondeo), el escenario se
// queda en esa franja y debajo sólo queda el fondo del lienzo. Eso es la «página
// cortada» y la barra de scroll dentro de la mini página.
//
// Neutralizando ese techo (y sólo ese) el documento se despliega a su alto real y
// las medidas que ya había empiezan a decir la verdad. No se estira el canvas ni
// se inventa una fórmula: ver el comentario de heatmap-stage.tsx sobre el intento
// con documentElement.scrollHeight, que sí inflaba el lienzo.
//
// ── POR QUÉ ESTOS SELECTORES Y NO `* { height:auto }` ─────────────────────────
// Un comodín reventaría la maquetación de la página que se está midiendo (y con
// ella la alineación de los puntos, que es justo lo que se quiere arreglar). Se
// va por la firma exacta del armazón: la columna de trabajo es el único elemento
// que lleva a la vez `flex-1`, `lg:max-h-screen` y `lg:overflow-y-auto` (mismo
// patrón en los cinco layouts de panel del repo), y por las dos columnas del
// armazón, que son los únicos hijos directos de `.dashboard-shell`. De la barra
// lateral sólo se suelta el alto: sigue siendo `position:sticky`, así que se
// queda pegada arriba, que es justo donde se dibujan los clicks con yFixed; lo
// que cambia es que ahora la estira el flex hasta el alto de la página en vez
// de quedarse en el alto del iframe.
//
// ── HASTA DÓNDE LLEGA, Y POR QUÉ NO MÁS ──────────────────────────────────────
// Esto suelta el ARMAZÓN, no cada pantalla. Hay pantallas del panel que fijan su
// PROPIO alto de ventana en su contenedor raíz, ya dentro del <main>:
// clinic-layout (`height:100dvh` + `overflow:hidden`), inbox, ai-assistant,
// xrays y sabina (`calc(100dvh - 64px)`). El selector de aquí no las toca, y es
// a propósito: esas pantallas son de alto de ventana POR DISEÑO —rejillas con
// `minmax(0,1fr)` y scroll dentro de sus paneles—, el documento no rueda, y por
// eso sus clicks se capturaron con `y = pageY = clientY`, todos dentro de una
// ventana. Desplegarlas a un alto que el usuario nunca vio movería los puntos
// fuera de su elemento, que es justo lo que se quiere evitar. En esas pantallas
// el escenario se comporta igual que antes de este arreglo (no hay regresión):
// el alto se queda en el del iframe y `stageHeight()` lo extiende con el p95 de
// las Y. Si algún día hay que mejorarlas, es otra tarea y va por otro camino
// (el alto de captura vive en points[].docH), no ensanchando este selector.
//
// El diseño no se toca: aquí no hay un solo color ni un token; sólo alto, tope y
// desbordamiento. Por eso funciona igual en claro y en oscuro.

/** id del <style> inyectado. Sirve para no duplicarlo en cada medición. */
export const ID_ESTILO_DESPLIEGUE = "dc-heatmap-desplegar";

/**
 * Firma de la columna de trabajo del armazón (las tres clases a la vez). Se
 * escapan los `:` de las variantes de Tailwind, que en un selector CSS son
 * separador de pseudo-clase.
 */
const COLUMNA_ARMAZON = ".flex-1.lg\\:max-h-screen.lg\\:overflow-y-auto";

export const CSS_DESPLIEGUE = `
/* Visor de heatmap: el alto lo manda el contenido, no la ventana del iframe. */
html, body {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
}

/* Columna de trabajo del armazón del panel: quitarle el techo de 100vh y su
   barra de scroll interna es lo único que hace falta para que la página se
   despliegue entera. */
${COLUMNA_ARMAZON} {
  max-height: none !important;
  overflow: visible !important;
}

/* Y las dos columnas del armazón dejan de estar atadas al viewport del iframe:
   la de trabajo lleva min-height:100vh y la barra lateral height:100vh.
   Dentro del iframe eso se muerde la cola — en cuanto el iframe adopta el alto
   medido, el armazón crece HASTA ese alto y la medida siguiente sale más alta
   todavía, sin tope (medido: +30 px por vuelta). Con el alto en auto la
   medida es un punto fijo: la pone el contenido y ya no depende del iframe.
   La barra lateral no se encoge: al quedarse en auto la estira el propio
   flex del armazón hasta el alto de la página, que es como se ve de verdad. */
.dashboard-shell,
.mf-extpanel {
  min-height: 0 !important;
}

.dashboard-shell > *,
.mf-extpanel > * {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
}
`.trim();

/**
 * Cabecera mínima que necesita el inyector. Se declara aparte para poder probarlo
 * sin navegador: cualquier objeto con esta forma sirve.
 */
export interface CabezaInyectable {
  getElementById(id: string): unknown;
  createElement(tag: "style"): { id: string; textContent: string | null };
  head: { appendChild(nodo: unknown): unknown } | null;
}

export type ResultadoDespliegue = "inyectado" | "ya-estaba" | "sin-cabeza";

/**
 * Pone la hoja en el documento del iframe. Es IDEMPOTENTE: si ya está puesta no
 * hace nada, así que se puede llamar en cada medición y en cada aviso del
 * ResizeObserver sin acumular <style>. Devuelve qué pasó para poder decidir si
 * conviene volver a medir (tras inyectar, el alto cambia).
 */
export function desplegarDocumento(doc: CabezaInyectable): ResultadoDespliegue {
  if (doc.getElementById(ID_ESTILO_DESPLIEGUE)) return "ya-estaba";
  if (!doc.head) return "sin-cabeza";
  const estilo = doc.createElement("style");
  estilo.id = ID_ESTILO_DESPLIEGUE;
  estilo.textContent = CSS_DESPLIEGUE;
  doc.head.appendChild(estilo);
  return "inyectado";
}

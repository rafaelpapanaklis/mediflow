// Saneado del HTML de una plantilla o de un documento. Corre en el SERVIDOR: el
// cuerpo lo escribe una persona y se pinta en la pantalla de OTRA y en un PDF, y
// quien manda un POST a mano se salta cualquier filtro del navegador.
//
// Lista blanca, no lista negra. La salida NO se obtiene "limpiando" la entrada:
// se RECONSTRUYE desde cero con solo dos cosas — texto escapado y etiquetas de
// la lista con, como mucho, SUS atributos enumerados (tabla de abajo), cuyo
// valor se escribe desde aquí y nunca se copia de la entrada. Lo que no está en
// la tabla no tiene forma de llegar a la salida: ni `on*`, ni `style`, ni
// `href`, ni `src`, ni `class`.
//
// Una etiqueta de más no tumba la plantilla: se descarta la etiqueta y se
// conserva su texto. La excepción son las etiquetas cuyo contenido no es texto
// para leer (script, style…): ahí se descarta también lo de dentro.
//
// Sin dependencias y sin DOM a propósito: corre igual en el route handler, en
// los tests de node y en las pantallas del cliente que lo importan.
//
// La entrada esperada es lo que serializa el editor (el `contenteditable` de
// antes o Tiptap 3). Solo se conocen las entidades con nombre de la tabla
// ENTIDADES (más las numéricas): un `&ntilde;` escrito a máquina se guarda como
// el texto literal «&ntilde;».
//
// ── La tabla CERRADA (v2, editor de documentos; diseño ws1-t10 §5) ─────────
//
//   p, h1, h2, h3   data-sangria ∈ 1..6 (0 = sin sangría, no se escribe)
//                   data-alineacion ∈ ALINEACIONES_TEXTO (también se lee de un
//                   `style="text-align: …"`, que es lo que escribe Tiptap; el
//                   style NUNCA sale)
//   br b strong i em u ul ol li           sin atributos
//   table thead tbody tr                  sin atributos
//   th, td          colspan ∈ 2..MAX_SPAN_COLUMNAS, rowspan ∈ 2..MAX_SPAN_FILAS
//   span            SOLO con data-tamano ∈ TAMANOS_LETRA; sin él la etiqueta se
//                   va y el texto se queda. `span[data-marcador=CLAVE]` (la ficha
//                   del editor) se escribe como el texto `[CLAVE]` de siempre.
//   img             SOLO con data-archivo = documentos/<clínica>/<32 hex>.webp, más
//                   data-ancho ∈ ANCHOS_IMAGEN, data-alineacion ∈
//                   ALINEACIONES_IMAGEN y alt. Sin `src` jamás: la imagen se
//                   firma al pintarla. Como mucho IMAGEN_MAX_POR_DOCUMENTO.
//   div             data-tipo = columnas (data-n ∈ 2|3) · columna (solo dentro
//                   de columnas) · linea-firma (data-lado) · salto-pagina (vacío).
//                   Cualquier otro div es un párrafo, como siempre.
//
// ── Normalizaciones (las formas que escribe Tiptap 3, comprobadas en 3.32) ──
//
//   <li><p>x</p></li>      → <li>x</li>      (lo que el PDF y la carta leen)
//   <li><p>a</p><p>b</p></li> → <li>a<br>b</li>
//   <div data-tipo="linea-firma"><div class="firma-texto">x</div></div>
//                          → <div data-tipo="linea-firma">x</div> (la firma es un renglón)
//   <div data-tipo="salto-pagina" …><span>Nueva página</span></div>
//                          → <div data-tipo="salto-pagina"></div>
//   <table style=…><colgroup><col …></colgroup>  → <table> (anchos fuera)
//   th/td con colspan="1" o rowspan="1"          → sin el atributo (es el valor por omisión)
//   td/th fuera de un tr, tr fuera de una tabla  → la etiqueta se va, el texto se queda

import { IMAGEN_MAX_POR_DOCUMENTO } from "@/lib/documentos/limites-imagen";
import { leerClave } from "@/lib/documentos/imagenes";

/** Las únicas etiquetas que pueden salir. Cada una, solo con lo que dice la tabla de arriba. */
export const ALLOWED_TAGS: readonly string[] = [
  "p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "h1", "h2", "h3",
  "table", "thead", "tbody", "tr", "th", "td", "img", "div", "span",
];

/** Sangría de párrafos y títulos, en pasos (cada paso, una tabulación). */
export const SANGRIAS: readonly string[] = ["1", "2", "3", "4", "5", "6"];
/** Alineación de párrafos y títulos. */
export const ALINEACIONES_TEXTO: readonly string[] = ["izquierda", "centro", "derecha", "justificado"];
/** Tamaño de letra, en puntos: 12 es el del cuerpo. */
export const TAMANOS_LETRA: readonly string[] = ["10", "11", "12", "14", "16", "18", "24"];
export const ANCHOS_IMAGEN: readonly string[] = ["chico", "medio", "completo"];
export const ALINEACIONES_IMAGEN: readonly string[] = ["izquierda", "centro", "derecha"];
export const LADOS_FIRMA: readonly string[] = ["izquierda", "centro", "derecha"];
export const COLUMNAS: readonly string[] = ["2", "3"];
/** Una carta no tiene sitio para más columnas que esto, ni una tabla para más filas unidas. */
export const MAX_SPAN_COLUMNAS = 20;
export const MAX_SPAN_FILAS = 100;
// La clave de una imagen del editor la decide P4 (`leerClave` de
// `@/lib/documentos/imagenes`): `documentos/<clinicId>/<32 hex>.webp`. Una sola
// fuente: lo que la ruta sabe servir es exactamente lo que aquí se guarda.

/** Tope del cuerpo ya saneado. Una plantilla es una carta, no un libro. */
export const MAX_BODY_LENGTH = 100_000;

/**
 * Tope de la ENTRADA. Se mira ANTES de sanear: el saneado cuesta tiempo de CPU
 * del servidor, y sin cota un POST de varios megas lo paga toda la instancia.
 * El doble del de salida porque los atributos que mete el navegador se tiran.
 */
export const MAX_INPUT_LENGTH = 2 * MAX_BODY_LENGTH;

/** Una etiqueta más larga que esto no es de un editor: sale como texto escapado. */
const MAX_TAG_LENGTH = 1024;

/**
 * El `alt` de una imagen, medido YA escapado. Con eso la etiqueta `<img>` que
 * sale de aquí nunca pasa de MAX_TAG_LENGTH, y sanear dos veces da lo mismo.
 */
const MAX_ALT_ESCAPADO = 600;

/**
 * Anidamiento máximo. Una carta no anida 50 niveles; un ataque sí: con miles de
 * etiquetas abiertas, cada cierre huérfano recorría la pila entera. Pasado el
 * tope la etiqueta se descarta y su texto se queda, como con cualquier otra.
 */
const MAX_DEPTH = 50;
/** Lo mismo para la pila entera, contando las etiquetas que se van sin escribirse. */
const MAX_PILA = 2 * MAX_DEPTH;

// Su contenido no es texto del documento: se va entero, no solo la etiqueta.
const CONTENIDO_DESCARTADO = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template",
  "svg", "math", "head", "title", "textarea", "select", "xmp", "noembed", "noframes",
]);

const MARCAS = new Set(["b", "strong", "i", "em", "u"]);
const TITULOS = new Set(["h1", "h2", "h3"]);
/** Las que, al abrirse, empiezan un bloque: cortan un silencio y no caben en una firma. */
const BLOQUES = new Set([
  "p", "h1", "h2", "h3", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "div",
]);

const SET_SANGRIAS = new Set(SANGRIAS);
const SET_ALINEACIONES_TEXTO = new Set(ALINEACIONES_TEXTO);
const SET_TAMANOS = new Set(TAMANOS_LETRA);
const SET_ANCHOS = new Set(ANCHOS_IMAGEN);
const SET_ALINEACIONES_IMAGEN = new Set(ALINEACIONES_IMAGEN);
const SET_LADOS = new Set(LADOS_FIRMA);
const SET_COLUMNAS = new Set(COLUMNAS);
/** `text-align` de CSS → la alineación de la tabla. Un Map: «constructor» no es una alineación. */
const ALINEACION_CSS = new Map([
  ["left", "izquierda"], ["center", "centro"], ["right", "derecha"], ["justify", "justificado"],
]);
const PATRON_MARCADOR = /^[A-Z_]{1,40}$/;

const ENTIDADES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", // el espacio duro, escrito como escape: un editor no lo cambia por uno normal
};

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, cuerpo: string) => {
    if (cuerpo[0] === "#") {
      const hex = cuerpo[1] === "x" || cuerpo[1] === "X";
      const n = parseInt(cuerpo.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "";
      try {
        return String.fromCodePoint(n);
      } catch {
        return "";
      }
    }
    const v = ENTIDADES[cuerpo.toLowerCase()];
    return v === undefined ? todo : v;
  });
}

export function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Los caracteres de control (salvo tab y saltos) no pintan nada y estorban al PDF.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** Decodifica y vuelve a escapar: `&lt;script&gt;` sigue siendo texto, nunca etiqueta. */
function texto(crudo: string): string {
  return escapeHtml(decodificar(crudo).replace(CONTROL, ""));
}

const ES_LETRA = /[a-zA-Z]/;
const ES_DE_NOMBRE = /[a-zA-Z0-9:-]/;

/** Espacio en blanco de HTML: tab, LF, FF, CR y espacio. */
function esEspacio(c: number): boolean {
  return c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
}
const GT = 62, LT = 60, BARRA = 47, IGUAL = 61, COMILLA = 34, APOSTROFO = 39;

interface Etiqueta {
  esCierre: boolean;
  nombre: string;
  /** Posición siguiente al `>`. */
  fin: number;
  /** Nombre en minúsculas → valor CRUDO (sin decodificar). Si se repite, gana el primero, como en el navegador. */
  atributos: Map<string, string>;
}

/**
 * Lee una etiqueta que empieza en `lt`: `<`, `/` opcional, nombre, atributos y
 * el `>`. Un `>` dentro de un valor entrecomillado no la cierra. Devuelve null
 * si ahí no hay una etiqueta: entonces el `<` es texto.
 *
 * A mano y no con una regex A PROPÓSITO: la regex retrocedía hasta el final del
 * texto por cada `<` sin cerrar, y un cuerpo de `<a<a<a…` costaba tiempo
 * cuadrático. Esto avanza de un carácter en un carácter, nunca retrocede y
 * nunca mira más allá de `tope`. Un `<` fuera de comillas dentro de una
 * etiqueta la anula (ningún editor lo escribe), y eso corta también los
 * `<a <a <a…` sin recorrer cada vez hasta el tope.
 *
 * Que este lector y el del navegador discrepen en un caso raro no abre nada: lo
 * que sale se escribe desde cero, así que lo peor es perder formato o texto.
 */
function leerEtiqueta(html: string, lt: number, ultimoGt: number, tope: number): Etiqueta | null {
  if (lt > ultimoGt) return null; // no queda ningún `>`: no puede ser etiqueta
  let j = lt + 1;
  const esCierre = html.charCodeAt(j) === BARRA;
  if (esCierre) j++;
  if (j >= html.length || !ES_LETRA.test(html[j])) return null;
  const inicioNombre = j;
  while (j < html.length && ES_DE_NOMBRE.test(html[j])) j++;
  const nombre = html.slice(inicioNombre, j).toLowerCase();

  const fin = Math.min(html.length, tope);
  const atributos = new Map<string, string>();
  while (j < fin) {
    const c = html.charCodeAt(j);
    if (c === GT) return { esCierre, nombre, fin: j + 1, atributos };
    if (c === LT) return null;
    if (esEspacio(c) || c === BARRA) {
      j++;
      continue;
    }
    // Nombre del atributo: hasta un espacio, `/`, `>` o `=` (un `=` inicial es parte del nombre).
    const inicio = j++;
    while (j < fin) {
      const d = html.charCodeAt(j);
      if (esEspacio(d) || d === BARRA || d === GT || d === IGUAL || d === LT) break;
      j++;
    }
    const nombreAtributo = html.slice(inicio, j).toLowerCase();
    let k = j;
    while (k < fin && esEspacio(html.charCodeAt(k))) k++;
    let valor = "";
    if (k < fin && html.charCodeAt(k) === IGUAL) {
      k++;
      while (k < fin && esEspacio(html.charCodeAt(k))) k++;
      const q = html.charCodeAt(k);
      if (q === COMILLA || q === APOSTROFO) {
        let cierre = k + 1;
        while (cierre < fin && html.charCodeAt(cierre) !== q) cierre++;
        if (cierre >= fin) return null; // comilla sin cerrar o etiqueta desmedida: es texto
        valor = html.slice(k + 1, cierre);
        k = cierre + 1;
      } else {
        const inicioValor = k;
        while (k < fin) {
          const d = html.charCodeAt(k);
          if (esEspacio(d) || d === GT || d === LT) break;
          k++;
        }
        valor = html.slice(inicioValor, k);
      }
    }
    j = k;
    if (!atributos.has(nombreAtributo)) atributos.set(nombreAtributo, valor);
  }
  return null; // sin `>` o etiqueta desmedida: es texto
}

/** ¿`<img` en esta posición? (para darle a una imagen con `src` enorme una segunda lectura). */
function esImg(html: string, lt: number): boolean {
  return html.slice(lt + 1, lt + 4).toLowerCase() === "img" && !ES_DE_NOMBRE.test(html[lt + 4] ?? "");
}

/**
 * Posición siguiente al `</nombre>` que cierra una etiqueta descartada, o el
 * final. Compara trozo a trozo y no contra una copia en minúsculas del texto:
 * `toLowerCase()` puede cambiar la longitud («İ») y descuadrar las posiciones.
 */
function finDeDescartada(html: string, nombre: string, desde: number): number {
  let k = html.indexOf("</", desde);
  while (k !== -1) {
    let j = k + 2 + nombre.length;
    if (html.slice(k + 2, j).toLowerCase() === nombre) {
      while (j < html.length && /\s/.test(html[j])) j++;
      if (html[j] === ">") return j + 1;
    }
    k = html.indexOf("</", k + 2);
  }
  return html.length;
}

/** Valor de un atributo enumerado, o null si no está o no es de la lista. */
function enumerado(a: Map<string, string>, nombre: string, lista: Set<string>): string | null {
  const crudo = a.get(nombre);
  if (crudo === undefined) return null;
  const v = decodificar(crudo);
  return lista.has(v) ? v : null;
}

/** `text-align` de un `style`: solo esa propiedad y solo sus cuatro valores. El style no sale. */
function alineacionDeEstilo(estilo: string | undefined): string | null {
  if (!estilo) return null;
  let r: string | null = null;
  for (const declaracion of decodificar(estilo).split(";")) {
    const m = /^\s*text-align\s*:\s*([a-z]+)\s*(?:!important\s*)?$/i.exec(declaracion);
    if (m) r = ALINEACION_CSS.get(m[1].toLowerCase()) ?? r; // como en CSS: la última manda
  }
  return r;
}

/** Atributos de un párrafo o título, ya escritos y en orden fijo. */
function atributosDeTexto(a: Map<string, string>): string {
  let s = "";
  const sangria = enumerado(a, "data-sangria", SET_SANGRIAS);
  if (sangria) s += ` data-sangria="${sangria}"`;
  const alineacion = enumerado(a, "data-alineacion", SET_ALINEACIONES_TEXTO) ?? alineacionDeEstilo(a.get("style"));
  if (alineacion) s += ` data-alineacion="${alineacion}"`;
  return s;
}

/** colspan/rowspan: enteros 2..max escritos en decimal limpio. 1 es lo de siempre y no se escribe. */
function tramo(a: Map<string, string>, nombre: string, max: number): string {
  const crudo = a.get(nombre);
  if (crudo === undefined) return "";
  const v = decodificar(crudo);
  if (!/^[1-9][0-9]{0,2}$/.test(v)) return "";
  const n = Number(v);
  return n >= 2 && n <= max ? ` ${nombre}="${n}"` : "";
}

/** El `alt`, escapado y de un solo renglón, cortado por carácter (no parte un emoji) a MAX_ALT_ESCAPADO. */
function altEscapado(crudo: string): string {
  const limpio = decodificar(crudo).replace(CONTROL, "").replace(/\s+/g, " ").trim();
  let s = "";
  for (const c of limpio) {
    const e = escapeHtml(c);
    if (s.length + e.length > MAX_ALT_ESCAPADO) break;
    s += e;
  }
  // Si el corte cae tras un espacio, se quita aquí: si no, la segunda pasada lo haría (y no sería idempotente).
  return s.trimEnd();
}

export interface OpcionesSaneado {
  /**
   * La clínica de la SESIÓN. Si llega, una imagen guardada bajo la carpeta de
   * otra clínica se descarta al guardar (la ruta que la sirve ya la rechazaría,
   * pero así ni siquiera se guarda la referencia).
   */
  clinicId?: string;
  /**
   * Si llega, el saneado anota aquí lo que descartó de las imágenes, para que
   * quien guarda RECHACE en vez de guardar a medias en silencio (ver
   * `problemaDeImagenes`). Se cuenta en la misma pasada: nada de regex sobre la
   * entrada cruda, que con `<img<img<img…` costaría tiempo cuadrático.
   */
  informe?: InformeDeImagenes;
}

export interface InformeDeImagenes {
  /** Claves bien formadas, pero de otra clínica (solo se cuentan con `clinicId`). */
  ajenas: number;
  /** Las que pasaban de IMAGEN_MAX_POR_DOCUMENTO. */
  deMas: number;
}

export const informeVacio = (): InformeDeImagenes => ({ ajenas: 0, deMas: 0 });

export type ProblemaDeImagenes = "IMAGEN_AJENA" | "DEMASIADAS_IMAGENES";

/** Lo que un guardado tiene que rechazar, según el informe del saneado. */
export function problemaDeImagenes(informe: InformeDeImagenes): ProblemaDeImagenes | null {
  if (informe.ajenas > 0) return "IMAGEN_AJENA";
  if (informe.deMas > 0) return "DEMASIADAS_IMAGENES";
  return null;
}

interface Abierta {
  /** El nombre con el que se ABRIÓ en la entrada: es el que la cierra. */
  fuente: string;
  /** Lo que se escribió, o null si la etiqueta se fue y solo se sigue para emparejar su cierre. */
  salida: string | null;
  /** Para los div del editor. */
  tipo?: "columnas" | "columna" | "linea-firma";
}

export function sanitizeTemplateHtml(entrada: unknown, opciones: OpcionesSaneado = {}): string {
  if (typeof entrada !== "string" || entrada.length === 0) return "";
  // Cinturón: quien llame sin mirar el tamaño (no solo el CRUD lo usa) no puede
  // poner al servidor a sanear megas. El CRUD lo rechaza antes con BODY_TOO_LONG.
  const html = entrada.slice(0, MAX_INPUT_LENGTH).replace(/\u0000/g, "");
  const ultimoGt = html.lastIndexOf(">");
  const clinica = typeof opciones.clinicId === "string" ? opciones.clinicId : null;

  let salida = "";
  const pila: Abierta[] = [];
  /** Cuántas de la pila se escribieron (las que cuentan para MAX_DEPTH). */
  let profundidad = 0;
  /** Cuántas líneas de firma hay abiertas: dentro solo cabe un renglón. */
  let enFirma = 0;
  /** Lo último escrito: texto en línea, o el borde de un bloque. Decide si unir dos párrafos lleva <br>. */
  let ultimo: "linea" | "bloque" = "bloque";
  let imagenes = 0;
  /** Contenido que no se escribe (el rótulo del salto, el texto de la ficha) hasta cerrar `nombre`. */
  let silencio: { nombre: string; nivel: number } | null = null;
  /** Una `<img>` larga ya se leyó hasta el final sin cerrar: las siguientes no se vuelven a leer enteras. */
  let imgLargaSinCierre = false;
  let i = 0;

  const padreEscrito = (): Abierta | null => {
    for (let k = pila.length - 1; k >= 0; k--) if (pila[k].salida !== null) return pila[k];
    return null;
  };
  const abrir = (fuente: string, nombre: string, atributos = "", tipo?: Abierta["tipo"]) => {
    if (profundidad >= MAX_DEPTH || pila.length >= MAX_PILA) return;
    pila.push({ fuente, salida: nombre, tipo });
    profundidad++;
    if (tipo === "linea-firma") enFirma++;
    salida += `<${nombre}${atributos}>`;
    if (BLOQUES.has(nombre)) ultimo = "bloque";
  };
  const fantasma = (fuente: string) => {
    if (pila.length < MAX_PILA) pila.push({ fuente, salida: null });
  };
  /** Un bloque que no cabe donde está (párrafo en un <li>, cualquier bloque en una firma): se une al renglón. */
  const unirAlRenglon = (fuente: string) => {
    if (ultimo === "linea") salida += "<br>";
    fantasma(fuente);
  };
  const cerrarHasta = (fuente: string) => {
    let pos = pila.length - 1;
    while (pos >= 0 && pila[pos].fuente !== fuente) pos--;
    if (pos === -1) return; // cierre huérfano: se ignora
    while (pila.length > pos) {
      const a = pila.pop()!;
      if (a.salida === null) continue;
      salida += `</${a.salida}>`;
      profundidad--;
      if (a.tipo === "linea-firma") enFirma--;
      if (BLOQUES.has(a.salida)) ultimo = "bloque";
    }
  };
  const escribirTexto = (crudo: string) => {
    if (silencio) return;
    const t = texto(crudo);
    if (t === "") return;
    salida += t;
    if (/\S/.test(t)) ultimo = "linea";
  };
  /** p, h1-h3 y el div que hace de párrafo. */
  const abrirTexto = (fuente: string, nombre: string, a: Map<string, string>) => {
    if (enFirma > 0) return unirAlRenglon(fuente);
    const atributos = atributosDeTexto(a);
    // <li><p>x</p></li> → <li>x</li>. Con alineación o sangría el párrafo se queda: perderla sería peor.
    if (nombre === "p" && atributos === "" && padreEscrito()?.salida === "li") return unirAlRenglon(fuente);
    abrir(fuente, nombre, atributos);
  };
  const abrirImagen = (a: Map<string, string>) => {
    const archivo = decodificar(a.get("data-archivo") ?? "");
    const clave = leerClave(archivo);
    if (!clave) return; // sin clave válida no hay imagen: ni src, ni data:, ni otra carpeta
    if (clinica !== null && clave.clinicId !== clinica) {
      if (opciones.informe) opciones.informe.ajenas++;
      return;
    }
    if (imagenes >= IMAGEN_MAX_POR_DOCUMENTO) {
      if (opciones.informe) opciones.informe.deMas++;
      return;
    }
    imagenes++;
    let s = ` data-archivo="${archivo}"`;
    const ancho = enumerado(a, "data-ancho", SET_ANCHOS);
    if (ancho) s += ` data-ancho="${ancho}"`;
    const alineacion = enumerado(a, "data-alineacion", SET_ALINEACIONES_IMAGEN);
    if (alineacion) s += ` data-alineacion="${alineacion}"`;
    const alt = a.get("alt");
    if (alt !== undefined) s += ` alt="${altEscapado(alt)}"`;
    salida += `<img${s}>`;
    ultimo = "linea";
  };
  const abrirDiv = (a: Map<string, string>) => {
    const tipo = a.get("data-tipo") === undefined ? "" : decodificar(a.get("data-tipo")!);
    if (tipo === "salto-pagina") {
      // Es un átomo: lo de dentro es el rótulo del editor («Nueva página»), no texto del documento.
      if (enFirma === 0) {
        salida += `<div data-tipo="salto-pagina"></div>`;
        ultimo = "bloque";
      }
      silencio = { nombre: "div", nivel: 0 };
      return;
    }
    if (enFirma > 0) return unirAlRenglon("div");
    if (tipo === "columnas") {
      const n = enumerado(a, "data-n", SET_COLUMNAS);
      return abrir("div", "div", ` data-tipo="columnas"${n ? ` data-n="${n}"` : ""}`, "columnas");
    }
    if (tipo === "columna" && padreEscrito()?.tipo === "columnas") {
      return abrir("div", "div", ` data-tipo="columna"`, "columna");
    }
    if (tipo === "linea-firma") {
      const lado = enumerado(a, "data-lado", SET_LADOS);
      return abrir("div", "div", ` data-tipo="linea-firma"${lado ? ` data-lado="${lado}"` : ""}`, "linea-firma");
    }
    abrirTexto("div", "p", a); // el div del navegador es un párrafo, como siempre
  };
  const abrirSpan = (a: Map<string, string>) => {
    const marcador = a.get("data-marcador") === undefined ? null : decodificar(a.get("data-marcador")!);
    if (marcador !== null && PATRON_MARCADOR.test(marcador)) {
      // La ficha del editor vuelve a ser el marcador de siempre; su rótulo no es texto.
      salida += `[${marcador}]`;
      ultimo = "linea";
      silencio = { nombre: "span", nivel: 0 };
      return;
    }
    const tamano = enumerado(a, "data-tamano", SET_TAMANOS);
    if (tamano) abrir("span", "span", ` data-tamano="${tamano}"`);
    else fantasma("span");
  };

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      escribirTexto(html.slice(i));
      break;
    }
    if (lt > i) escribirTexto(html.slice(i, lt));

    // Comentarios, <!DOCTYPE>, <?xml …?>: fuera enteros.
    if (html.startsWith("<!--", lt)) {
      const fin = html.indexOf("-->", lt + 4);
      i = fin === -1 ? html.length : fin + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const fin = html.indexOf(">", lt);
      i = fin === -1 ? html.length : fin + 1;
      continue;
    }

    let etiqueta = leerEtiqueta(html, lt, ultimoGt, lt + MAX_TAG_LENGTH);
    if (!etiqueta && !imgLargaSinCierre && esImg(html, lt)) {
      // Una imagen con un `src` enorme (un data: pegado) no es texto del documento:
      // se lee hasta su `>` para tirarla entera. Si no cierra, ya no se reintenta
      // con ninguna otra: así el coste sigue siendo lineal.
      etiqueta = leerEtiqueta(html, lt, ultimoGt, html.length);
      if (!etiqueta) imgLargaSinCierre = true;
    }
    if (!etiqueta) {
      // Un `<` suelto ("si x < 3") es texto.
      if (!silencio) {
        salida += "&lt;";
        ultimo = "linea";
      }
      i = lt + 1;
      continue;
    }
    i = etiqueta.fin;

    const { esCierre, nombre, atributos } = etiqueta;

    if (CONTENIDO_DESCARTADO.has(nombre)) {
      // Sin cierre, se descarta hasta el final: es lo que haría el navegador.
      if (!esCierre) i = finDeDescartada(html, nombre, i);
      continue;
    }

    if (silencio) {
      if (nombre === silencio.nombre) {
        if (!esCierre) silencio.nivel++;
        else if (silencio.nivel === 0) silencio = null;
        else silencio.nivel--;
        continue;
      }
      // Un bloque que empieza o termina dice que el átomo ya terminó, aunque no se cerrara:
      // ese cierre se aplica, y lo que sigue no se pierde.
      if (!BLOQUES.has(nombre)) continue;
      silencio = null;
    }

    if (esCierre) {
      if (nombre !== "br" && nombre !== "img") cerrarHasta(nombre);
      continue;
    }

    if (nombre === "br") {
      salida += "<br>";
      ultimo = "linea";
    } else if (nombre === "img") {
      abrirImagen(atributos);
    } else if (MARCAS.has(nombre)) {
      abrir(nombre, nombre);
    } else if (nombre === "span") {
      abrirSpan(atributos);
    } else if (nombre === "p" || TITULOS.has(nombre)) {
      abrirTexto(nombre, nombre, atributos);
    } else if (nombre === "div") {
      abrirDiv(atributos);
    } else if (nombre === "ul" || nombre === "ol" || nombre === "li" || nombre === "table") {
      if (enFirma > 0) unirAlRenglon(nombre);
      else abrir(nombre, nombre);
    } else if (nombre === "thead" || nombre === "tbody") {
      if (padreEscrito()?.salida === "table") abrir(nombre, nombre);
      else fantasma(nombre);
    } else if (nombre === "tr") {
      const padre = padreEscrito()?.salida;
      if (padre === "table" || padre === "thead" || padre === "tbody") abrir(nombre, nombre);
      else fantasma(nombre);
    } else if (nombre === "th" || nombre === "td") {
      if (padreEscrito()?.salida === "tr") {
        abrir(nombre, nombre, tramo(atributos, "colspan", MAX_SPAN_COLUMNAS) + tramo(atributos, "rowspan", MAX_SPAN_FILAS));
      } else {
        fantasma(nombre);
      }
    }
    // Cualquier otra etiqueta se va y su texto se queda (a, font, s, blockquote, colgroup…).
  }

  while (pila.length > 0) {
    const a = pila.pop()!;
    if (a.salida !== null) salida += `</${a.salida}>`;
  }
  return salida.trim();
}

/** ¿Queda algo que leer? `<p><br></p>` es una plantilla vacía; una imagen sí es contenido. */
export function isBlankHtml(html: string): boolean {
  if (/<img\s/i.test(html)) return false;
  return decodificar(html.replace(/<[^>]*>/g, "")).replace(/[\s\u00a0]/g, "").length === 0;
}


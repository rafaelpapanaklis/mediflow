// Saneado del HTML de una plantilla. Corre en el SERVIDOR: el cuerpo lo escribe
// una persona y se pinta en la pantalla de OTRA y en un PDF, y quien manda un
// POST a mano se salta cualquier filtro del navegador.
//
// Lista blanca, no lista negra. La salida NO se obtiene "limpiando" la entrada:
// se RECONSTRUYE desde cero con solo dos cosas — texto escapado y etiquetas de
// la lista SIN NINGÚN atributo. Lo que no está en la lista no tiene forma de
// llegar a la salida: ni `on*`, ni `style`, ni `href`, ni `src`.
//
// Una etiqueta de más no tumba la plantilla: se descarta la etiqueta y se
// conserva su texto. La excepción son las etiquetas cuyo contenido no es texto
// para leer (script, style…): ahí se descarta también lo de dentro.
//
// Sin dependencias y sin DOM a propósito: corre igual en el route handler, en
// los tests de node y en las otras dos pantallas que lo importan.
//
// La entrada esperada es lo que serializa un contenteditable. Solo se conocen
// las entidades con nombre de la tabla ENTIDADES (más las numéricas): un
// `&ntilde;` escrito a máquina se guarda como el texto literal «&ntilde;».

/** Las únicas etiquetas que sobreviven. */
export const ALLOWED_TAGS: readonly string[] = [
  "p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "h1", "h2", "h3",
];

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
 * Anidamiento máximo. Una carta no anida 50 niveles; un ataque sí: con miles de
 * etiquetas abiertas, cada cierre huérfano recorría la pila entera. Pasado el
 * tope la etiqueta se descarta y su texto se queda, como con cualquier otra.
 */
const MAX_DEPTH = 50;

const PERMITIDAS = new Set(ALLOWED_TAGS);
const SIN_CIERRE = new Set(["br"]);

// Su contenido no es texto del documento: se va entero, no solo la etiqueta.
const CONTENIDO_DESCARTADO = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template",
  "svg", "math", "head", "title", "textarea", "select", "xmp", "noembed", "noframes",
]);

// Lo que el navegador mete al pegar o al pulsar Intro en un contenteditable.
// Se traduce a la lista en vez de perder el salto de párrafo.
const EQUIVALENTES: Readonly<Record<string, string>> = { div: "p" };

const ENTIDADES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
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

/** Decodifica y vuelve a escapar: `&lt;script&gt;` sigue siendo texto, nunca etiqueta. */
function texto(crudo: string): string {
  // Los caracteres de control (salvo tab y saltos) no pintan nada y estorban al PDF.
  return escapeHtml(decodificar(crudo).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""));
}

const ES_LETRA = /[a-zA-Z]/;
const ES_DE_NOMBRE = /[a-zA-Z0-9:-]/;

interface Etiqueta {
  esCierre: boolean;
  nombre: string;
  /** Posición siguiente al `>`. */
  fin: number;
}

/**
 * Lee una etiqueta que empieza en `lt`: `<`, `/` opcional, nombre, y hasta el
 * `>` respetando comillas (un `>` dentro de un atributo entrecomillado no la
 * cierra). Devuelve null si ahí no hay una etiqueta.
 *
 * A mano y no con una regex A PROPÓSITO: la regex retrocedía hasta el final del
 * texto por cada `<` sin cerrar, y un cuerpo de `<a<a<a…` costaba tiempo
 * cuadrático. Esto avanza de un carácter en un carácter, nunca retrocede y
 * nunca mira más de MAX_TAG_LENGTH.
 */
function leerEtiqueta(html: string, lt: number, ultimoGt: number): Etiqueta | null {
  if (lt > ultimoGt) return null; // no queda ningún `>`: no puede ser etiqueta
  let j = lt + 1;
  const esCierre = html[j] === "/";
  if (esCierre) j++;
  if (j >= html.length || !ES_LETRA.test(html[j])) return null;
  const inicioNombre = j;
  while (j < html.length && ES_DE_NOMBRE.test(html[j])) j++;
  const nombre = html.slice(inicioNombre, j).toLowerCase();

  const tope = Math.min(html.length, lt + MAX_TAG_LENGTH);
  let comilla = "";
  for (; j < tope; j++) {
    const c = html[j];
    if (comilla) {
      if (c === comilla) comilla = "";
    } else if (c === '"' || c === "'") {
      comilla = c;
    } else if (c === ">") {
      return { esCierre, nombre, fin: j + 1 };
    }
  }
  return null; // sin `>`, comilla sin cerrar o etiqueta desmedida: es texto
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

export function sanitizeTemplateHtml(entrada: unknown): string {
  if (typeof entrada !== "string" || entrada.length === 0) return "";
  // Cinturón: quien llame sin mirar el tamaño (no solo el CRUD lo usa) no puede
  // poner al servidor a sanear megas. El CRUD lo rechaza antes con BODY_TOO_LONG.
  const html = entrada.slice(0, MAX_INPUT_LENGTH).replace(/\u0000/g, "");
  const ultimoGt = html.lastIndexOf(">");

  let salida = "";
  const abiertas: string[] = [];
  let i = 0;

  const cerrarHasta = (nombre: string) => {
    const pos = abiertas.lastIndexOf(nombre);
    if (pos === -1) return; // cierre huérfano: se ignora
    while (abiertas.length > pos) salida += `</${abiertas.pop()}>`;
  };

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      salida += texto(html.slice(i));
      break;
    }
    if (lt > i) salida += texto(html.slice(i, lt));

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

    const etiqueta = leerEtiqueta(html, lt, ultimoGt);
    if (!etiqueta) {
      // Un `<` suelto ("si x < 3") es texto.
      salida += "&lt;";
      i = lt + 1;
      continue;
    }
    i = etiqueta.fin;

    const esCierre = etiqueta.esCierre;
    let nombre = etiqueta.nombre;

    if (CONTENIDO_DESCARTADO.has(nombre)) {
      if (!esCierre) {
        // Sin cierre, se descarta hasta el final: es lo que haría el navegador.
        i = finDeDescartada(html, nombre, i);
      }
      continue;
    }

    nombre = EQUIVALENTES[nombre] ?? nombre;
    if (!PERMITIDAS.has(nombre)) continue; // etiqueta fuera de la lista: se va, su texto se queda

    if (SIN_CIERRE.has(nombre)) {
      if (!esCierre) salida += `<${nombre}>`;
      continue;
    }
    if (esCierre) {
      cerrarHasta(nombre);
    } else if (abiertas.length < MAX_DEPTH) {
      abiertas.push(nombre);
      salida += `<${nombre}>`; // SIN atributos, siempre
    }
  }

  while (abiertas.length > 0) salida += `</${abiertas.pop()}>`;
  return salida.trim();
}

/** ¿Queda algo que leer? `<p><br></p>` es una plantilla vacía. */
export function isBlankHtml(html: string): boolean {
  return decodificar(html.replace(/<[^>]*>/g, "")).replace(/[\s ]/g, "").length === 0;
}

// Del HTML guardado de un documento a BLOQUES que un PDF sabe pintar.
//
// La entrada es SIEMPRE lo que dejó `@/lib/document-templates/sanitize`:
// etiquetas de su lista blanca, con solo sus atributos enumerados escritos
// entre comillas dobles, y el texto escapado. Por eso basta un recorrido lineal
// para armar el árbol y no hace falta un parser de HTML de verdad.
//
// TOLERANTE a propósito: lo guardado antes de normalizar (`<li><p>x</p></li>`
// de Tiptap), una celda suelta o un párrafo dentro de una tabla no pierden ni
// la viñeta ni el texto. Lo que no se entiende se lee como texto corrido.
//
// Hoy esto es el PDF de RESPALDO (@react-pdf): el bueno saldrá de la misma hoja
// HTML con Chromium. Una imagen aquí es un hueco con su descripción: @react-pdf
// no lee webp y el PDF de respaldo no puede fallar por una foto.
//
// PURO: sin React ni @react-pdf. Lo usa el PDF y el texto plano del correo.

export interface Tramo {
  texto: string;
  negrita: boolean;
  cursiva: boolean;
  subrayado: boolean;
  /** Tamaño de letra del editor en puntos (`span[data-tamano]`); null = el del cuerpo. */
  tamano: number | null;
}

export type Alineacion = "izquierda" | "centro" | "derecha" | "justificado";

export interface Celda {
  encabezado: boolean;
  colspan: number;
  rowspan: number;
  bloques: Bloque[];
}

export type Bloque =
  | { tipo: "parrafo" | "h1" | "h2" | "h3"; tramos: Tramo[]; sangria: number; alineacion: Alineacion | null }
  | { tipo: "item"; marca: string; nivel: number; tramos: Tramo[] }
  | { tipo: "tabla"; filas: Celda[][] }
  | { tipo: "columnas"; columnas: Bloque[][] }
  | {
      tipo: "imagen";
      /** La clave en el bucket (`documentos/<clínica>/<id>.webp`). */
      archivo: string;
      ancho: "chico" | "medio" | "completo";
      alineacion: "izquierda" | "centro" | "derecha";
      alt: string;
    }
  | { tipo: "firma"; lado: "izquierda" | "centro" | "derecha"; tramos: Tramo[] }
  | { tipo: "salto" };

// &nbsp; sale como espacio normal: Helvetica (WinAnsi) en el PDF no necesita el duro.
const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : todo;
    }
    return ENTIDADES[e.toLowerCase()] ?? todo;
  });
}

/* ─── 1. El árbol ─────────────────────────────────────────────────────── */

interface Nodo {
  tag: string;
  attrs: Record<string, string>;
  hijos: (Nodo | string)[];
}

const VACIAS = new Set(["br", "img"]);

function arbol(html: string): Nodo {
  const raiz: Nodo = { tag: "", attrs: {}, hijos: [] };
  const pila: Nodo[] = [raiz];
  const partes = /<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9-]*(?:="[^"]*")?)*)\s*\/?>|([^<]+)|(<)/gi;
  let m: RegExpExecArray | null;
  while ((m = partes.exec(html ?? "")) !== null) {
    const arriba = pila[pila.length - 1];
    if (m[4] !== undefined || m[5] !== undefined) {
      arriba.hijos.push(m[4] ?? "<");
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      // Se cierra hasta la abierta con ese nombre; un cierre huérfano no hace nada.
      for (let k = pila.length - 1; k > 0; k--) {
        if (pila[k].tag === tag) {
          pila.length = k;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/gi)) {
      attrs[a[1].toLowerCase()] = decodificar(a[2] ?? "");
    }
    const nodo: Nodo = { tag, attrs, hijos: [] };
    arriba.hijos.push(nodo);
    if (!VACIAS.has(tag)) pila.push(nodo);
  }
  return raiz;
}

/* ─── 2. Del árbol a bloques ─────────────────────────────────────────── */

const TITULOS = new Set(["h1", "h2", "h3"]);
const ALINEACIONES = new Set(["izquierda", "centro", "derecha", "justificado"]);
const LADOS = new Set(["izquierda", "centro", "derecha"]);
const ANCHOS = new Set(["chico", "medio", "completo"]);

function tieneTexto(tramos: Tramo[]): boolean {
  return tramos.some((t) => t.texto.trim() !== "");
}

interface Marcas {
  negrita: number;
  cursiva: number;
  subrayado: number;
  tamano: number | null;
}

/**
 * Recorre un trozo del árbol y deja sus bloques en `salida`. Cada celda y cada
 * columna se recorren con su propio Lector: su lista y su numeración empiezan
 * de cero, y un salto de página solo vale en el cuerpo, no dentro de ellas.
 */
class Lector {
  private actual: Bloque | null = null;
  /** El ítem del <li> abierto: un <p> dentro de él sigue en el mismo ítem. */
  private itemAbierto: Bloque | null = null;
  private listas: { ordenada: boolean; n: number }[] = [];
  private marcas: Marcas = { negrita: 0, cursiva: 0, subrayado: 0, tamano: null };

  constructor(private salida: Bloque[], private enCuerpo: boolean) {}

  private cerrar() {
    const b = this.actual;
    this.actual = null;
    if (!b || !("tramos" in b)) return;
    // Un bloque sin una sola letra (un <p><br></p> del editor) se descarta: el
    // aire entre párrafos lo pone el margen, no un renglón vacío. La firma se
    // queda aunque no lleve nombre: es la raya donde se firma.
    if (b.tipo === "firma" || tieneTexto(b.tramos)) this.salida.push(b);
  }

  private abrir(b: Bloque) {
    this.cerrar();
    this.actual = b;
  }

  private escribir(texto: string) {
    if (!this.actual) {
      if (texto.trim() === "") return; // saltos de línea entre etiquetas
      this.actual = { tipo: "parrafo", tramos: [], sangria: 0, alineacion: null };
    }
    if (!("tramos" in this.actual)) return;
    const m = this.marcas;
    this.actual.tramos.push({
      texto, negrita: m.negrita > 0, cursiva: m.cursiva > 0, subrayado: m.subrayado > 0, tamano: m.tamano,
    });
  }

  /** Dentro de un renglón (ítem, firma): un bloque más es un salto de línea, no un bloque nuevo. */
  private seguirEnRenglon(): boolean {
    const b = this.actual;
    if (!b || (b !== this.itemAbierto && b.tipo !== "firma")) return false;
    if ("tramos" in b && tieneTexto(b.tramos)) this.escribir("\n");
    return true;
  }

  leer(nodos: (Nodo | string)[]) {
    for (const n of nodos) {
      if (typeof n === "string") this.escribir(decodificar(n.replace(/\s+/g, " ")));
      else this.nodo(n);
    }
  }

  terminar() {
    this.cerrar();
  }

  private conMarca(n: Nodo, cambio: (m: Marcas) => Marcas) {
    const antes = this.marcas;
    this.marcas = cambio(antes);
    this.leer(n.hijos);
    this.marcas = antes;
  }

  private nodo(n: Nodo) {
    const tag = n.tag;
    if (tag === "br") return this.escribir("\n");
    if (tag === "b" || tag === "strong") return this.conMarca(n, (m) => ({ ...m, negrita: m.negrita + 1 }));
    if (tag === "i" || tag === "em") return this.conMarca(n, (m) => ({ ...m, cursiva: m.cursiva + 1 }));
    if (tag === "u") return this.conMarca(n, (m) => ({ ...m, subrayado: m.subrayado + 1 }));
    if (tag === "span") {
      const t = Number(n.attrs["data-tamano"]);
      return this.conMarca(n, (m) => ({ ...m, tamano: Number.isFinite(t) && t > 0 ? t : m.tamano }));
    }
    if (tag === "img") return this.imagen(n);
    if (tag === "ul" || tag === "ol") return this.lista(n, tag === "ol");
    if (tag === "li") return this.item(n);
    if (tag === "table") return this.tabla(n);
    if (tag === "div") {
      const tipo = n.attrs["data-tipo"];
      if (tipo === "salto-pagina") {
        this.cerrar();
        if (this.enCuerpo) this.salida.push({ tipo: "salto" });
        return;
      }
      if (tipo === "columnas") return this.columnas(n);
      if (tipo === "linea-firma") return this.firma(n);
      // Una columna suelta (o cualquier otro div): su contenido, sin más.
      return this.leer(n.hijos);
    }
    if (tag === "p" || TITULOS.has(tag)) {
      if (this.seguirEnRenglon()) return this.leer(n.hijos);
      const sangria = Math.max(0, Math.min(6, Number(n.attrs["data-sangria"]) || 0));
      const al = n.attrs["data-alineacion"];
      this.abrir({
        tipo: tag === "p" ? "parrafo" : (tag as "h1" | "h2" | "h3"),
        tramos: [],
        sangria,
        alineacion: ALINEACIONES.has(al) ? (al as Alineacion) : null,
      });
      this.leer(n.hijos);
      this.cerrar();
      return;
    }
    // Cualquier otra etiqueta (thead, tr o td fuera de su tabla…): su texto sigue.
    this.leer(n.hijos);
  }

  private lista(n: Nodo, ordenada: boolean) {
    this.cerrar();
    const itemDeFuera = this.itemAbierto;
    this.listas.push({ ordenada, n: 0 });
    this.leer(n.hijos);
    this.cerrar();
    this.listas.pop();
    this.itemAbierto = itemDeFuera;
  }

  private item(n: Nodo) {
    const lista = this.listas[this.listas.length - 1];
    if (lista) lista.n += 1;
    const item: Bloque = {
      tipo: "item",
      marca: lista?.ordenada ? `${lista.n}.` : "•",
      nivel: Math.max(0, this.listas.length - 1),
      tramos: [],
    };
    const itemDeFuera = this.itemAbierto;
    this.abrir(item);
    this.itemAbierto = item;
    this.leer(n.hijos);
    this.cerrar();
    this.itemAbierto = itemDeFuera;
  }

  private imagen(n: Nodo) {
    if (this.actual?.tipo === "firma") return; // una firma es un renglón de texto
    this.cerrar();
    const a = n.attrs;
    this.salida.push({
      tipo: "imagen",
      archivo: a["data-archivo"] ?? "",
      ancho: ANCHOS.has(a["data-ancho"]) ? (a["data-ancho"] as "chico" | "medio" | "completo") : "medio",
      alineacion: LADOS.has(a["data-alineacion"]) ? (a["data-alineacion"] as "izquierda" | "centro" | "derecha") : "centro",
      alt: (a.alt ?? "").trim(),
    });
  }

  private firma(n: Nodo) {
    if (this.seguirEnRenglon()) return this.leer(n.hijos);
    const lado = n.attrs["data-lado"];
    this.abrir({ tipo: "firma", lado: LADOS.has(lado) ? (lado as "izquierda" | "centro" | "derecha") : "izquierda", tramos: [] });
    this.leer(n.hijos);
    this.cerrar();
  }

  private aparte(nodos: (Nodo | string)[]): Bloque[] {
    const bloques: Bloque[] = [];
    const l = new Lector(bloques, false);
    l.leer(nodos);
    l.terminar();
    return bloques;
  }

  private columnas(n: Nodo) {
    this.cerrar();
    const columnas: Bloque[][] = [];
    let suelto: (Nodo | string)[] = [];
    const soltar = () => {
      if (suelto.length > 0) columnas.push(this.aparte(suelto));
      suelto = [];
    };
    for (const h of n.hijos) {
      if (typeof h !== "string" && h.tag === "div" && h.attrs["data-tipo"] === "columna") {
        soltar();
        columnas.push(this.aparte(h.hijos));
      } else {
        suelto.push(h);
      }
    }
    soltar();
    const conAlgo = columnas.filter((c) => c.length > 0);
    if (conAlgo.length > 0) this.salida.push({ tipo: "columnas", columnas });
  }

  private tabla(n: Nodo) {
    this.cerrar();
    const filas: Celda[][] = [];
    const fuera: (Nodo | string)[] = [];
    const fila = (tr: Nodo) => {
      const celdas: Celda[] = [];
      for (const h of tr.hijos) {
        if (typeof h !== "string" && (h.tag === "td" || h.tag === "th")) {
          celdas.push({
            encabezado: h.tag === "th",
            colspan: Math.max(1, Number(h.attrs.colspan) || 1),
            rowspan: Math.max(1, Number(h.attrs.rowspan) || 1),
            bloques: this.aparte(h.hijos),
          });
        } else {
          fuera.push(h);
        }
      }
      if (celdas.length > 0) filas.push(celdas);
    };
    for (const h of n.hijos) {
      if (typeof h === "string") fuera.push(h);
      else if (h.tag === "tr") fila(h);
      else if (h.tag === "thead" || h.tag === "tbody") {
        for (const g of h.hijos) {
          if (typeof g !== "string" && g.tag === "tr") fila(g);
          else fuera.push(g);
        }
      } else fuera.push(h);
    }
    // Lo que el navegador sacaría de la tabla (texto suelto entre filas) va antes, como allí.
    for (const b of this.aparte(fuera)) this.salida.push(b);
    if (filas.length > 0) this.salida.push({ tipo: "tabla", filas });
  }
}

export function htmlABloques(html: string): Bloque[] {
  const bloques: Bloque[] = [];
  const l = new Lector(bloques, true);
  l.leer(arbol(html).hijos);
  l.terminar();
  return bloques;
}

/* ─── 3. Texto plano ──────────────────────────────────────────────────── */

function textoDe(tramos: Tramo[]): string {
  return tramos.map((t) => t.texto).join("").trim();
}

function bloquesATexto(bloques: Bloque[]): string[] {
  const lineas: string[] = [];
  for (const b of bloques) {
    if (b.tipo === "item") lineas.push(`${"  ".repeat(b.nivel)}${b.marca} ${textoDe(b.tramos)}`);
    else if (b.tipo === "tabla") {
      lineas.push(
        b.filas
          .map((f) => f.map((c) => bloquesATexto(c.bloques).join(" ").replace(/\s*\n\s*/g, " ")).join(" | "))
          .join("\n"),
      );
    } else if (b.tipo === "columnas") lineas.push(...b.columnas.flatMap(bloquesATexto));
    else if (b.tipo === "imagen") lineas.push(b.alt ? `[Imagen: ${b.alt}]` : "[Imagen]");
    else if (b.tipo === "firma") lineas.push(["______________________________", textoDe(b.tramos)].filter(Boolean).join("\n"));
    else if (b.tipo !== "salto") lineas.push(textoDe(b.tramos));
  }
  return lineas.filter((l) => l !== "");
}

/** El documento como texto plano (cuerpo alterno del correo). */
export function htmlATexto(html: string): string {
  return bloquesATexto(htmlABloques(html)).join("\n\n");
}

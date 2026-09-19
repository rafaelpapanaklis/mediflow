// Del HTML guardado de un documento a BLOQUES que un PDF sabe pintar.
//
// La entrada es SIEMPRE lo que dejó `@/lib/document-templates/sanitize`:
// etiquetas de su lista blanca (p, br, b, strong, i, em, u, ul, ol, li, h1-h3)
// SIN ningún atributo y con el texto escapado. Por eso basta un recorrido
// lineal y no hace falta un parser de HTML de verdad: lo que no sea una de esas
// etiquetas ya no está.
//
// PURO: sin React ni @react-pdf. Lo usa el PDF y el texto plano del correo.

export interface Tramo {
  texto: string;
  negrita: boolean;
  cursiva: boolean;
  subrayado: boolean;
}

export type Bloque =
  | { tipo: "parrafo" | "h1" | "h2" | "h3"; tramos: Tramo[] }
  | { tipo: "item"; marca: string; nivel: number; tramos: Tramo[] };

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

const TITULOS = new Set(["h1", "h2", "h3"]);

export function htmlABloques(html: string): Bloque[] {
  const bloques: Bloque[] = [];
  const listas: { ordenada: boolean; n: number }[] = [];
  let actual: Bloque | null = null;
  let negrita = 0;
  let cursiva = 0;
  let subrayado = 0;

  const cerrar = () => {
    if (!actual) return;
    // Un bloque sin una sola letra (un <p><br></p> del editor) se descarta: el
    // aire entre párrafos lo pone el margen, no un renglón vacío.
    const tieneTexto = actual.tramos.some((t) => t.texto.trim() !== "");
    if (tieneTexto) bloques.push(actual);
    actual = null;
  };
  const abrir = (b: Bloque) => {
    cerrar();
    actual = b;
  };
  const escribir = (texto: string) => {
    if (!actual) {
      if (texto.trim() === "") return; // saltos de línea entre etiquetas
      actual = { tipo: "parrafo", tramos: [] };
    }
    actual.tramos.push({ texto, negrita: negrita > 0, cursiva: cursiva > 0, subrayado: subrayado > 0 });
  };

  const partes = /<(\/?)([a-z][a-z0-9]*)\s*\/?>|([^<]+)|(<)/gi;
  let m: RegExpExecArray | null;
  while ((m = partes.exec(html ?? "")) !== null) {
    if (m[3] !== undefined) {
      escribir(decodificar(m[3].replace(/\s+/g, " ")));
      continue;
    }
    if (m[4] !== undefined) {
      escribir("<");
      continue;
    }
    const cierra = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "br") {
      if (!cierra) escribir("\n");
    } else if (tag === "b" || tag === "strong") {
      negrita = Math.max(0, negrita + (cierra ? -1 : 1));
    } else if (tag === "i" || tag === "em") {
      cursiva = Math.max(0, cursiva + (cierra ? -1 : 1));
    } else if (tag === "u") {
      subrayado = Math.max(0, subrayado + (cierra ? -1 : 1));
    } else if (tag === "ul" || tag === "ol") {
      cerrar();
      if (cierra) listas.pop();
      else listas.push({ ordenada: tag === "ol", n: 0 });
    } else if (tag === "li") {
      if (cierra) cerrar();
      else {
        const lista = listas[listas.length - 1];
        if (lista) lista.n += 1;
        abrir({
          tipo: "item",
          marca: lista?.ordenada ? `${lista.n}.` : "•",
          nivel: Math.max(0, listas.length - 1),
          tramos: [],
        });
      }
    } else if (tag === "p" || TITULOS.has(tag)) {
      if (cierra) cerrar();
      else abrir({ tipo: tag === "p" ? "parrafo" : (tag as "h1" | "h2" | "h3"), tramos: [] });
    }
    // Cualquier otra etiqueta no debería existir tras el saneado: se ignora.
  }
  cerrar();
  return bloques;
}

/** El documento como texto plano (cuerpo alterno del correo). */
export function htmlATexto(html: string): string {
  return htmlABloques(html)
    .map((b) => {
      const texto = b.tramos.map((t) => t.texto).join("").trim();
      return b.tipo === "item" ? `${"  ".repeat(b.nivel)}${b.marca} ${texto}` : texto;
    })
    .join("\n\n");
}

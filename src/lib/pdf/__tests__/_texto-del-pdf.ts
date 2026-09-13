/**
 * Lo que un PDF de @react-pdf PINTA DENTRO DE LA HOJA, página a página.
 *
 * Mirar el árbol de React no basta, y buscar el texto en el archivo tampoco:
 * con `lineHeight` en la página, @react-pdf 4.x escribía el pie con el
 * «Página N de M» en el flujo… pero FUERA de la hoja, así que nadie lo veía
 * impreso. Aquí se leen los flujos de contenido del archivo final, sin
 * dependencias: se inflan con zlib, se sigue la matriz de transformación
 * (`q`/`Q`/`cm`/`Tm`) y se anota dónde cae cada `Tj`/`TJ`. Vale para las
 * fuentes estándar (Helvetica), que @react-pdf escribe en hexadecimal WinAnsi,
 * y para el formato que emite pdfkit (un operador por renglón).
 *
 * No es un `.test.ts`: no se ejecuta solo, lo importan las pruebas.
 */
import zlib from "node:zlib";

export interface TextoPintado {
  s: string;
  /** Origen del texto en puntos PDF (0,0 abajo a la izquierda). */
  x: number;
  y: number;
}

type Matriz = [number, number, number, number, number, number];
const IDENTIDAD: Matriz = [1, 0, 0, 1, 0, 0];

/** m × n, en la convención de PDF (vectores fila). */
function mult(m: Matriz, n: Matriz): Matriz {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function decodificar(hex: string): string {
  const limpio = hex.replace(/\s+/g, "");
  return Buffer.from(limpio.length % 2 ? `${limpio}0` : limpio, "hex").toString("latin1");
}

const SEIS_NUMEROS = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (cm|Tm)$/;

/** Bytes (inflados) del flujo del objeto `num`, o null si no hay o no infla. */
function flujoDelObjeto(pdf: Buffer, bruto: string, num: string): string | null {
  const obj = new RegExp(`(?:^|[\\r\\n])${num} 0 obj\\b`).exec(bruto);
  if (!obj) return null;
  const marca = /stream\r?\n/.exec(bruto.slice(obj.index));
  const cierre = bruto.indexOf("endobj", obj.index);
  if (!marca || (cierre >= 0 && obj.index + marca.index > cierre)) return null;
  const inicio = obj.index + marca.index + marca[0].length;
  const fin = bruto.indexOf("endstream", inicio);
  if (fin < 0) return null;
  try {
    return zlib.inflateSync(pdf.subarray(inicio, fin)).toString("latin1");
  } catch {
    return null;
  }
}

/**
 * Los textos de cada página, EN ORDEN DE PÁGINA, con su posición. El orden de
 * los flujos dentro del archivo no es el de las páginas (pdfkit los escribe
 * como le viene): se sigue `/Pages /Kids` → cada `/Page` → su `/Contents`. Así
 * tampoco se cuela un flujo de imagen como si fuera una página.
 */
export function textosPintados(pdf: Buffer): TextoPintado[][] {
  const bruto = pdf.toString("latin1");
  const kids = /\/Type \/Pages[\s\S]*?\/Kids \[([^\]]*)\]/.exec(bruto);
  const numerosPagina = kids ? [...kids[1].matchAll(/(\d+) 0 R/g)].map((k) => k[1]) : [];
  const paginas: TextoPintado[][] = [];
  for (const numPagina of numerosPagina) {
    const inicioPagina = new RegExp(`(?:^|[\\r\\n])${numPagina} 0 obj\\b`).exec(bruto);
    const dic = inicioPagina ? bruto.slice(inicioPagina.index, bruto.indexOf("endobj", inicioPagina.index)) : "";
    const contents = /\/Contents (\d+) 0 R/.exec(dic);
    const contenido = contents ? flujoDelObjeto(pdf, bruto, contents[1]) : null;
    if (contenido == null) {
      paginas.push([]);
      continue;
    }

    const textos: TextoPintado[] = [];
    const pila: Matriz[] = [];
    let ctm: Matriz = IDENTIDAD;
    let tm: Matriz = IDENTIDAD;
    for (const renglon of contenido.split(/\r?\n/)) {
      const op = renglon.trim();
      if (op === "q") pila.push(ctm);
      else if (op === "Q") ctm = pila.pop() ?? IDENTIDAD;
      else if (op === "BT") tm = IDENTIDAD;
      else {
        const seis = SEIS_NUMEROS.exec(op);
        if (seis) {
          const mat = seis.slice(1, 7).map(Number) as Matriz;
          if (seis[7] === "cm") ctm = mult(mat, ctm);
          else tm = mat;
          continue;
        }
        let s: string | null = null;
        const tj = /^\[(.*)\]\s*TJ$/.exec(op);
        if (tj) s = (tj[1].match(/<([0-9a-fA-F\s]*)>/g) ?? []).map((h) => decodificar(h.slice(1, -1))).join("");
        const tjSolo = /^<([0-9a-fA-F\s]*)>\s*Tj$/.exec(op);
        if (tjSolo) s = decodificar(tjSolo[1]);
        if (s !== null) {
          const pos = mult(tm, ctm);
          textos.push({ s, x: pos[4], y: pos[5] });
        }
      }
    }
    paginas.push(textos);
  }
  return paginas;
}

/**
 * Cuánto aire queda entre el cuerpo y el pie en cada página: la línea base del
 * texto del cuerpo más bajo menos la del renglón del pie más alto. El pie son
 * los renglones donde aparece algo que cumple `esPie` (un renglón = una misma
 * línea base, porque @react-pdf parte un texto en varios `TJ`).
 *
 * Por qué importa: el pie lleva un filete arriba y va `fixed`; si el cuerpo no
 * le deja sitio, el filete TACHA el último renglón (pasó con el «Subtotal» del
 * comprobante). Con letra de 8–10 pt y el filete a ~8 pt del pie, menos de
 * ~18 pt de separación ya es un renglón cruzado.
 */
export function separacionCuerpoPie(
  pdf: Buffer,
  esPie: (s: string) => boolean,
): Array<{ cuerpoMasBajo: number; pieMasAlto: number; separacion: number }> {
  return textosPintados(pdf).map((textos) => {
    const lineasPie = textos.filter((t) => esPie(t.s)).map((t) => t.y);
    const delPie = (t: TextoPintado) => lineasPie.some((y) => Math.abs(y - t.y) < 0.5);
    // Sin pie reconocible la medida no vale: NaN hace fallar cualquier `>=`.
    if (lineasPie.length === 0) return { cuerpoMasBajo: NaN, pieMasAlto: NaN, separacion: NaN };
    const pieMasAlto = Math.max(...textos.filter(delPie).map((t) => t.y));
    const cuerpo = textos.filter((t) => !delPie(t) && t.s.trim());
    const cuerpoMasBajo = cuerpo.length ? Math.min(...cuerpo.map((t) => t.y)) : Infinity;
    return { cuerpoMasBajo, pieMasAlto, separacion: cuerpoMasBajo - pieMasAlto };
  });
}

/**
 * El texto VISIBLE de cada página, de arriba abajo, con la caja de la hoja
 * como filtro (carta: 612 × 792). Lo que cae fuera no se imprime.
 */
export function textoVisiblePorPagina(pdf: Buffer, ancho = 612, alto = 792): string[] {
  return textosPintados(pdf).map((textos) =>
    textos
      .filter((t) => t.x >= 0 && t.x <= ancho && t.y >= 0 && t.y <= alto)
      .map((t) => t.s)
      .join("")
      .replace(/\s+/g, " "),
  );
}

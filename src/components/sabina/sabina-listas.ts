/**
 * Sabina — cómo se leen las listas, las cantidades y las tablas de una respuesta.
 *
 * Reglas PURAS (sin React), igual que `sabina-core.ts`, que es quien las usa al
 * partir el texto en bloques; `message-content.tsx` las usa al pintarlos.
 *
 * Existe por el 14-sep-2026: Rafael pidió «enlista los pacientes que deben» y le
 * llegó una tira de nombres y montos separados por comas. Parte de la culpa era
 * del prompt, pero la pantalla también aplastaba: una lista numerada («1. Ana…»),
 * unas líneas sin viñeta o una tabla de markdown salían pegadas en un solo párrafo.
 * Arreglarlo aquí no cuesta un token: vale para lo que el modelo ya escribe bien.
 */

/* ── Cantidades en pesos ────────────────────────────────────────────────── */

/**
 * Un importe escrito con signo de pesos: «$1,500», «$1500.5», «$ 820.00», y en
 * negativo «-$500» o «$-500». Los miles tienen que ir de tres en tres para que
 * «$1,500, vencido» no se trague la coma de la frase. Sin signo de pesos no se
 * toca: «1500» puede ser un folio. El menos solo cuenta PEGADO: en «Ana - $500» el
 * guion separa, no resta.
 */
const MONTO = /[-−]?\$\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?!\d)/g;

/** «$1.5 millones», «$3 mil»: es una escala, no un importe que se pueda alinear. */
const ESCALA_DETRAS = /^\s*(mil|millon|millones|mdp|k|m)\b/i;

/**
 * Lo que separa la etiqueta de la cantidad: «Ana — $1,500», «Ana: $1,500». La coma
 * NO: «Facturaste bien este mes, $45,000 en total» es una frase, no una fila.
 */
const SEPARADOR_FINAL = /\s*[—–\-:·|=]\s*$/;
const SEPARADOR_INICIAL = /^\s*[—–\-:·|,]\s*/;

function montosDe(texto: string): RegExpExecArray[] {
  const encontrados: RegExpExecArray[] = [];
  const re = new RegExp(MONTO.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    if (!ESCALA_DETRAS.test(texto.slice(m.index + m[0].length))) encontrados.push(m);
  }
  return encontrados;
}

function valorDe(monto: string): number {
  const negativo = /[-−]/.test(monto);
  const n = Number(monto.replace(/[-−$\s,]/g, ""));
  return negativo ? -n : n;
}

/** «$1500.5» con 2 decimales → «$1,500.50»; −500 → «-$500». Sin `Intl` a propósito: igual en Node y en cualquier navegador. */
export function formatearPesos(valor: number, decimales: 0 | 2): string {
  const [entero, fraccion] = Math.abs(valor).toFixed(decimales).split(".");
  const signo = valor < 0 && Number(Math.abs(valor).toFixed(decimales)) !== 0 ? "-" : "";
  return `${signo}$${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraccion ? `.${fraccion}` : ""}`;
}

/* ── Filas «etiqueta — cantidad» ────────────────────────────────────────── */

export interface FilaConMonto {
  /** Lo que va a la izquierda: «Ana López». Puede traer `**negrita**`. */
  etiqueta: string;
  /** La cantidad, ya con la forma común de su lista. */
  monto: string;
  /** Lo que venía detrás de la cantidad: «(2 facturas)». "" si nada. */
  detalle: string;
}

/**
 * «Ana López — $1,500 (2 facturas)» → etiqueta, cantidad y detalle.
 *
 * A propósito conservador: tiene que haber UNA sola cantidad y un separador justo
 * antes. «Ana debe $1,500 desde agosto» o «$1,500 de $3,000» no son filas de una
 * cuenta, y partirlas en dos columnas las volvería ilegibles. Si no encaja, `null`
 * y el elemento se pinta como una viñeta normal.
 */
export function partirFilaConMonto(texto: string): Omit<FilaConMonto, "monto"> & { montoCrudo: string } | null {
  const montos = montosDe(texto);
  if (montos.length !== 1) return null;
  const m = montos[0];
  // «Ana — **$1,500**» y «**Ana:** $1,500»: las marcas de negrita pegadas no cuentan.
  const antes = texto.slice(0, m.index).replace(/[*\s]+$/, "");
  if (!SEPARADOR_FINAL.test(antes)) return null;
  let etiqueta = antes.replace(SEPARADOR_FINAL, "").trim();
  // Si al quitar el separador quedó una negrita a medias («**Ana»), fuera las marcas.
  if ((etiqueta.match(/\*\*/g) ?? []).length % 2 === 1) etiqueta = etiqueta.replace(/\*\*/g, "");
  if (!etiqueta.replace(/\*/g, "").trim()) return null;
  const detalle = texto
    .slice(m.index + m[0].length)
    .replace(/^\*\*/, "")
    .replace(SEPARADOR_INICIAL, "")
    .trim();
  return { etiqueta, montoCrudo: m[0], detalle };
}

/**
 * ¿Este renglón SUELTO (sin viñeta) es la fila de una cuenta?
 *
 * Más estricto que `partirFilaConMonto`, porque aquí nadie dijo «esto es una
 * lista»: la etiqueta es corta (un nombre, un concepto) y sin punto de frase, y
 * detrás de la cantidad no hay más que un paréntesis. Así «Cobrado: $45,000» y
 * debajo «Pendiente: $12,000» se vuelven lista, y dos frases con una cifra cada
 * una («El mes que viene pinta mejor: $52,000 proyectados.») se quedan en párrafo.
 */
export function esRenglonDeCuenta(texto: string): boolean {
  const fila = partirFilaConMonto(texto);
  if (!fila) return false;
  const palabras = fila.etiqueta.replace(/\*/g, "").trim().split(/\s+/).length;
  return palabras <= 6 && !/[.;!?¿¡]/.test(fila.etiqueta) && (fila.detalle === "" || /^\(.*\)$/.test(fila.detalle));
}

/**
 * Una lista entera como filas con su cantidad a la derecha, o `null` si no lo es.
 *
 * Solo si TODOS los elementos encajan y son dos o más: una lista mezclada se deja
 * como viñetas. Y todas las cantidades salen con la misma forma: si una lleva
 * centavos (o el modelo los escribió), todas los llevan. «$1,500» encima de
 * «$820.50» no se lee en diagonal.
 */
export function filasConMonto(items: readonly string[]): FilaConMonto[] | null {
  if (items.length < 2) return null;
  const partidas = items.map(partirFilaConMonto);
  if (partidas.some((p) => p === null)) return null;
  const filas = partidas as NonNullable<ReturnType<typeof partirFilaConMonto>>[];
  const valores = filas.map((f) => valorDe(f.montoCrudo));
  if (valores.some((v) => !Number.isFinite(v))) return null;
  const conCentavos = filas.some((f, i) => f.montoCrudo.includes(".") || !Number.isInteger(Math.round(valores[i] * 100) / 100));
  return filas.map((f, i) => ({
    etiqueta: f.etiqueta,
    monto: formatearPesos(valores[i], conCentavos ? 2 : 0),
    detalle: f.detalle,
  }));
}

/* ── Marcadores de lista ────────────────────────────────────────────────── */

const VINETA = /^[-•*]\s+/;
const NUMERO = /^\d{1,3}[.)]\s+/;

/** `"bullet"` para «- », «• », «* »; `"number"` para «1. », «2) »; `null` si no es lista. */
export function tipoDeElemento(linea: string): "bullet" | "number" | null {
  const t = linea.trim();
  if (VINETA.test(t)) return "bullet";
  if (NUMERO.test(t)) return "number";
  return null;
}

/** El texto del elemento sin su marcador. */
export function sinMarcador(linea: string): string {
  return linea.trim().replace(VINETA, "").replace(NUMERO, "");
}

/* ── Tablas de markdown ─────────────────────────────────────────────────── */

const SEPARADOR_TABLA = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

/** «| Ana | $1,500 |» → ["Ana", "$1,500"]. */
export function celdasDe(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** ¿Empieza una tabla en `i`? Encabezado con «|» y, debajo, la línea de guiones. */
export function empiezaTabla(lineas: readonly string[], i: number): boolean {
  const cabeza = lineas[i]?.trim() ?? "";
  const regla = lineas[i + 1]?.trim() ?? "";
  return cabeza.includes("|") && SEPARADOR_TABLA.test(regla) && celdasDe(cabeza).length === celdasDe(regla).length;
}

/** «$1,500», «12», «40 %», «**$3,000**»: se alinea a la derecha. */
const CELDA_NUMERICA = /^[*\s]*[-+]?\$?\s?[\d.,]+\s?%?[*\s]*$/;

/** Qué columnas son de números: todas sus celdas con algo lo son. */
export function columnasNumericas(filas: readonly (readonly string[])[], columnas: number): boolean[] {
  return Array.from({ length: columnas }, (_, j) => {
    const llenas = filas.map((f) => (f[j] ?? "").trim()).filter(Boolean);
    return llenas.length > 0 && llenas.every((c) => CELDA_NUMERICA.test(c));
  });
}

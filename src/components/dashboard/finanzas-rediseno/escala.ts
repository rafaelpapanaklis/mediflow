/**
 * La escala del eje de dinero de la gráfica «Ingresos vs Gastos».
 *
 * Separado de la gráfica para poder probarlo sin navegador. Dos reglas que
 * pidió el encargo: cada etiqueta nombra un valor que la gráfica alcanza de
 * verdad (nada de «$1k» para 1,499), y las marcas son números redondos que
 * cubren el máximo de la serie sin pasarse de largo.
 */

/** Pasos «bonitos» de una escala: 1, 2, 2.5, 5 × 10ⁿ. */
function pasoBonito(crudo: number): number {
  const magnitud = 10 ** Math.floor(Math.log10(crudo));
  const norma = crudo / magnitud;
  const factor = norma <= 1 ? 1 : norma <= 2 ? 2 : norma <= 2.5 ? 2.5 : norma <= 5 ? 5 : 10;
  return factor * magnitud;
}

/** Quita el ruido de coma flotante (2.5 × 3 = 7.500000000000001). */
const limpio = (n: number) => Number(n.toPrecision(12));

/**
 * Marcas del eje Y de 0 al primer múltiplo de un paso bonito que cubra `max`.
 * Con `max` ≤ 0 (serie toda en cero) devuelve solo `[0]`.
 */
export function marcasEje(max: number, cuantas = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const paso = pasoBonito(max / Math.max(1, cuantas));
  const n = Math.ceil(limpio(max / paso));
  return Array.from({ length: n + 1 }, (_, i) => limpio(i * paso));
}

/**
 * Etiqueta EXACTA de una marca: «$2.5k», «$12.5k», «$1.25M», «$750». Nunca
 * redondea a una cifra que la marca no vale: si el número no cabe corto, se
 * escribe entero con separador de miles.
 */
export function etiquetaDinero(v: number): string {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const signo = n < 0 ? "−" : "";
  const corto = (x: number, divisor: number, sufijo: string): string | null => {
    const q = limpio(x / divisor);
    // Hasta dos decimales; si hacen falta más, la forma corta mentiría.
    if (limpio(q * 100) % 1 !== 0) return null;
    return `${signo}$${q}${sufijo}`;
  };
  if (abs >= 1_000_000) {
    const m = corto(abs, 1_000_000, "M");
    if (m) return m;
  }
  if (abs >= 1_000) {
    const k = corto(abs, 1_000, "k");
    if (k) return k;
  }
  return `${signo}$${abs.toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
}

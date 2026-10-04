// ─────────────────────────────────────────────────────────────────────────────
// «Pago por control»: de dónde sale cada cifra del Cobro del caso (auditoría de uso, C-59).
//
// En un caso importado la pestaña Cobro decía a la vez «Calendario de
// mensualidades» (6 × $1,333.33 = $8,000), «Colocación y controles $9,800»,
// «Estimado: 4 controles × $300 = $1,200» y, en las notas de la importación,
// «Costo estimado $10,400». Las cuatro eran ciertas, pero ninguna decía de qué
// era: los $8,000 son la COLOCACIÓN (pagada en seis partes), los $1,800 los
// cuatro controles ya facturados (dos a $600 y dos a $300), y el estimado
// multiplicaba los previstos por el precio de HOY sin contar lo ya cobrado.
//
// Aquí se separa: colocación (y en cuántos pagos), controles ya facturados
// (cuántos y cuánto) y los que faltan por venir × el precio por control. El
// estimado del caso = colocación + controles facturados + por venir × precio,
// que con todos los controles ya facturados es EXACTAMENTE «Colocación y
// controles».
//
// PURO: sin Prisma, sin React y sin red. Centavos enteros para no arrastrar
// el error de los decimales.
// ─────────────────────────────────────────────────────────────────────────────

const aC = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);
const aP = (c: number) => c / 100;

export interface CuotaDelCaso {
  importe: number;
  invoiceId?: string | null;
}

export interface DesglosePorControl {
  /** Lo facturado de la colocación/enganche (la factura del caso), en pesos. */
  colocacion: number;
  /** En cuántos pagos se partió la colocación (1 = pago único). */
  pagosDeColocacion: number;
  /** Lo facturado en controles (cada uno su factura), en pesos. */
  controles: number;
  /** Cuántos controles tienen ya su factura. */
  controlesFacturados: number;
}

/**
 * `invoiceIdColocacion` es la factura del caso (`orthodontic_treatment_plans.invoiceId`). Sus cuotas —o las que no
 * traen factura propia, que son las del plan a plazos de esa misma factura— son la colocación; las demás, controles.
 */
export function desglosePorControl(cuotas: readonly CuotaDelCaso[], invoiceIdColocacion: string | null | undefined): DesglosePorControl {
  let colocacionC = 0;
  let pagos = 0;
  let controlesC = 0;
  const facturasDeControl = new Set<string>();
  for (const q of cuotas) {
    const esColocacion = !q.invoiceId || (invoiceIdColocacion != null && q.invoiceId === invoiceIdColocacion);
    if (esColocacion) {
      colocacionC += Math.max(0, aC(q.importe));
      pagos += 1;
    } else {
      controlesC += Math.max(0, aC(q.importe));
      facturasDeControl.add(q.invoiceId!);
    }
  }
  return { colocacion: aP(colocacionC), pagosDeColocacion: pagos, controles: aP(controlesC), controlesFacturados: facturasDeControl.size };
}

/**
 * N-32 (segunda auditoría): el bloque «Extras» listaba TODAS las facturas del caso — la colocación y los controles
 * (MF-1110, 1076, 1075) y repetía MF-1127, que ya está en «Controles por cobrar». Extras son las demás.
 */
export function soloExtras<T extends { invoiceId: string }>(
  extras: readonly T[],
  cuotas: readonly CuotaDelCaso[],
  invoiceIdDelCaso: string | null | undefined,
): T[] {
  const deLaCobranza = new Set(cuotas.map((q) => q.invoiceId).filter((x): x is string => Boolean(x)));
  if (invoiceIdDelCaso) deLaCobranza.add(invoiceIdDelCaso);
  return extras.filter((e) => !deLaCobranza.has(e.invoiceId));
}

export interface EstimadoDelCaso {
  colocacion: number;
  controles: number;
  controlesFacturados: number;
  /** Controles previstos que todavía no tienen factura. */
  porVenir: number;
  /** Precio de cada control por venir; null = no hay de dónde sacarlo. */
  precioPorControl: number | null;
  /** null si faltan controles por venir y no hay precio para estimarlos. */
  total: number | null;
}

/**
 * El estimado del caso en «Pago por control». Los controles por venir son los previstos menos los que ya se
 * atendieron o ya tienen factura (lo que sea MAYOR: un control firmado y aún sin factura no se cuenta dos veces).
 */
export function estimadoDelCasoPorControl(args: {
  desglose: DesglosePorControl;
  previstos: number | null | undefined;
  hechos: number | null | undefined;
  precioPorControl: number | null | undefined;
}): EstimadoDelCaso {
  const d = args.desglose;
  const previstos = args.previstos && args.previstos > 0 ? Math.floor(args.previstos) : 0;
  const yaCuentan = Math.max(Math.floor(args.hechos ?? 0), d.controlesFacturados);
  const porVenir = Math.max(0, previstos - yaCuentan);
  const precio = args.precioPorControl != null && Number.isFinite(args.precioPorControl) && args.precioPorControl > 0 ? args.precioPorControl : null;
  const baseC = aC(d.colocacion) + aC(d.controles);
  const total = porVenir === 0 ? aP(baseC) : precio === null ? null : aP(baseC + aC(precio) * porVenir);
  return { colocacion: d.colocacion, controles: d.controles, controlesFacturados: d.controlesFacturados, porVenir, precioPorControl: precio, total };
}

const pesos = (n: number): string =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(n);

const controles = (n: number) => (n === 1 ? "1 control" : `${n} controles`);

/** «Colocación $8,000 + 4 controles ya facturados $1,800 = $9,800». */
export function textoDelEstimadoDelCaso(e: EstimadoDelCaso): string {
  const partes = [`Colocación ${pesos(e.colocacion)}`];
  if (e.controlesFacturados > 0) partes.push(`${controles(e.controlesFacturados)} ya facturados ${pesos(e.controles)}`);
  if (e.porVenir > 0) {
    partes.push(
      e.precioPorControl !== null
        ? `${controles(e.porVenir)} por venir × ${pesos(e.precioPorControl)}`
        : `${controles(e.porVenir)} por venir (sin precio por control para estimarlos)`,
    );
  }
  return e.total !== null ? `${partes.join(" + ")} = ${pesos(e.total)}` : partes.join(" + ");
}

/** «La colocación ($8,000) se pagó en 6 partes; los controles se cobran aparte, cada uno con su factura.» */
export function tituloPagosDeColocacion(pagos: number): string {
  return pagos > 1 ? `Pagos de la colocación (${pagos})` : "Pago de la colocación";
}

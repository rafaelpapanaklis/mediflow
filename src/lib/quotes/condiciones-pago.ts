// ═══════════════════════════════════════════════════════════════════════════
// CONDICIONES DE PAGO de un presupuesto (WS1-T8) — aritmética pura, sin I/O.
//
// Qué es: la forma en que el paciente va a pagar lo que se le está cotizando.
// Un pago, o varios. Con enganche o sin él. Con un método de los seis que ya
// existen en el panel. NO cobra nada: un presupuesto PROPONE, Caja y
// Facturación son las que mueven dinero.
//
// Este archivo lo comparten el editor del panel (client component), la API, el
// PDF y la página pública, para que el calendario que ve la recepcionista
// mientras lo arma, el que firma el paciente y el que se imprime sean EL MISMO.
//
// ── Las tres reglas que no se negocian ────────────────────────────────────
//
// 1. TODO EN CENTAVOS ENTEROS. Repartir con floats pierde centavos: 30000/7 en
//    pesos da 4285.714285714285, y seis redondeos a 2 decimales más uno no
//    vuelven a sumar 30000. Aquí se divide `Math.round(monto*100)` entre N con
//    división entera y el residuo se reparte de a UN centavo. La suma de las
//    mensualidades es SIEMPRE, exactamente, el total. Sin tolerancia.
//
// 2. EL TOTAL NO LO DECIDE ESTE ARCHIVO. Sale de `invoiceFieldsFromQuote`
//    (lib/quotes/invoice-from-quote-core), la MISMA función con la que el
//    servidor arma la factura que se cobra y se timbra. Ver `totalACobrar`.
//    Un presupuesto que enseña $30,000 y factura $29,999.98 es un desfase de
//    centavos entre pantalla y base, y de eso ya hubo uno.
//
// 3. «MESES SIN INTERESES» NO SE PROMETE AQUÍ. Los MSI los da el BANCO emisor
//    de la tarjeta del paciente a través de la terminal o de la pasarela; el
//    panel no puede diferir un cargo ni fijar una tasa. Lo que sí es verdad es
//    «pago en N mensualidades»: financiamiento de la propia clínica, que es lo
//    que este módulo calcula. Cuando el paciente vaya a diferirlo con SU banco,
//    eso es UN SOLO pago con tarjeta de crédito (la clínica recibe el total) y
//    se anota como tal: `difiereConSuBanco`. Ver `LEYENDA_DIFIERE`.
// ═══════════════════════════════════════════════════════════════════════════

import { invoiceFieldsFromQuote, type QuoteForInvoice } from "./invoice-from-quote-core";

/* ── Vocabulario ──────────────────────────────────────────────────────── */

/** Un pago, o varios. */
export type ModoPago = "unico" | "plazos";
export const MODOS_PAGO: ModoPago[] = ["unico", "plazos"];

/**
 * Cada cuánto cae una mensualidad. Mismas tres palabras que `PLAN_FREQUENCY`
 * (lib/payment-plans/status.ts) para que el día que los planes de pago tengan
 * pantalla no haya que traducir nada entre los dos módulos.
 */
export type FrecuenciaPago = "WEEKLY" | "BIWEEKLY" | "MONTHLY";
export const FRECUENCIAS_PAGO: FrecuenciaPago[] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];

/**
 * Los métodos del selector de cobros (`payment-modal.tsx` → `PaymentMethod`),
 * y NINGUNO más. Se reusan tal cual, en vez de inventar una lista nueva: el día
 * que el presupuesto se cobre de verdad, el método ya es el que Caja entiende.
 * `lib/sabina/dinero/comun.ts` tiene esta misma lista para lo suyo; una prueba
 * comprueba que las dos y la del modal siguen diciendo lo mismo.
 */
export const METODOS_PAGO = ["cash", "debit", "credit", "transfer", "check", "other"] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

/** Cuántos pagos admite un plan. Más de 60 no es un presupuesto, es otra cosa. */
export const MIN_PAGOS = 2;
export const MAX_PAGOS = 60;

/**
 * Con cuántas mensualidades arranca el editor cuando se elige «a plazos». Es
 * una SUGERENCIA de la pantalla, no un valor guardado: un presupuesto de un
 * solo pago tiene `numPagos = 0`, que es lo que significa «aquí no hay plan».
 */
export const PAGOS_SUGERIDOS = 6;

/** Lo que se guarda en `quote_payment_terms`. Todo opcional: un presupuesto sin condiciones es válido. */
export interface CondicionesPago {
  modo: ModoPago;
  /** Método con el que se pagará (o con el que se pagarán las cuotas). */
  metodo: MetodoPago | null;
  /** Primer pago mayor, en pesos. 0 = sin enganche. Solo aplica a "plazos". */
  enganche: number;
  /** Cuántas mensualidades DESPUÉS del enganche. Solo aplica a "plazos". */
  numPagos: number;
  frecuencia: FrecuenciaPago;
  /** Fecha del PRIMER pago del calendario, en "YYYY-MM-DD". null = sin fecha fijada. */
  primerPago: string | null;
  /**
   * El paciente difiere el cargo a meses con SU banco (MSI de la terminal).
   * Es una ANOTACIÓN, no un cálculo: la clínica cobra el total de una sola vez.
   * Solo tiene sentido con modo "unico" y método "credit".
   */
  difiereConSuBanco: boolean;
}

/** Condiciones por defecto: un pago, sin método elegido. Es lo que hay hoy. */
export function condicionesPorDefecto(): CondicionesPago {
  return {
    modo: "unico",
    metodo: null,
    enganche: 0,
    // 0, no 6: un pago único no tiene mensualidades. El 6 que ve la pantalla
    // al cambiar a «a plazos» es PAGOS_SUGERIDOS, y lo pone el editor.
    numPagos: 0,
    frecuencia: "MONTHLY",
    primerPago: null,
    difiereConSuBanco: false,
  };
}

/* ── Saneo ────────────────────────────────────────────────────────────── */

function aNumero(x: unknown): number {
  const n = Number(x);
  return isFinite(n) ? n : 0;
}

/** Redondeo a 2 decimales (MXN). */
export function round2(n: unknown): number {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/** Pesos → centavos enteros. Es la conversión que hace exacta toda la división. */
export function aCentavos(pesos: unknown): number {
  const v = Number(pesos);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100);
}

/** Centavos enteros → pesos. */
export function aPesos(centavos: number): number {
  return Math.round(centavos) / 100;
}

export function esMetodoPago(v: unknown): v is MetodoPago {
  return typeof v === "string" && (METODOS_PAGO as readonly string[]).includes(v);
}

/** "YYYY-MM-DD" válido, o null. Acepta también un ISO completo y se queda con el día. */
export function aFechaSolo(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const [, a, mes, dia] = m;
  const y = Number(a), mm = Number(mes), dd = Number(dia);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  // Rechaza el 31 de febrero y compañía: un calendario de cobro no puede
  // arrancar en un día que no existe.
  const d = new Date(Date.UTC(y, mm - 1, dd));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return `${a}-${mes}-${dia}`;
}

/**
 * Normaliza lo que llega del cliente. NUNCA lanza: un cuerpo basura devuelve
 * las condiciones por defecto, que son exactamente las de hoy.
 *
 * `total` acota el enganche: un enganche mayor que el presupuesto dejaría
 * mensualidades negativas, que es la forma más rápida de que el calendario deje
 * de sumar el total.
 */
export function normalizarCondiciones(raw: unknown, total: number): CondicionesPago {
  const base = condicionesPorDefecto();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;

  const modo: ModoPago = o.modo === "plazos" ? "plazos" : "unico";
  const metodo = esMetodoPago(o.metodo) ? o.metodo : null;

  const totalC = Math.max(0, aCentavos(total));
  const engancheC = modo === "plazos"
    ? Math.min(totalC, Math.max(0, aCentavos(o.enganche)))
    : 0;

  const pedidos = Math.floor(aNumero(o.numPagos));
  const numPagos = modo === "plazos"
    ? Math.min(MAX_PAGOS, Math.max(MIN_PAGOS, isFinite(pedidos) && pedidos > 0 ? pedidos : PAGOS_SUGERIDOS))
    : 0;

  const frecuencia: FrecuenciaPago =
    (FRECUENCIAS_PAGO as string[]).indexOf(String(o.frecuencia)) !== -1
      ? (o.frecuencia as FrecuenciaPago)
      : "MONTHLY";

  return {
    modo,
    metodo,
    enganche: aPesos(engancheC),
    numPagos,
    frecuencia,
    primerPago: aFechaSolo(o.primerPago),
    // Solo se guarda donde significa algo: un pago, con tarjeta de crédito.
    // Marcarlo en un plan a plazos sería prometer MSI sobre el financiamiento
    // de la clínica, que es justo lo que no se puede decir.
    difiereConSuBanco: modo === "unico" && metodo === "credit" && o.difiereConSuBanco === true,
  };
}

/**
 * ¿Estas condiciones dicen algo, o son «no se definió nada»?
 *
 * Un presupuesto a plazos siempre dice algo. Uno de un solo pago solo dice algo
 * si se eligió método: sin él, estas condiciones son exactamente el presupuesto
 * de antes de WS1-T8 y no merecen fila propia ni sección en el PDF.
 */
export function hayCondiciones(c: CondicionesPago | null | undefined): boolean {
  if (!c) return false;
  if (c.modo === "plazos") return true;
  return !!c.metodo;
}

/* ── El total: el mismo que va a facturar el servidor ─────────────────── */

/**
 * El importe que se va a cobrar. NO se suma a mano: se deriva con
 * `invoiceFieldsFromQuote`, la función con la que `createInvoiceFromQuote` y
 * `syncDraftInvoiceFromQuote` arman la factura. Así el número grande del editor
 * es, por construcción, el que va a quedar guardado en `invoices.total`.
 *
 * Los presupuestos no llevan IVA agregado: la factura derivada nace con
 * `taxIncluded = true` (default de la columna), y con el IVA incluido en el
 * precio el total ES la base. Por eso aquí no hay ninguna cuenta de impuestos
 * que hacer — y por eso hay una prueba que lo fija, para que no deje de ser
 * cierto en silencio.
 */
export function totalACobrar(quote: QuoteForInvoice): {
  subtotal: number;
  descuento: number;
  total: number;
} {
  const { subtotal, discount, total } = invoiceFieldsFromQuote(quote);
  return { subtotal, descuento: discount, total };
}

/* ── El calendario ────────────────────────────────────────────────────── */

export interface PagoProgramado {
  /** 0 = enganche; 1..N = mensualidades. */
  numero: number;
  esEnganche: boolean;
  /** Importe en pesos, ya redondeado a centavos exactos. */
  monto: number;
  /** "YYYY-MM-DD", o null si no se fijó primera fecha. */
  fecha: string | null;
}

export interface Calendario {
  pagos: PagoProgramado[];
  /** Suma de `pagos`. Por construcción, idéntica al total. */
  suma: number;
  /** El importe que se repartió. */
  total: number;
  /** Importe de la mensualidad más repetida — el número con el que se vende. */
  montoTipico: number;
  /** true si todas las mensualidades valen lo mismo (no sobró ningún centavo). */
  parejo: boolean;
}

/**
 * Suma `n` periodos a una fecha "YYYY-MM-DD".
 *
 *  - WEEKLY / BIWEEKLY → 7 y 14 días exactos.
 *  - MONTHLY → el MISMO DÍA del mes siguiente, no "+30 días". Un plan a 12
 *    meses con +30 días se adelanta 5 días al año y el último recibo cae en un
 *    día que el paciente no esperaba. Si el día no existe en el mes destino (el
 *    31 en febrero) se usa el último día de ese mes, que es como cobra
 *    cualquier banco.
 *
 * Todo en UTC y a partir de la cadena "YYYY-MM-DD": una fecha sin hora no tiene
 * zona, y construirla con `new Date("2026-10-01")` + `getDate()` la corre un día
 * hacia atrás en cualquier huso al oeste de Greenwich — México entre ellos.
 */
export function sumarPeriodos(fecha: string, frecuencia: FrecuenciaPago, n: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  if (frecuencia !== "MONTHLY") {
    const dias = (frecuencia === "WEEKLY" ? 7 : 14) * n;
    const t = Date.UTC(a, m - 1, d) + dias * 86400000;
    const x = new Date(t);
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
  }
  const totalMeses = (m - 1) + n;
  const anio = a + Math.floor(totalMeses / 12);
  const mes = ((totalMeses % 12) + 12) % 12;
  // Día 0 del mes SIGUIENTE = último día de `mes`.
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Reparte `totalCentavos` entre `n` pagos SIN perder ni inventar un centavo.
 *
 * El residuo (0..n−1 centavos) se suma de a uno a los PRIMEROS pagos, no al
 * último: así la cola del plan es el número parejo que se le dice al paciente
 * («…y los demás de $3,333.33») y el centavo de más lo paga quien todavía no ha
 * pagado nada. `POST /api/payment-plans` lo hace al revés (todo el residuo en la
 * última cuota, `route.ts:120-122`); no se copia a propósito y queda anotado.
 */
export function repartirCentavos(totalCentavos: number, n: number): number[] {
  const cuantos = Math.max(0, Math.floor(n));
  if (cuantos === 0) return [];
  const total = Math.max(0, Math.round(totalCentavos));
  const base = Math.floor(total / cuantos);
  const sobran = total - base * cuantos; // 0 .. cuantos-1
  return Array.from({ length: cuantos }, (_, i) => base + (i < sobran ? 1 : 0));
}

/**
 * El calendario completo: enganche (si lo hay) + N mensualidades.
 *
 * Con modo "unico" devuelve UN pago por el total — así la tabla de pagos existe
 * siempre y quien la pinta no tiene que llevar dos caminos.
 */
export function calcularCalendario(total: number, c: CondicionesPago): Calendario {
  const totalC = Math.max(0, aCentavos(total));

  if (c.modo !== "plazos") {
    const pagos: PagoProgramado[] = [
      { numero: 1, esEnganche: false, monto: aPesos(totalC), fecha: c.primerPago },
    ];
    return { pagos, suma: aPesos(totalC), total: aPesos(totalC), montoTipico: aPesos(totalC), parejo: true };
  }

  const engancheC = Math.min(totalC, Math.max(0, aCentavos(c.enganche)));
  const restoC = totalC - engancheC;
  const pagos: PagoProgramado[] = [];

  if (engancheC > 0) {
    pagos.push({ numero: 0, esEnganche: true, monto: aPesos(engancheC), fecha: c.primerPago });
  }

  // El enganche se lo come todo: no quedan mensualidades que repartir. Devolver
  // N cuotas de $0 sería enseñarle al paciente un calendario que no existe.
  //
  // Y por lo mismo nunca se piden más cuotas que centavos hay: «6 pagos» de un
  // resto de 3¢ imprimiría "Pago 1 $0.01, Pago 2 $0.01, Pago 3 $0.01" y tres
  // filas de "$0.00" en el PDF del paciente. Se reparte entre las que pueden
  // llevar algo; la suma sigue siendo exacta.
  const cuantas = Math.min(Math.max(1, c.numPagos), Math.max(1, restoC));
  const cuotas = restoC > 0 ? repartirCentavos(restoC, cuantas) : [];

  // Con enganche, la primera mensualidad cae UN periodo después de la fecha del
  // enganche; sin enganche, la primera mensualidad ES la fecha fijada.
  const desplazamiento = engancheC > 0 ? 1 : 0;
  cuotas.forEach((centavos, i) => {
    pagos.push({
      numero: i + 1,
      esEnganche: false,
      monto: aPesos(centavos),
      fecha: c.primerPago ? sumarPeriodos(c.primerPago, c.frecuencia, i + desplazamiento) : null,
    });
  });

  const sumaC = pagos.reduce((acc, p) => acc + aCentavos(p.monto), 0);
  const mensualidades = cuotas.length ? cuotas : [totalC];
  return {
    pagos,
    suma: aPesos(sumaC),
    total: aPesos(totalC),
    // El típico es el MENOR: es el que se repite (el residuo sube los primeros).
    montoTipico: aPesos(Math.min(...mensualidades)),
    parejo: Math.max(...mensualidades) === Math.min(...mensualidades),
  };
}

/* ── Las palabras ─────────────────────────────────────────────────────── */

/**
 * Lo único honesto que el panel puede decir sobre «meses sin intereses».
 *
 * Se imprime en el PDF y se enseña en el editor cuando la clínica marca que el
 * paciente difiere el cargo con su banco. No promete tasa, no promete plazo y
 * no dice «sin intereses»: eso lo decide el banco emisor, no la clínica.
 */
export const LEYENDA_DIFIERE =
  "El paciente puede diferir este cargo a meses con su banco desde la terminal. " +
  "El plazo y el costo los define su banco emisor; la clínica recibe el importe completo.";

const MES_CORTO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-10-01" → "1 de octubre de 2026". Sin `new Date(iso)`: no corre el día. */
export function fechaEnPalabras(fecha: string | null): string {
  if (!fecha) return "por definir";
  const [a, m, d] = fecha.split("-").map(Number);
  if (!a || !m || !d) return "por definir";
  return `${d} de ${MES_CORTO[m - 1] ?? ""} de ${a}`;
}

/**
 * "2026-10-16T00:00:00.000Z" → "16 oct 2026". SIEMPRE en UTC.
 *
 * `quotes.validUntil` es un DateTime, pero lo que significa es un DÍA: el
 * editor guarda la fecha elegida como medianoche UTC. Pintarla con
 * `toLocaleDateString` la corre un día hacia atrás en cualquier huso al oeste
 * de Greenwich — México entre ellos: una vigencia elegida para el 16 de
 * octubre se leía «15 oct» en la pantalla de la clínica. Es el mismo defecto
 * que ya tenía la lista de siempre; aquí se corta, detrás de la bandera.
 */
export function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mes = MES_CORTO[d.getUTCMonth()] ?? "";
  return `${d.getUTCDate()} ${mes.slice(0, 3)} ${d.getUTCFullYear()}`;
}

export function dinero(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isFinite(Number(n)) ? Number(n) : 0);
}

const CADA: Record<FrecuenciaPago, string> = {
  WEEKLY: "semanales",
  BIWEEKLY: "quincenales",
  MONTHLY: "mensuales",
};

/**
 * La frase que convence: «6 pagos mensuales de $5,000.00, el primero el 1 de
 * octubre de 2026». Es la MISMA en el editor, en el PDF y en la página del
 * paciente — se calcula una vez, aquí.
 */
export function frasePlan(total: number, c: CondicionesPago): string {
  const cal = calcularCalendario(total, c);
  if (c.modo !== "plazos") {
    return `Pago único de ${dinero(cal.total)}`;
  }
  const mensualidades = cal.pagos.filter((p) => !p.esEnganche);
  if (mensualidades.length === 0) {
    return `Pago único de ${dinero(cal.total)}`;
  }
  const primera = mensualidades[0];
  // Los centavos del residuo suben los PRIMEROS pagos (ver repartirCentavos):
  // se dice cuántos son, no solo el primero, para que la frase sume el total.
  const conResiduo = mensualidades.filter((p) => p.monto > cal.montoTipico).length;
  const importe = cal.parejo
    ? `de ${dinero(cal.montoTipico)}`
    : conResiduo === 1
      ? `de ${dinero(cal.montoTipico)} (el primero, de ${dinero(primera.monto)})`
      : `de ${dinero(cal.montoTipico)} (los primeros ${conResiduo}, de ${dinero(primera.monto)})`;
  const cuando = primera.fecha ? `, el primero el ${fechaEnPalabras(primera.fecha)}` : "";
  // Del CALENDARIO, no de `c.enganche`: un enganche de menos de medio centavo
  // se redondea a 0 y no genera fila, pero `c.enganche > 0` seguía siendo cierto
  // y la frase llamaba «enganche» a la primera mensualidad.
  const primeraFila = cal.pagos[0];
  const enganche = primeraFila?.esEnganche ? `Enganche de ${dinero(primeraFila.monto)} y ` : "";
  const n = mensualidades.length;
  return `${enganche}${n} ${n === 1 ? "pago" : "pagos"} ${CADA[c.frecuencia]} ${importe}${cuando}`;
}

/**
 * Las seis etiquetas en español, para las superficies que NO pasan por i18n:
 * el PDF del presupuesto y la página pública del paciente, que son
 * monolingües como todo el resto de esos documentos.
 *
 * Son las MISMAS palabras que `ETIQUETA_METODO` de `lib/sabina/dinero/comun.ts`
 * y que el selector de cobros. No se importan de allá porque ese módulo
 * arrastra Prisma y medio motor de Sabina, y este archivo tiene que seguir
 * siendo client-safe (lo importa el editor). Una prueba comprueba que las dos
 * listas siguen diciendo lo mismo.
 */
export const ETIQUETA_METODO_ES: Record<MetodoPago, string> = {
  cash: "Efectivo",
  debit: "Tarjeta débito",
  credit: "Tarjeta crédito",
  transfer: "Transferencia",
  check: "Cheque",
  other: "Otro",
};

/** Una cuota tal como se imprime: etiqueta, fecha en palabras e importe. */
export interface CuotaImpresa {
  etiqueta: string;
  fecha: string;
  monto: number;
}

/** El plan resuelto para el PDF y la página del paciente. */
export interface PlanParaDocumento {
  frase: string;
  metodo: string | null;
  cuotas: CuotaImpresa[];
  suma: number;
  leyendaDifiere: string | null;
}

/**
 * Resuelve el plan para imprimirlo. El documento NO calcula nada: recibe las
 * cuotas ya divididas por `calcularCalendario`, que es la misma función que
 * alimenta la pantalla en la que se negoció. Así el papel que firma el paciente
 * y lo que vio en el monitor no pueden decir números distintos.
 *
 * Devuelve `null` cuando no hay condiciones que contar: el documento sale
 * exactamente como salía antes de WS1-T8.
 */
export function planParaDocumento(
  total: number,
  c: CondicionesPago | null | undefined,
): PlanParaDocumento | null {
  if (!hayCondiciones(c)) return null;
  const cond = c as CondicionesPago;
  const cal = calcularCalendario(total, cond);
  return {
    frase: frasePlan(total, cond),
    metodo: cond.metodo ? ETIQUETA_METODO_ES[cond.metodo] : null,
    cuotas: cal.pagos.map((p) => ({
      etiqueta: p.esEnganche ? "Enganche" : `Pago ${p.numero}`,
      fecha: fechaEnPalabras(p.fecha),
      monto: p.monto,
    })),
    suma: cal.suma,
    leyendaDifiere: cond.difiereConSuBanco ? LEYENDA_DIFIERE : null,
  };
}

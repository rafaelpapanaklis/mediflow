// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · ISR POR LA VENTA (el que paga QUIEN VENDE).
//
// Módulo PURO y client-safe.
//
// POR QUÉ ESTA ES LA QUE GANA LA EXCLUSIVA: en la primera cita, el asesor
// que le dice al dueño «según esto sales exento» —o «prepárate, aquí hay
// impuesto»— deja de ser uno más de los tres que fueron a tocar la puerta.
// Ningún CRM del mercado se lo dice.
//
// ── LA LEY QUE SE ESTÁ APLICANDO ─────────────────────────────────────────
// Artículo 93, fracción XIX de la LISR — la exención de casa habitación:
//   · exenta hasta 700,000 UDIS de PRECIO DE VENTA (no de ganancia),
//   · siempre que no se haya usado la exención en los 3 años anteriores,
//   · si el precio pasa el tope, «por el excedente se determinará la
//     ganancia»: no se pierde la exención entera, se grava la proporción.
//
// Artículo 121 — cómo se actualiza el costo:
//   · el costo se parte en TERRENO y CONSTRUCCIÓN (20/80 cuando no se
//     pueden separar, que es casi siempre),
//   · la construcción se deprecia 3% por año y nunca baja del 20% de su
//     costo,
//   · todo se actualiza por INPC.
//
// Artículo 120 — cómo se calcula el impuesto:
//   · la ganancia se divide entre los años transcurridos (máximo 20),
//   · a esa parte se le aplica la tarifa anual del 152,
//   · el impuesto de esa parte se multiplica por los mismos años.
//
// Nota sobre el paso final: dividir entre los años, aplicar la tarifa y
// volver a multiplicar por los años da EXACTAMENTE lo mismo que sacar la
// tasa efectiva y aplicarla a la ganancia entera. Las dos lecturas del 120
// coinciden, así que no hay que elegir entre ellas.
//
// ── LO QUE ESTE CÁLCULO NO HACE ──────────────────────────────────────────
// No conoce los DEMÁS ingresos del año del vendedor, que por ley se suman a
// la parte acumulable y pueden subir la tasa. Es un estimado del impuesto
// de ESTA operación, que es la pregunta que se hace en la cita. El número
// definitivo lo saca el notario al calcular la retención.
// ═══════════════════════════════════════════════════════════════════════
import { type IsrParams, type TarifaTramo, leyendaEstimado } from "./catalog";
import { type Cents, clampCents, fromCents, pctOfCents, sumCents, toCents } from "./money";

export interface IsrInput {
  precioVentaCents: Cents;
  precioAdquisicionCents: Cents;
  anioAdquisicion: number;
  /** Año en que se vende. Por omisión, el año en curso. */
  anioVenta?: number;
  esCasaHabitacion: boolean;
  /** ¿Ya usó la exención de casa habitación en los 3 años anteriores? */
  usoExencionReciente: boolean;
  /** Mejoras COMPROBABLES con factura. Sin factura no se deducen. */
  mejorasCents?: Cents | null;
  anioMejoras?: number | null;
  /** Lo que pagó de escrituración cuando COMPRÓ (ISAI, notario, avalúo). */
  gastosAdquisicionCents?: Cents | null;
  /** Gastos de ESTA venta: comisión del asesor, avalúo, notario. */
  gastosVentaCents?: Cents | null;
}

export interface IsrRenglon {
  clave: string;
  etiqueta: string;
  explicacion: string;
  montoCents: Cents;
  /** true si RESTA de la base (deducción). */
  esDeduccion: boolean;
}

export interface IsrResult {
  ok: boolean;
  error?: string;
  /** Faltó un dato de la tabla de parámetros para poder calcular. */
  faltaInpcDe?: number;

  exento?: boolean;
  exentoParcial?: boolean;
  /** Tope de la exención en pesos-centavos, ya convertido desde UDIS. */
  limiteExentoCents?: Cents;
  /** Qué proporción del precio quedó gravada (0 = exento, 1 = todo grava). */
  proporcionGravada?: number;
  motivoNoExento?: string;

  factorActualizacion?: number;
  inpcAnioBase?: number;
  inpcAnioFinal?: number;
  costoActualizadoCents?: Cents;
  deduccionesCents?: Cents;
  renglones?: IsrRenglon[];

  gananciaTotalCents?: Cents;
  gananciaGravadaCents?: Cents;
  aniosTranscurridos?: number;
  aniosParaDividir?: number;
  gananciaAcumulableCents?: Cents;

  isrCents?: Cents;
  tasaEfectivaPct?: number;
  cedularCents?: Cents;
  cedularPct?: number;
  totalImpuestosCents?: Cents;
  /** Lo que le queda al vendedor: precio − gastos de venta − impuestos. */
  netoVendedorCents?: Cents;

  year?: number;
  avisos?: string[];
  leyenda?: string;
}

/**
 * El impuesto que sale de la tarifa anual del artículo 152, para una base
 * en PESOS. Devuelve centavos.
 *
 * Se elige el ÚLTIMO tramo cuyo límite inferior no rebasa la base. Los
 * tramos son contiguos, así que basta con el límite inferior; el superior
 * queda en la tabla para poder auditarla a simple vista.
 */
export function isrSegunTarifa(basePesos: number, tarifa: TarifaTramo[]): Cents {
  if (!Number.isFinite(basePesos) || basePesos <= 0 || tarifa.length === 0) return 0;
  let tramo = tarifa[0];
  for (const t of tarifa) {
    if (basePesos >= t.li) tramo = t;
    else break;
  }
  const excedente = Math.max(0, basePesos - tramo.li);
  return toCents(tramo.cuota + (excedente * tramo.pct) / 100);
}

/**
 * Deprecia una inversión en construcción y le aplica el piso legal: por
 * mucho que pasen los años, nunca vale menos del 20% de lo que costó.
 */
function depreciar(montoCents: Cents, anios: number, pctAnual: number, pisoPct: number): Cents {
  if (montoCents <= 0) return 0;
  const depreciacion = pctOfCents(montoCents, Math.max(0, anios) * pctAnual);
  const piso = pctOfCents(montoCents, pisoPct);
  return Math.max(montoCents - depreciacion, piso);
}

export function calcularIsrVenta(input: IsrInput, params: IsrParams): IsrResult {
  const avisos: string[] = [];

  const precioVenta = clampCents(input.precioVentaCents);
  if (precioVenta <= 0) {
    return { ok: false, error: "Escribe el precio de venta para poder calcular." };
  }
  const costoAdq = clampCents(input.precioAdquisicionCents);
  if (costoAdq <= 0) {
    return {
      ok: false,
      error:
        "Escribe en cuánto se compró el inmueble. Sin el costo de adquisición no hay ganancia que calcular, y es el dato que más baja el impuesto.",
    };
  }

  const anioVenta = Number(input.anioVenta) || new Date().getFullYear();
  const anioAdq = Number(input.anioAdquisicion);
  if (!Number.isFinite(anioAdq) || anioAdq < 1900 || anioAdq > anioVenta) {
    return {
      ok: false,
      error: "Revisa el año de compra: tiene que ser un año real y anterior a la venta.",
    };
  }

  // ── Factor de actualización por INPC ────────────────────────────────
  // La BASE es el índice de diciembre del año ANTERIOR a la compra, no el del
  // año de la compra. Con índices anuales es lo que hace que el número de años
  // indexados coincida con el de años depreciados: de dic(compra−1) a
  // dic(venta−1) hay exactamente (venta − compra) años.
  //
  // Tomando dic(compra) se perdía sistemáticamente un año de inflación —menos
  // costo deducible, más impuesto del que se va a pagar— y una casa comprada y
  // vendida con un año de diferencia salía con factor 1.0000 clavado, que
  // parece un error aunque no lo fuera.
  let anioBase = anioAdq - 1;
  if (!params.inpcPorAnio[anioBase]) {
    if (!params.inpcPorAnio[anioAdq]) {
      return {
        ok: false,
        error: `No tengo el INPC de ${anioAdq}, y sin él no puedo actualizar el costo de compra.`,
        faltaInpcDe: anioAdq,
      };
    }
    anioBase = anioAdq;
    avisos.push(
      `No tengo el INPC de ${anioAdq - 1}, así que tomé el de ${anioAdq} como base. El costo actualizado queda algo por debajo del real, y el impuesto algo por encima.`,
    );
  }
  const inpcAdq = params.inpcPorAnio[anioBase];

  // Por ley el factor usa el INPC del mes anterior a la venta. Aquí se
  // trabaja con el índice de diciembre del año previo, que es el que se
  // captura; si ese año todavía no está en la tabla, se usa el más reciente
  // que sí esté y se DICE en pantalla. Inventar un índice sería peor.
  const anioObjetivo = anioVenta - 1;
  let anioFinal = anioObjetivo;
  if (!params.inpcPorAnio[anioFinal]) {
    const disponibles = Object.keys(params.inpcPorAnio)
      .map(Number)
      .filter((y) => y <= anioVenta && y >= anioBase)
      .sort((a, b) => b - a);
    if (disponibles.length === 0) {
      return {
        ok: false,
        error: `No tengo ningún INPC entre ${anioBase} y ${anioVenta} para actualizar el costo.`,
        faltaInpcDe: anioObjetivo,
      };
    }
    anioFinal = disponibles[0];
    avisos.push(
      `Actualicé el costo con el INPC de diciembre de ${anioFinal}, que es el más reciente que tengo cargado. Cuando se capture el de ${anioObjetivo} el número se afina.`,
    );
  }
  const inpcFinal = params.inpcPorAnio[anioFinal];

  // Piso de 1: una deflación multianual no puede REDUCIR el costo histórico.
  const factor = Math.max(1, inpcFinal / inpcAdq);

  // ── Costo de adquisición actualizado (art. 121) ─────────────────────
  const anios = Math.max(0, anioVenta - anioAdq);
  const terreno = pctOfCents(costoAdq, params.proporcionTerrenoPct);
  const construccion = costoAdq - terreno;
  const construccionDep = depreciar(
    construccion,
    anios,
    params.depreciacionAnualPct,
    params.pisoConstruccionPct,
  );
  const costoActualizado = Math.round((terreno + construccionDep) * factor);

  // ── Mejoras comprobables ────────────────────────────────────────────
  const mejoras = clampCents(input.mejorasCents ?? 0);
  let mejorasActualizadas = 0;
  if (mejoras > 0) {
    const anioMej = Number(input.anioMejoras) || anioAdq;
    const inpcMej = params.inpcPorAnio[anioMej] ?? inpcAdq;
    const factorMej = Math.max(1, inpcFinal / inpcMej);
    const aniosMej = Math.max(0, anioVenta - anioMej);
    // Una mejora es inversión en construcción: se deprecia igual.
    const mejorasDep = depreciar(
      mejoras,
      aniosMej,
      params.depreciacionAnualPct,
      params.pisoConstruccionPct,
    );
    mejorasActualizadas = Math.round(mejorasDep * factorMej);
    if (!params.inpcPorAnio[anioMej]) {
      avisos.push(
        `No tengo el INPC de ${anioMej}, así que actualicé las mejoras con el mismo factor del costo de compra.`,
      );
    }
  }

  // ── Gastos deducibles ───────────────────────────────────────────────
  const gastosAdq = clampCents(input.gastosAdquisicionCents ?? 0);
  const gastosAdqActualizados = Math.round(gastosAdq * factor);
  const gastosVenta = clampCents(input.gastosVentaCents ?? 0);

  const deducciones = sumCents(
    costoActualizado,
    mejorasActualizadas,
    gastosAdqActualizados,
    gastosVenta,
  );

  const renglones: IsrRenglon[] = [
    {
      clave: "precioVenta",
      etiqueta: "Precio de venta",
      explicacion: "Lo que se recibe por el inmueble.",
      montoCents: precioVenta,
      esDeduccion: false,
    },
    {
      clave: "costo",
      etiqueta: `Costo de compra actualizado (factor ${factor.toFixed(4)})`,
      explicacion: `Se compró en ${fromCents(costoAdq).toLocaleString("es-MX")} en ${anioAdq}. El terreno se actualiza completo; la construcción se deprecia ${params.depreciacionAnualPct}% por año y luego se actualiza.`,
      montoCents: costoActualizado,
      esDeduccion: true,
    },
  ];
  if (mejorasActualizadas > 0) {
    renglones.push({
      clave: "mejoras",
      etiqueta: "Mejoras comprobables actualizadas",
      explicacion: "Solo cuentan las que tienen factura a nombre del vendedor.",
      montoCents: mejorasActualizadas,
      esDeduccion: true,
    });
  }
  if (gastosAdqActualizados > 0) {
    renglones.push({
      clave: "gastosAdq",
      etiqueta: "Gastos de cuando compró, actualizados",
      explicacion: "ISAI, notario y avalúo que pagó al adquirir el inmueble.",
      montoCents: gastosAdqActualizados,
      esDeduccion: true,
    });
  }
  if (gastosVenta > 0) {
    renglones.push({
      clave: "gastosVenta",
      etiqueta: "Gastos de esta venta",
      explicacion:
        "La comisión del asesor y los gastos del cierre SÍ se deducen. Es una de las razones por las que vender con asesor sale más barato de lo que parece.",
      montoCents: gastosVenta,
      esDeduccion: true,
    });
  }

  const gananciaTotal = clampCents(precioVenta - deducciones);

  // ── La exención del artículo 93 ─────────────────────────────────────
  const limiteExento = toCents(params.exencionUdis * params.udi);
  let proporcionGravada = 1;
  let exento = false;
  let exentoParcial = false;
  let motivoNoExento: string | undefined;

  if (!input.esCasaHabitacion) {
    motivoNoExento =
      "La exención es solo para CASA HABITACIÓN. Un terreno, un local o una casa que nunca se habitó pagan sobre toda la ganancia.";
  } else if (input.usoExencionReciente) {
    motivoNoExento = `Ya se usó la exención en los últimos ${params.aniosExencionPrevia} años. La ley solo la da una vez cada ${params.aniosExencionPrevia} años, así que esta venta grava completa.`;
  } else if (precioVenta <= limiteExento) {
    exento = true;
    proporcionGravada = 0;
  } else {
    exentoParcial = true;
    proporcionGravada = (precioVenta - limiteExento) / precioVenta;
  }

  const gananciaGravada = exento ? 0 : Math.round(gananciaTotal * proporcionGravada);

  // ── El impuesto (art. 120 + tarifa del 152) ─────────────────────────
  // Math.max EXTERIOR: si alguien captura topeAnios = 0 en el admin, el
  // Math.min daba 0 y la división siguiente devolvía Infinity, que viajaba
  // tal cual al desglose de la pantalla.
  const aniosParaDividir = Math.max(1, Math.min(Math.max(anios, 1), params.topeAnios));
  const gananciaAcumulable = Math.round(gananciaGravada / aniosParaDividir);
  const isrDeLaParte = isrSegunTarifa(fromCents(gananciaAcumulable), params.tarifaAnual);
  const isr = isrDeLaParte * aniosParaDividir;
  const tasaEfectiva = gananciaGravada > 0 ? (isr / gananciaGravada) * 100 : 0;

  const cedular = params.cedularPct > 0 ? pctOfCents(gananciaGravada, params.cedularPct) : 0;
  if (cedular > 0) {
    avisos.push(
      `${params.stateName} cobra ${params.cedularPct}% de impuesto cedular sobre la ganancia. Va ADEMÁS del ISR federal y no se acredita contra él.`,
    );
  }

  const totalImpuestos = sumCents(isr, cedular);

  if (anios > params.topeAnios) {
    avisos.push(
      `Pasaron ${anios} años desde la compra, pero la ley topa la división en ${params.topeAnios}. Por eso el impuesto no baja más aunque el inmueble sea más viejo.`,
    );
  }

  return {
    ok: true,
    exento,
    exentoParcial,
    limiteExentoCents: limiteExento,
    proporcionGravada,
    motivoNoExento,
    factorActualizacion: factor,
    inpcAnioBase: anioBase,
    inpcAnioFinal: anioFinal,
    costoActualizadoCents: costoActualizado,
    deduccionesCents: deducciones,
    renglones,
    gananciaTotalCents: gananciaTotal,
    gananciaGravadaCents: gananciaGravada,
    aniosTranscurridos: anios,
    aniosParaDividir,
    gananciaAcumulableCents: gananciaAcumulable,
    isrCents: isr,
    tasaEfectivaPct: tasaEfectiva,
    cedularCents: cedular,
    cedularPct: params.cedularPct,
    totalImpuestosCents: totalImpuestos,
    netoVendedorCents: clampCents(precioVenta - gastosVenta - totalImpuestos),
    year: params.year,
    avisos,
    leyenda: leyendaEstimado(params.year, "contador"),
  };
}

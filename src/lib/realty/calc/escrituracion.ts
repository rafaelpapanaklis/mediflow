// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · GASTOS DE ESCRITURACIÓN.
//
// Módulo PURO y client-safe: el navegador lo usa para recalcular en vivo y
// el servidor lo vuelve a ejecutar sobre los mismos parámetros. Una sola
// aritmética, dos ejecuciones.
//
// EL PROBLEMA QUE RESUELVE: escriturar cuesta una barbaridad —del orden del
// 4% al 10% del valor, según el estado y el precio— y casi nadie se lo dice
// al comprador hasta que está sentado en la notaría. Ahí es donde se caen las
// operaciones. Enseñar el número el primer día no es un adorno: es lo que
// evita perder el cierre en la última junta.
//
// ⚠️ Ese "5 a 10%" que se repite en el mercado NO es un invariante y este
// módulo no lo promete: con las tasas sembradas, un estado de ISAI 2% en una
// casa de 10 millones sale en 3.9%, y CDMX en una de 500 mil pasa del 11%.
// El porcentaje sale del cálculo; no se fuerza para que quepa en la frase.
//
// LA BASE GRAVABLE NO ES EL PRECIO. El ISAI se calcula sobre el MAYOR de
// tres valores: el precio de la escritura, el valor catastral y el avalúo.
// Un comprador que solo mira el precio se lleva la sorpresa cuando el
// catastral resulta más alto.
//
// EL RESULTADO ES UN RANGO, no un número. Los honorarios notariales, los
// derechos del registro y el avalúo se mueven por notaría y por municipio.
// Dar un solo número sería más cómodo y sería mentira; el rango es la
// verdad y además es lo que el asesor puede defender frente al cliente.
// ═══════════════════════════════════════════════════════════════════════
import { type EscrituracionParams, leyendaEstimado } from "./catalog";
import {
  type Cents,
  clampCents,
  pctOf,
  pctOfCents,
  sumCents,
  toCents,
} from "./money";

export interface EscrituracionInput {
  /** Precio de la operación, en centavos. */
  precioCents: Cents;
  /** Valor catastral, si se conoce. Entra en la base gravable. */
  valorCatastralCents?: Cents | null;
  /** Avalúo, si ya se hizo. Entra en la base gravable. */
  avaluoCents?: Cents | null;
}

export interface ConceptoEscrituracion {
  clave: string;
  etiqueta: string;
  /** Por qué se paga esto, en una línea, para que el asesor lo explique. */
  explicacion: string;
  minCents: Cents;
  maxCents: Cents;
}

export interface EscrituracionResult {
  ok: boolean;
  error?: string;
  /** Sobre qué valor se calculó el ISAI y de dónde salió. */
  baseGravableCents?: Cents;
  baseOrigen?: "precio" | "catastral" | "avaluo";
  baseAdvertencia?: string;
  conceptos?: ConceptoEscrituracion[];
  totalMinCents?: Cents;
  totalMaxCents?: Cents;
  /** El total como porcentaje del precio: es el "5 a 10%" del que se habla. */
  totalPctMin?: number;
  totalPctMax?: number;
  /** Precio + gastos: "esta casa te sale realmente en…". */
  costoRealMinCents?: Cents;
  costoRealMaxCents?: Cents;
  year?: number;
  stateName?: string;
  leyenda?: string;
}

export function calcularEscrituracion(
  input: EscrituracionInput,
  params: EscrituracionParams,
): EscrituracionResult {
  const precio = clampCents(input.precioCents);
  if (precio <= 0) {
    return { ok: false, error: "Escribe el valor de la operación para poder calcular." };
  }

  const catastral = clampCents(input.valorCatastralCents ?? 0);
  const avaluo = clampCents(input.avaluoCents ?? 0);

  // ── La base gravable: el MAYOR de los tres ─────────────────────────
  let base = precio;
  let origen: "precio" | "catastral" | "avaluo" = "precio";
  if (catastral > base) {
    base = catastral;
    origen = "catastral";
  }
  if (avaluo > base) {
    base = avaluo;
    origen = "avaluo";
  }

  let baseAdvertencia: string | undefined;
  if (origen !== "precio") {
    const cual = origen === "catastral" ? "el valor catastral" : "el avalúo";
    baseAdvertencia = `El ISAI no se calculó sobre el precio: ${cual} es más alto y la ley manda usar el mayor de los tres valores.`;
  }

  const isai = pctOfCents(base, params.isaiPct);

  const notarioMin = pctOfCents(base, params.notarioPctMin);
  const notarioMax = pctOfCents(base, params.notarioPctMax);

  const registroMin = pctOfCents(base, params.registroPctMin);
  const registroMax = pctOfCents(base, params.registroPctMax);

  // El avalúo tiene piso: en una casa barata el porcentaje no llega ni a
  // cubrir la visita del perito, así que se cobra la tarifa mínima.
  const avaluoMin = Math.max(pctOfCents(base, params.avaluoPctMin), toCents(params.avaluoPisoMin));
  const avaluoMax = Math.max(pctOfCents(base, params.avaluoPctMax), toCents(params.avaluoPisoMax));

  const certificadosMin = toCents(params.certificadosMin);
  const certificadosMax = toCents(params.certificadosMax);

  // El IVA grava SERVICIOS: honorarios del notario y del perito valuador.
  // El ISAI es un impuesto y los derechos del registro son derechos; ni uno
  // ni otros lo causan. Meterlos en la base del IVA infla el estimado.
  const ivaMin = pctOfCents(sumCents(notarioMin, avaluoMin), params.ivaHonorariosPct);
  const ivaMax = pctOfCents(sumCents(notarioMax, avaluoMax), params.ivaHonorariosPct);

  const conceptos: ConceptoEscrituracion[] = [
    {
      clave: "isai",
      etiqueta: `ISAI (${params.isaiPct}% en ${params.stateName})`,
      explicacion:
        "Impuesto sobre adquisición de inmuebles. Lo cobra el estado o el municipio y es el concepto más grande de todos.",
      minCents: isai,
      maxCents: isai,
    },
    {
      clave: "notario",
      etiqueta: "Honorarios del notario",
      explicacion: "Lo que cobra la notaría por redactar y protocolizar la escritura.",
      minCents: notarioMin,
      maxCents: notarioMax,
    },
    {
      clave: "registro",
      etiqueta: "Registro Público de la Propiedad",
      explicacion: "Derechos por inscribir la escritura para que la casa quede a tu nombre.",
      minCents: registroMin,
      maxCents: registroMax,
    },
    {
      clave: "avaluo",
      etiqueta: "Avalúo",
      explicacion: "Perito valuador autorizado. Tiene tarifa mínima, por eso no baja de cierto monto.",
      minCents: avaluoMin,
      maxCents: avaluoMax,
    },
    {
      clave: "certificados",
      etiqueta: "Certificados y constancias",
      explicacion:
        "Libertad de gravamen, no adeudo de predial y de agua, y la constancia de zonificación donde la piden.",
      minCents: certificadosMin,
      maxCents: certificadosMax,
    },
    {
      clave: "iva",
      etiqueta: `IVA (${params.ivaHonorariosPct}% sobre honorarios)`,
      explicacion: "Solo sobre los servicios: notario y avalúo. El ISAI y los derechos no causan IVA.",
      minCents: ivaMin,
      maxCents: ivaMax,
    },
  ];

  const totalMin = sumCents(...conceptos.map((c) => c.minCents));
  const totalMax = sumCents(...conceptos.map((c) => c.maxCents));

  return {
    ok: true,
    baseGravableCents: base,
    baseOrigen: origen,
    baseAdvertencia,
    conceptos,
    totalMinCents: totalMin,
    totalMaxCents: totalMax,
    // El porcentaje se mide contra el PRECIO, no contra la base: es lo que
    // el comprador compara ("me dijeron que era el 8% de lo que pagué").
    totalPctMin: pctOf(totalMin, precio),
    totalPctMax: pctOf(totalMax, precio),
    costoRealMinCents: sumCents(precio, totalMin),
    costoRealMaxCents: sumCents(precio, totalMax),
    year: params.year,
    stateName: params.stateName,
    leyenda: leyendaEstimado(params.year, "notario"),
  };
}

// Aquí vivía resumenParaFicha(), que devolvía un monto SIN leyenda para
// pintarlo en una tarjeta. No lo llamaba nadie —TiraEscrituracion usa
// calcularEscrituracion directo— y era una mina: el primero que lo conectara
// pintaría dinero sin el aviso de que es un estimado. Se borró a propósito.

// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PRECALIFICADOR DE CRÉDITO.
//
// Módulo PURO y client-safe. Es la calculadora que más vende de las tres:
// el asesor mexicano quema semanas enseñando casas a gente que no califica,
// y aquí lo sabe en el primer minuto.
//
// ── CÓMO SE ESTIMA EL CRÉDITO ────────────────────────────────────────────
// Por CAPACIDAD DE PAGO, que es como lo deciden de verdad las tres fuentes:
//
//   pago mensual disponible = sueldo × factor del producto − deudas
//   crédito                 = valor presente de ese pago al plazo y la tasa
//   crédito                 = mínimo(lo anterior, tope del producto)
//
// El valor presente de una anualidad es la fórmula de amortización de
// siempre; no hay nada propietario aquí y por eso el número se puede
// defender frente al cliente y frente al banco.
//
// El PLAZO no es el del folleto: se recorta por edad. Si a alguien le faltan
// 18 años para el límite, su crédito se calcula a 18 años y sale más chico.
// Es la causa número uno de que un precalificador optimista mienta.
//
// El resultado es un RANGO porque la tasa lo es. Infonavit va de 3.76% a
// 10.45% según el sueldo, y un banco cambia de tasa por perfil. Dar un solo
// número sería fingir una precisión que nadie tiene.
//
// ── LO QUE NO ES ─────────────────────────────────────────────────────────
// No es una precalificación oficial ni una preautorización. Es la
// conversación honesta de la primera cita: si alcanza, más o menos para
// cuánto, y qué hay que arreglar si no alcanza.
// ═══════════════════════════════════════════════════════════════════════
import { type CreditoParams, type ProductoCreditoParams, leyendaEstimado } from "./catalog";
import {
  type Cents,
  clampCents,
  monthlyPayment,
  presentValueOfAnnuity,
  sumCents,
} from "./money";

/** Espeja RealtyCreditKind del contrato, menos NINGUNO. */
export type TipoCredito = "INFONAVIT" | "FOVISSSTE" | "BANCARIO" | "CONTADO";

/** Banda en la que se acepta una tasa capturada a mano, en % anual. */
export const TASA_PROPIA_MIN = 0.5;
export const TASA_PROPIA_MAX = 60;

export const TIPOS_CREDITO: { id: TipoCredito; label: string; ayuda: string }[] = [
  {
    id: "INFONAVIT",
    label: "Infonavit",
    ayuda: "Trabajas en una empresa privada y te descuentan por nómina.",
  },
  {
    id: "FOVISSSTE",
    label: "Fovissste",
    ayuda: "Trabajas para el gobierno (maestro, IMSS, dependencia federal o estatal).",
  },
  {
    id: "BANCARIO",
    label: "Crédito bancario",
    ayuda: "Eres independiente, o quieres una casa por arriba del tope del instituto.",
  },
  { id: "CONTADO", label: "De contado", ayuda: "Ya tienes el dinero completo." },
];

export interface PrecalificacionInput {
  tipo: TipoCredito;
  /** Sueldo mensual BRUTO, en centavos. */
  salarioMensualCents: Cents;
  /** Ahorro para el enganche, en centavos. */
  ahorroCents: Cents;
  /** Lo que ya paga al mes de otros créditos (coche, tarjetas, nómina). */
  deudasMensualesCents?: Cents | null;
  edad: number;
  /** Puntos de Infonavit, si los sabe. */
  puntosInfonavit?: number | null;
  /** ¿Va a juntar su crédito con alguien más? (Unamos Créditos, cónyuge) */
  unirCredito?: boolean;
  /** Sueldo mensual bruto de la otra persona. */
  salarioSocioCents?: Cents | null;
  /** Si ya trae una cotización de banco, su tasa manda sobre la de la tabla. */
  tasaAnualPropia?: number | null;
}

export interface PrecalificacionResult {
  ok: boolean;
  error?: string;

  califica?: boolean;
  motivoNoCalifica?: string;
  puntosFaltantes?: number;

  tipo?: TipoCredito;
  tipoLabel?: string;
  plazoMeses?: number;
  plazoRecortadoPorEdad?: boolean;
  tasaMinPct?: number;
  tasaMaxPct?: number;

  pagoDisponibleCents?: Cents;
  creditoMinCents?: Cents;
  creditoMaxCents?: Cents;
  mensualidadMinCents?: Cents;
  mensualidadMaxCents?: Cents;
  topeProductoCents?: Cents;
  topeAlcanzado?: boolean;

  /** Lo que puede pagar por una casa: crédito + ahorro (con aforo si aplica). */
  presupuestoMinCents?: Cents;
  presupuestoMaxCents?: Cents;

  /** Qué hacer para mejorar el resultado. Es lo que el asesor dice en voz alta. */
  pasos?: string[];
  avisos?: string[];
  year?: number;
  leyenda?: string;
}

function productoDe(tipo: TipoCredito, params: CreditoParams): ProductoCreditoParams | null {
  if (tipo === "INFONAVIT") return params.infonavit;
  if (tipo === "FOVISSSTE") return params.fovissste;
  if (tipo === "BANCARIO") return params.bancario;
  return null;
}

function labelDe(tipo: TipoCredito): string {
  return TIPOS_CREDITO.find((t) => t.id === tipo)?.label ?? tipo;
}

export function precalificar(
  input: PrecalificacionInput,
  params: CreditoParams,
): PrecalificacionResult {
  const avisos: string[] = [];
  const pasos: string[] = [];
  const edad = Number(input.edad);
  const ahorro = clampCents(input.ahorroCents);

  // ── De contado: no hay crédito que estimar ──────────────────────────
  // VA ANTES de validar la edad a propósito: quien paga de contado no tiene
  // plazo que recortar, así que pedirle la edad era exigir un dato que la
  // pantalla ni siquiera enseña — y dejaba el formulario público mudo.
  if (input.tipo === "CONTADO") {
    if (ahorro <= 0) {
      return { ok: false, error: "Escribe cuánto tienes disponible." };
    }
    pasos.push(
      "Aparta una parte para la escrituración: se paga en efectivo el día de la firma y no entra en ningún crédito.",
    );
    return {
      ok: true,
      califica: true,
      tipo: "CONTADO",
      tipoLabel: labelDe("CONTADO"),
      creditoMinCents: 0,
      creditoMaxCents: 0,
      presupuestoMinCents: ahorro,
      presupuestoMaxCents: ahorro,
      pasos,
      avisos,
      year: params.year,
      leyenda: leyendaEstimado(params.year, "notario"),
    };
  }

  if (!Number.isFinite(edad) || edad < 18 || edad > 99) {
    return { ok: false, error: "Escribe una edad entre 18 y 99 años." };
  }

  const producto = productoDe(input.tipo, params);
  if (!producto) {
    return { ok: false, error: "Elige un tipo de crédito." };
  }

  const salario = clampCents(input.salarioMensualCents);
  if (salario <= 0) {
    return { ok: false, error: "Escribe tu sueldo mensual para poder estimar el crédito." };
  }

  // ── Puntos de Infonavit: es una PUERTA, no un multiplicador ─────────
  if (input.tipo === "INFONAVIT") {
    // Se distingue "no lo dijo" (null/undefined) de "escribió un número".
    // Un 0 o un negativo los ESCRIBIÓ alguien: son un dato capturado por
    // debajo del mínimo y tienen que cerrar la puerta, no abrirla.
    // Ojo con Number(null), que da 0 y es finito: por eso el guardia va antes.
    const crudo = input.puntosInfonavit;
    const puntos = crudo === null || crudo === undefined || crudo === ("" as unknown) ? NaN : Number(crudo);
    if (Number.isFinite(puntos)) {
      if (puntos < params.infonavit.puntosMinimos) {
        return {
          ok: true,
          califica: false,
          tipo: input.tipo,
          tipoLabel: labelDe(input.tipo),
          puntosFaltantes: Math.ceil(params.infonavit.puntosMinimos - Math.max(0, puntos)),
          motivoNoCalifica: `Con ${puntos} puntos todavía no alcanza: Infonavit pide ${params.infonavit.puntosMinimos}.`,
          pasos: [
            `Te faltan ${Math.ceil(params.infonavit.puntosMinimos - Math.max(0, puntos))} puntos. Suben solos con cada bimestre cotizado sin interrupciones.`,
            "Los puntos suben más rápido si el patrón te sube el salario base de cotización y si no cambias de trabajo en el proceso.",
            "Revísalos en Mi Cuenta Infonavit; ahí viene cuántos llevas y cuántos te faltan.",
          ],
          avisos,
          year: params.year,
          leyenda: leyendaEstimado(params.year, "asesor de crédito"),
        };
      }
    } else {
      avisos.push(
        `No me dijiste tus puntos de Infonavit. Se necesitan al menos ${params.infonavit.puntosMinimos} y se consultan en Mi Cuenta Infonavit; sin ellos no hay crédito por mucho que alcance el sueldo.`,
      );
    }
  }

  // ── Plazo: el del producto, recortado por edad ──────────────────────
  const mesesPorEdad = Math.floor((producto.edadMaximaFinal - edad) * 12);
  if (mesesPorEdad <= 0) {
    return {
      ok: true,
      califica: false,
      tipo: input.tipo,
      tipoLabel: labelDe(input.tipo),
      motivoNoCalifica: `A los ${edad} años ya se rebasó la edad límite para terminar de pagar (${producto.edadMaximaFinal}).`,
      pasos: [
        "Un cocréditante más joven —hijo, cónyuge— puede abrir el crédito. Pregúntale a tu asesor por el crédito conyugal o familiar.",
      ],
      avisos,
      year: params.year,
      leyenda: leyendaEstimado(params.year, "asesor de crédito"),
    };
  }
  const plazoMeses = Math.min(producto.plazoMaximoMeses, mesesPorEdad);
  const plazoRecortado = mesesPorEdad < producto.plazoMaximoMeses;
  if (plazoRecortado) {
    avisos.push(
      `El plazo se recortó a ${Math.floor(plazoMeses / 12)} años porque el crédito tiene que quedar liquidado antes de los ${producto.edadMaximaFinal}.`,
    );
  }

  // ── Capacidad de pago ───────────────────────────────────────────────
  let ingresoBase = salario;
  const unir = input.unirCredito === true;
  const salarioSocio = clampCents(input.salarioSocioCents ?? 0);
  if (unir && salarioSocio > 0) ingresoBase = sumCents(salario, salarioSocio);

  const deudas = clampCents(input.deudasMensualesCents ?? 0);
  const capacidad = Math.round(ingresoBase * producto.factorCapacidadPago);
  const pagoDisponible = capacidad - deudas;

  if (pagoDisponible <= 0) {
    return {
      ok: true,
      califica: false,
      tipo: input.tipo,
      tipoLabel: labelDe(input.tipo),
      motivoNoCalifica:
        "Las deudas que ya pagas se comen todo lo que se puede destinar a la hipoteca. Con este panorama ningún crédito sale.",
      pasos: [
        "Liquida o refinancia el crédito que más mensualidad te consume (normalmente el del coche o una tarjeta).",
        "Vuelve a intentarlo cuando la mensualidad de tus deudas baje: cada peso que dejas de pagar al mes se convierte en varios miles de crédito.",
      ],
      avisos,
      year: params.year,
      leyenda: leyendaEstimado(params.year, "asesor de crédito"),
    };
  }

  // ── Tope del producto ───────────────────────────────────────────────
  let tope = producto.montoMaximo;
  if (input.tipo === "INFONAVIT" && unir) {
    tope = params.infonavit.unamosMontoMaximo;
    if (salarioSocio <= 0) {
      avisos.push(
        "Marcaste que van a juntar créditos pero no me diste el sueldo de la otra persona: por ahora solo subí el tope. Captúralo y el estimado sube de verdad.",
      );
    }
  }
  const topeCents = Math.round(tope * 100);

  // ── Tasas ───────────────────────────────────────────────────────────
  let tasaMin = producto.tasaAnualMin;
  let tasaMax = producto.tasaAnualMax;
  // Acotada a propósito: esta tasa la escribe el usuario y llega hasta el PDF,
  // que es un documento con el membrete de la inmobiliaria. Sin cota, un 0.01%
  // dibujaría un crédito absurdo con pinta de oficial.
  const propia = Number(input.tasaAnualPropia);
  if (Number.isFinite(propia) && propia >= TASA_PROPIA_MIN && propia <= TASA_PROPIA_MAX) {
    tasaMin = propia;
    tasaMax = propia;
    avisos.push(`Usé la tasa de ${propia}% que capturaste, no el rango de la tabla.`);
  }

  // Tasa baja → crédito grande. Por eso el máximo sale de la tasa mínima.
  const brutoMax = presentValueOfAnnuity(pagoDisponible, tasaMin / 100 / 12, plazoMeses);
  const brutoMin = presentValueOfAnnuity(pagoDisponible, tasaMax / 100 / 12, plazoMeses);

  const creditoMax = Math.min(brutoMax, topeCents);
  const creditoMin = Math.min(brutoMin, topeCents);
  const topeAlcanzado = brutoMax > topeCents;

  if (topeAlcanzado) {
    avisos.push(
      `Tu sueldo daría para más, pero ${labelDe(input.tipo)} topa el crédito. Para pasarte de ahí hay que subir el enganche o combinar con un banco (cofinanciamiento).`,
    );
  }

  // La mensualidad de cada escenario, calculada desde el crédito FINAL de ESE
  // escenario y con la tasa que lo generó (crédito chico ↔ tasa alta).
  //
  // Y luego se ORDENAN. No es cosmético: cuando el tope del producto recorta
  // los dos escenarios al mismo monto, el pago de la tasa alta es el MAYOR, y
  // sin ordenar la pantalla pintaba "de $26,737 a $13,609" — el rango al
  // revés. Con Fovissste eso pasa ya con un sueldo de 30 mil.
  const pagoConTasaBaja = monthlyPayment(creditoMax, tasaMin / 100 / 12, plazoMeses);
  const pagoConTasaAlta = monthlyPayment(creditoMin, tasaMax / 100 / 12, plazoMeses);
  const mensualidadMin = Math.min(pagoConTasaBaja, pagoConTasaAlta);
  const mensualidadMax = Math.max(pagoConTasaBaja, pagoConTasaAlta);

  // ── Presupuesto de compra ───────────────────────────────────────────
  let presupuestoMin: Cents;
  let presupuestoMax: Cents;
  if (input.tipo === "BANCARIO") {
    // 🔴 El aforo es un tope sobre el VALOR DE LA CASA, no sobre el crédito.
    // El banco presta como mucho `aforo × V`, así que el comprador tiene que
    // poner de su bolsa el resto: ahorro ≥ (1 − aforo) × V. Despejando:
    //
    //     V ≤ ahorro / (1 − aforo)
    //
    // y el presupuesto es el menor entre eso y lo que da la capacidad de pago.
    //
    // Dividir el crédito entre el aforo (que fue el primer intento) es la
    // cuenta al revés: da el valor MÍNIMO en el que cabría ese crédito, es
    // siempre mayor que el crédito y por lo tanto casi nunca muerde. Con cero
    // enganche prometía una casa financiada al 100%, que ningún banco da.
    const aforo = params.bancario.aforoMaximoPct / 100;
    const porCapacidadMin = sumCents(creditoMin, ahorro);
    const porCapacidadMax = sumCents(creditoMax, ahorro);
    const porEnganche =
      aforo > 0 && aforo < 1 ? Math.round(ahorro / (1 - aforo)) : Number.MAX_SAFE_INTEGER;
    presupuestoMin = Math.min(porCapacidadMin, porEnganche);
    presupuestoMax = Math.min(porCapacidadMax, porEnganche);
    if (porEnganche < porCapacidadMax) {
      pasos.push(
        `Aquí el techo no es tu sueldo: es el enganche. El banco no presta más del ${params.bancario.aforoMaximoPct}% del valor de la casa, así que tienes que poner el ${Math.round((1 - aforo) * 100)}% restante. Cada peso que ahorres sube el presupuesto varios pesos.`,
      );
    }
  } else {
    presupuestoMin = sumCents(creditoMin, ahorro);
    presupuestoMax = sumCents(creditoMax, ahorro);
  }

  pasos.push(
    "La escrituración va aparte y se paga en efectivo el día de la firma: calcúlala con la otra calculadora antes de comprometer todo el ahorro.",
  );
  if (deudas > 0) {
    pasos.push(
      "Cada peso de mensualidad que liberes de otras deudas se convierte en varios miles de pesos más de crédito.",
    );
  }
  if (ahorro <= 0) {
    pasos.push("Sin enganche el presupuesto es solo el crédito. Cada peso ahorrado sube el techo.");
  }

  return {
    ok: true,
    califica: true,
    tipo: input.tipo,
    tipoLabel: labelDe(input.tipo),
    plazoMeses,
    plazoRecortadoPorEdad: plazoRecortado,
    tasaMinPct: tasaMin,
    tasaMaxPct: tasaMax,
    pagoDisponibleCents: pagoDisponible,
    creditoMinCents: creditoMin,
    creditoMaxCents: creditoMax,
    mensualidadMinCents: mensualidadMin,
    mensualidadMaxCents: mensualidadMax,
    topeProductoCents: topeCents,
    topeAlcanzado,
    presupuestoMinCents: presupuestoMin,
    presupuestoMaxCents: presupuestoMax,
    pasos,
    avisos,
    year: params.year,
    leyenda: leyendaEstimado(params.year, "asesor de crédito"),
  };
}

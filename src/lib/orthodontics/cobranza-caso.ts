// ═══════════════════════════════════════════════════════════════════════════
// EL RESUMEN DE COBRANZA DEL CASO DE ORTODONCIA (ws1-t1, Ola 0) — puro, sin I/O.
//
// Envuelve `estadoDelPlan` (src/lib/invoices/plan-de-pagos.ts) para responder,
// de un vistazo, lo que necesitan Cobro (F1-F5), Recepción (R1-R2), el panel
// de la cita y ResumenCobranza: ¿va al corriente?, ¿cuál es la cuota de hoy?,
// ¿cuánto debe?, ¿tiene saldo a favor?, ¿cuándo vence la siguiente?
//
// Decisión 1 de la arquitectura (REPORTE-ws1-t8.md, sección «Las cuatro
// decisiones»): el dinero vive en la factura a plazos del tratamiento
// (`invoice_payment_terms` + `payments`), NUNCA en OrthoPaymentPlan /
// OrthoInstallment — esas tablas se ocultan, no se leen. Este archivo no las
// conoce ni falta que le hagan: quien llama pasa las condiciones y los cobros
// ya leídos de la factura del tratamiento (`orthodontic_treatment_plans.invoiceId`).
//
// `hoy` se calcula en la ZONA DE LA CLÍNICA (`hoyEnZona`, ya usado por el
// aviso de cobranza por WhatsApp), no la del servidor: es justo el bug que
// arrastra el tablero viejo (`src/lib/orthodontics/load-patients.ts` cuenta
// con `startOfDay(now)` del servidor). No se repite aquí.
//
// Puro y client-safe: sin Prisma, sin `fetch`, sin `Date.now()` implícito
// (recibe `ahora`). El cargador con I/O que arma el input real vive en
// `cobranza-db.ts`, en este mismo módulo.
// ═══════════════════════════════════════════════════════════════════════════

import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { aCentavos, aPesos } from "@/lib/quotes/condiciones-pago";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import {
  calendarioDeCuotas,
  estadoDelPlan,
  pagosDesdeFilas,
  type CuotaConEstado,
  type EstadoCuota,
} from "@/lib/invoices/plan-de-pagos";
import { normalizarOrthoBillingMode } from "./billing-mode";

export interface CobranzaDelCasoInput {
  /**
   * Condiciones de pago de la factura del tratamiento
   * (`invoice_payment_terms`, leídas por `condiciones-pago-db.ts`). `null` =
   * el caso todavía no tiene factura abierta (`invoiceId` nulo) — el
   * resultado sale todo en cero, sin plan que pintar.
   */
  condiciones: CondicionesPago | null;
  /** Total de la factura del tratamiento, en pesos. Se ignora si `condiciones` es `null`. */
  totalFactura: number;
  /** Filas de `payments` de esa factura, tal cual salen de Prisma (`amount`, `method`). */
  cobros: Array<{ amount: unknown; method?: string | null }>;
  /**
   * Saldo a favor del paciente en OTRAS facturas (`PatientCredit`), en pesos.
   * `0` si no aplica. Se suma al excedente de ESTE plan en la salida.
   */
  saldoAFavorPrevio: number;
  /** Instante actual. Nunca `new Date()` implícito: lo decide quien llama. */
  ahora: Date;
  /** IANA de la clínica (ej. `"America/Mexico_City"`). Decide qué cuota ya venció "hoy". */
  zonaHoraria: string;
}

export interface CobranzaDelCaso {
  /** La cuota más vieja que todavía debe algo (puede ser el enganche). `null` = sin plan, o plan saldado. */
  cuotaDeHoy: CuotaConEstado | null;
  /** Cuotas ya saldadas por completo. */
  pagadas: CuotaConEstado[];
  /** Cuotas vencidas que todavía deben algo. */
  vencidas: CuotaConEstado[];
  /** Cuotas que aún no vencen y todavía deben algo. */
  proximas: CuotaConEstado[];
  /** Lo que falta por cobrar de ESTE tratamiento, en pesos. No incluye `saldoAFavor`. */
  saldoTotal: number;
  /** Saldo a favor del paciente: el previo (`saldoAFavorPrevio`) + lo cobrado de más en este plan. */
  saldoAFavor: number;
  /** "YYYY-MM-DD" de la próxima cuota que aún no vence, o `null` si no queda ninguna (plan saldado o sin fechas). */
  proximoVencimiento: string | null;
}

/** Resumen de cobranza de un caso, listo para pintar. Determinista: mismo input, mismo resultado. */
export function cobranzaDelCaso(input: CobranzaDelCasoInput): CobranzaDelCaso {
  const hoy = hoyEnZona(input.ahora, input.zonaHoraria);
  const cuotas = calendarioDeCuotas(input.condiciones, input.totalFactura);
  const pagos = pagosDesdeFilas(input.cobros);
  const estado = estadoDelPlan(cuotas, pagos, hoy);

  return {
    cuotaDeHoy: estado.cuotaActual,
    pagadas: estado.cuotas.filter((c) => c.estado === "pagada"),
    vencidas: estado.cuotas.filter((c) => c.estado === "vencida"),
    proximas: estado.cuotas.filter((c) => c.estado === "porVencer"),
    saldoTotal: estado.pendiente,
    saldoAFavor: aPesos(aCentavos(input.saldoAFavorPrevio) + aCentavos(estado.excedente)),
    proximoVencimiento: estado.siguiente?.vencimiento ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO «PAGO POR CONTROL» (ws1-t1, Ola 2) — segundo motor de cobranza, para
// el caso que nace SIN precio total. Aquí no hay UN plan a plazos: hay N
// facturas independientes (cada control atendido, más la colocación/enganche
// aparte), cada una con su propio total y lo cobrado de ESA factura — no hay
// cascada entre facturas: lo que se cobra de más en una NO se pasa a la
// siguiente (a diferencia de `estadoDelPlan`, que sí reparte en cascada
// porque ahí es UNA sola factura con varias cuotas acordadas).
//
// `cobranzaDelCasoUnificada` es el único punto de entrada que necesita
// quien arma el input real (`cobranza-db.ts`, `tablero-data.ts`,
// `listarMensualidadesPorCobrar.ts`, `cargarPanelDeCobro.ts`,
// `agenda/server.ts`): decide el motor según `modo` y siempre devuelve el
// mismo contrato `CobranzaDelCaso`, así que nadie corriente abajo (Tablero,
// Alertas, ListaMensualidades, aviso en Hoy, marca en la agenda, portal del
// paciente, recordatorio de WhatsApp) necesita saber que hay dos modos.
// ═══════════════════════════════════════════════════════════════════════════

/** Una factura independiente que cuenta como «debe» del caso en modo control: un control atendido, o la colocación/enganche. */
export interface CargoDeControl {
  invoiceId: string;
  /** No entra en la aritmética; para que Recepción sepa qué factura abrir. */
  invoiceNumber: string | null;
  /** Total de la factura, en pesos. */
  total: number;
  /** Lo cobrado de ESA factura hasta hoy, en pesos (`Invoice.paid`, o suma de `payments`). */
  pagado: number;
  /** "YYYY-MM-DD" — `dueDate` de la factura, o su fecha de creación si no tiene. */
  vencimiento: string;
  /** `Invoice.status` tal cual — pasa de largo, no entra en la aritmética. */
  status: string;
}

function cuotaVacia(): CobranzaDelCaso {
  return { cuotaDeHoy: null, pagadas: [], vencidas: [], proximas: [], saldoTotal: 0, saldoAFavor: 0, proximoVencimiento: null };
}

function porVencimiento(a: CuotaConEstado, b: CuotaConEstado): number {
  return (a.vencimiento ?? "").localeCompare(b.vencimiento ?? "");
}

/**
 * Resumen de cobranza a partir de cargos independientes (controles +
 * colocación/enganche, modo `PAGO_POR_CONTROL`). Cada cargo es su propia
 * factura: SIN cascada entre ellos. `saldoAFavor` sale SOLO del excedente de
 * estos cargos (lo cobrado de más en una factura de ESTE caso) — el saldo a
 * favor previo del paciente (otras facturas) lo suma quien llama.
 */
export function cobranzaPorControles(
  cargos: CargoDeControl[],
  ahora: Date,
  zonaHoraria: string,
): CobranzaDelCaso {
  if (cargos.length === 0) return cuotaVacia();
  const hoy = hoyEnZona(ahora, zonaHoraria);
  let excedenteC = 0;

  const cuotas: CuotaConEstado[] = cargos
    .map((c, i) => {
      const importeC = Math.max(0, aCentavos(c.total));
      const pagadoC = Math.max(0, aCentavos(c.pagado));
      const abonadoC = Math.min(importeC, pagadoC);
      excedenteC += Math.max(0, pagadoC - importeC);
      const faltaC = importeC - abonadoC;
      const estado: EstadoCuota = faltaC === 0 ? "pagada" : c.vencimiento < hoy ? "vencida" : "porVencer";
      return {
        numero: i,
        esEnganche: false,
        importe: aPesos(importeC),
        vencimiento: c.vencimiento,
        invoiceId: c.invoiceId,
        abonado: aPesos(abonadoC),
        falta: aPesos(faltaC),
        estado,
      };
    })
    .sort(porVencimiento);

  const vencidas = cuotas.filter((c) => c.estado === "vencida");
  const proximas = cuotas.filter((c) => c.estado === "porVencer");
  const pagadas = cuotas.filter((c) => c.estado === "pagada");
  const pendienteC = cuotas.reduce((acc, c) => acc + aCentavos(c.falta), 0);

  return {
    cuotaDeHoy: vencidas[0] ?? proximas[0] ?? null,
    pagadas,
    vencidas,
    proximas,
    saldoTotal: aPesos(pendienteC),
    saldoAFavor: aPesos(excedenteC),
    proximoVencimiento: proximas[0]?.vencimiento ?? null,
  };
}

/**
 * Une dos resúmenes de cobranza del MISMO caso en uno solo (modo control:
 * colocación/enganche + controles). Nada se cuenta dos veces porque las dos
 * fuentes son disjuntas por construcción (facturas distintas). `null` en
 * ambos = sin nada que cobrar todavía.
 */
export function combinarCobranzas(a: CobranzaDelCaso | null, b: CobranzaDelCaso | null): CobranzaDelCaso | null {
  if (!a && !b) return null;
  const x = a ?? cuotaVacia();
  const y = b ?? cuotaVacia();
  const vencidas = [...x.vencidas, ...y.vencidas].sort(porVencimiento);
  const proximas = [...x.proximas, ...y.proximas].sort(porVencimiento);
  const pagadas = [...x.pagadas, ...y.pagadas].sort(porVencimiento);
  return {
    cuotaDeHoy: vencidas[0] ?? proximas[0] ?? null,
    pagadas,
    vencidas,
    proximas,
    saldoTotal: aPesos(aCentavos(x.saldoTotal) + aCentavos(y.saldoTotal)),
    saldoAFavor: aPesos(aCentavos(x.saldoAFavor) + aCentavos(y.saldoAFavor)),
    proximoVencimiento: proximas[0]?.vencimiento ?? null,
  };
}

export interface CobranzaUnificadaInput {
  /** Como sale crudo de la base (`OrthodonticTreatmentPlan.billingMode`): cualquier string, null o undefined. Se normaliza adentro. */
  modo: string | null | undefined;
  /**
   * La factura del plan a plazos (modo PRECIO_TOTAL) o de la
   * colocación/enganche (modo PAGO_POR_CONTROL) — el mismo campo
   * `OrthodonticTreatmentPlan.invoiceId` en los dos modos. `null` = el caso
   * todavía no tiene esa factura abierta.
   */
  facturaPrincipal: {
    condiciones: CondicionesPago | null;
    totalFactura: number;
    cobros: Array<{ amount: unknown; method?: string | null }>;
  } | null;
  /** Solo aplica en PAGO_POR_CONTROL: los controles atendidos, cada uno con su factura. */
  cargosControl: CargoDeControl[];
  saldoAFavorPrevio: number;
  ahora: Date;
  zonaHoraria: string;
}

/**
 * Punto de entrada único para los dos modos. PRECIO_TOTAL: exactamente el
 * comportamiento de siempre (`cobranzaDelCaso` sin tocar). PAGO_POR_CONTROL:
 * la colocación/enganche (si existe) + los controles atendidos, combinados.
 */
export function cobranzaDelCasoUnificada(input: CobranzaUnificadaInput): CobranzaDelCaso | null {
  const modo = normalizarOrthoBillingMode(input.modo);

  if (modo === "PRECIO_TOTAL") {
    if (!input.facturaPrincipal) return null;
    return cobranzaDelCaso({
      ...input.facturaPrincipal,
      saldoAFavorPrevio: input.saldoAFavorPrevio,
      ahora: input.ahora,
      zonaHoraria: input.zonaHoraria,
    });
  }

  const colocacion = input.facturaPrincipal
    ? cobranzaDelCaso({ ...input.facturaPrincipal, saldoAFavorPrevio: 0, ahora: input.ahora, zonaHoraria: input.zonaHoraria })
    : null;
  const controles = input.cargosControl.length > 0 ? cobranzaPorControles(input.cargosControl, input.ahora, input.zonaHoraria) : null;
  const combinado = combinarCobranzas(colocacion, controles);

  if (!combinado) {
    return input.saldoAFavorPrevio > 0 ? { ...cuotaVacia(), saldoAFavor: input.saldoAFavorPrevio } : null;
  }
  return { ...combinado, saldoAFavor: aPesos(aCentavos(combinado.saldoAFavor) + aCentavos(input.saldoAFavorPrevio)) };
}

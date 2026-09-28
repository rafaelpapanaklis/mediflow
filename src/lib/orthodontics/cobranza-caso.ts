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
} from "@/lib/invoices/plan-de-pagos";

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

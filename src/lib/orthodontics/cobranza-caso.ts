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
import { hoyEnZona } from "@/lib/fechas/hoy-en-zona";
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
    /**
     * ws1-t4 (revisión final, fallo 1) — solo cuenta cuando la factura NO es a
     * plazos (colocación de «Pago por control», pago único de «Precio total»):
     * esa factura es UNA cuota que vence ese día ("YYYY-MM-DD",
     * `vencimientoDeCargoDeControl`). Sin fecha, la cuota se debe pero nunca
     * sale «vencida».
     */
    vencimiento?: string | null;
    /** La factura misma, para que su cuota única sepa qué cobrar. */
    invoiceId?: string | null;
    /**
     * ws1-t4 (segunda pasada de ws1-t1, fallo A) — `Invoice.paid`: LO PAGADO de
     * la factura, la misma cifra que Facturación (cobros normales, pagos
     * migrados de Dentalink, anticipos aplicados, menos reembolsos). Si llega,
     * es LA fuente de lo pagado; `cobros` solo se usa si falta. Un caso
     * importado trae `paid` sin filas en `payments`: sin esto su colocación de
     * $8,000 ya pagada salía «vencida $8,000».
     */
    pagado?: number | null;
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
// ═══════════════════════════════════════════════════════════════════════════
// AGRUPAR VENCIDAS POR FACTURA (ws1-t2, ronda 3 — H7) — `resumen.vencidas` es
// la lista COMPLETA de cuotas vencidas de un caso, pero Recepción («Caja» y
// el aviso de Hoy) cobra por FACTURA, no por cuota suelta: en modo
// PRECIO_TOTAL todas comparten la MISMA factura (`invoiceId` del plan), así
// que se agrupan en una sola fila con el TOTAL vencido; en PAGO_POR_CONTROL
// cada cuota ya trae su propio `invoiceId` (un control es su propia
// factura), así que salen agrupadas por separado — nunca se suman importes
// de dos facturas distintas en una sola fila de cobro.
// ═══════════════════════════════════════════════════════════════════════════

export interface GrupoDeVencidas {
  invoiceId: string;
  cuotas: CuotaConEstado[];
  /** Suma de `falta` de las cuotas del grupo, en pesos. */
  monto: number;
  /** Cuántas cuotas vencidas trae este grupo. */
  cantidad: number;
  /** "YYYY-MM-DD" de la más vieja del grupo. */
  vencimiento: string;
}

/**
 * Agrupa las cuotas vencidas de un caso por la factura a la que pertenecen.
 * `invoiceIdPorDefecto` es la factura del plan (PRECIO_TOTAL): las cuotas sin
 * `invoiceId` propio (todas, en ese modo) caen ahí. Una cuota sin ningún
 * `invoiceId` resoluble (no debería pasar) se descarta, no se pierde en una
 * suma incorrecta.
 */
export function agruparVencidasPorFactura(
  vencidas: CuotaConEstado[],
  invoiceIdPorDefecto: string | null,
): GrupoDeVencidas[] {
  const porFactura = new Map<string, CuotaConEstado[]>();
  for (const cuota of vencidas) {
    const invoiceId = cuota.invoiceId ?? invoiceIdPorDefecto;
    if (!invoiceId) continue;
    const lista = porFactura.get(invoiceId) ?? [];
    lista.push(cuota);
    porFactura.set(invoiceId, lista);
  }

  const grupos: GrupoDeVencidas[] = [];
  for (const [invoiceId, cuotas] of porFactura) {
    const montoC = cuotas.reduce((acc, q) => acc + aCentavos(q.falta), 0);
    const vencimiento = cuotas.reduce<string | null>((min, q) => {
      if (!q.vencimiento) return min;
      return min === null || q.vencimiento < min ? q.vencimiento : min;
    }, null);
    grupos.push({ invoiceId, cuotas, monto: aPesos(montoC), cantidad: cuotas.length, vencimiento: vencimiento ?? "" });
  }
  return grupos;
}

/**
 * La factura principal del caso (plan a plazos, pago único o colocación).
 * ws1-t4 (revisión final, fallo 1): una factura SIN plazos (la colocación de
 * «Pago por control», el pago único de «Precio total») no tiene calendario, y
 * `cobranzaDelCaso` la daba por saldada ($0): Cobranza no enseñaba los $3,000
 * de la colocación sin pagar. Ahora es UNA cuota con lo que falta de toda la
 * factura (sin cascada con los controles: es su propia factura).
 */
/**
 * Lo pagado de la factura principal, como una sola fila para la cascada
 * (`estadoDelPlan` solo usa la suma): `Invoice.paid` si llega, si no las
 * filas de `payments`. Una sola fuente para los dos caminos (con y sin plazos).
 */
export function cobrosDeLaPrincipal(
  f: Pick<NonNullable<CobranzaUnificadaInput["facturaPrincipal"]>, "cobros" | "pagado">,
): Array<{ amount: unknown; method?: string | null }> {
  const pagado = Number(f.pagado);
  if (f.pagado === null || f.pagado === undefined || !Number.isFinite(pagado)) return f.cobros;
  return [{ amount: Math.max(0, pagado) }];
}

function cobranzaDeLaPrincipal(
  fOriginal: NonNullable<CobranzaUnificadaInput["facturaPrincipal"]>,
  saldoAFavorPrevio: number,
  ahora: Date,
  zonaHoraria: string,
): CobranzaDelCaso {
  const f = { ...fOriginal, cobros: cobrosDeLaPrincipal(fOriginal) };
  if (calendarioDeCuotas(f.condiciones, f.totalFactura).length > 0 || !(aCentavos(f.totalFactura) > 0)) {
    return cobranzaDelCaso({ ...f, saldoAFavorPrevio, ahora, zonaHoraria });
  }
  const hoy = hoyEnZona(ahora, zonaHoraria);
  const importeC = aCentavos(f.totalFactura);
  const pagadoC = pagosDesdeFilas(f.cobros).reduce((s, p) => s + aCentavos(p.importe), 0);
  const abonadoC = Math.min(importeC, Math.max(0, pagadoC));
  const faltaC = importeC - abonadoC;
  const vencimiento = f.vencimiento ?? null;
  const estado: EstadoCuota = faltaC === 0 ? "pagada" : vencimiento && vencimiento < hoy ? "vencida" : "porVencer";
  const cuota: CuotaConEstado = {
    numero: 0,
    esEnganche: false,
    importe: aPesos(importeC),
    vencimiento,
    ...(f.invoiceId ? { invoiceId: f.invoiceId } : {}),
    abonado: aPesos(abonadoC),
    falta: aPesos(faltaC),
    estado,
  };
  return {
    cuotaDeHoy: estado === "pagada" ? null : cuota,
    pagadas: estado === "pagada" ? [cuota] : [],
    vencidas: estado === "vencida" ? [cuota] : [],
    proximas: estado === "porVencer" ? [cuota] : [],
    saldoTotal: aPesos(faltaC),
    saldoAFavor: aPesos(aCentavos(saldoAFavorPrevio) + Math.max(0, pagadoC - importeC)),
    proximoVencimiento: estado === "porVencer" ? vencimiento : null,
  };
}

export function cobranzaDelCasoUnificada(input: CobranzaUnificadaInput): CobranzaDelCaso | null {
  const modo = normalizarOrthoBillingMode(input.modo);

  if (modo === "PRECIO_TOTAL") {
    if (!input.facturaPrincipal) return null;
    return cobranzaDeLaPrincipal(input.facturaPrincipal, input.saldoAFavorPrevio, input.ahora, input.zonaHoraria);
  }

  const colocacion = input.facturaPrincipal
    ? cobranzaDeLaPrincipal(input.facturaPrincipal, 0, input.ahora, input.zonaHoraria)
    : null;
  const controles = input.cargosControl.length > 0 ? cobranzaPorControles(input.cargosControl, input.ahora, input.zonaHoraria) : null;
  const combinado = combinarCobranzas(colocacion, controles);

  if (!combinado) {
    return input.saldoAFavorPrevio > 0 ? { ...cuotaVacia(), saldoAFavor: input.saldoAFavorPrevio } : null;
  }
  return { ...combinado, saldoAFavor: aPesos(aCentavos(combinado.saldoAFavor) + aCentavos(input.saldoAFavorPrevio)) };
}

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE DEBE EL CASO (ws1-t4, revisión final, fallo 1) — UN solo número para
// Cobranza, la ficha (Cobro y cabecera «Saldo de ortodoncia»), Casos y la
// cuenta del paciente: plan a plazos / pago único / colocación + controles
// facturados sin pagar + extras sin pagar. Antes cada pantalla sumaba otra
// cosa (Cobranza $200, Cobro $3,000, Facturación $3,200 para el mismo caso).
// ═══════════════════════════════════════════════════════════════════════════

export interface DeudaDelCaso {
  /** Todo lo que falta por cobrar del caso, en pesos. */
  porCobrar: number;
  /** De eso, lo del plan (mensualidades, pago único o colocación) y los controles. */
  delPlan: number;
  /** De eso, los extras (reposiciones, microimplantes…) sin pagar. */
  extras: number;
  extrasCantidad: number;
  /** Lo vencido del plan y los controles (los extras no tienen fecha). */
  vencido: number;
  /** Lo facturado del plan y los controles, y lo abonado a eso (sin excedentes). */
  facturado: number;
  pagado: number;
}

export function deudaDelCaso(
  cobranza: CobranzaDelCaso | null,
  extras: { monto: number; cantidad: number } | null | undefined,
): DeudaDelCaso {
  const cuotas = cobranza ? [...cobranza.pagadas, ...cobranza.vencidas, ...cobranza.proximas] : [];
  const delPlanC = cobranza ? aCentavos(cobranza.saldoTotal) : 0;
  const extrasC = Math.max(0, aCentavos(extras?.monto ?? 0));
  return {
    porCobrar: aPesos(delPlanC + extrasC),
    delPlan: aPesos(delPlanC),
    extras: aPesos(extrasC),
    extrasCantidad: extrasC > 0 ? extras?.cantidad ?? 0 : 0,
    vencido: aPesos((cobranza?.vencidas ?? []).reduce((s, q) => s + aCentavos(q.falta), 0)),
    facturado: aPesos(cuotas.reduce((s, q) => s + aCentavos(q.importe), 0)),
    pagado: aPesos(cuotas.reduce((s, q) => s + aCentavos(q.abonado), 0)),
  };
}

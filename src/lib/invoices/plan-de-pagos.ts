// ═══════════════════════════════════════════════════════════════════════════
// EL PLAN DE PAGOS de una factura a plazos (ws1-t2) — puro, sin I/O.
//
// Contesta de un vistazo: «Vas por la cuota 7 de 24. La siguiente vence el 3 de
// marzo, $2,000. Pendiente $18,000. Al corriente.» Sirve para CUALQUIER
// tratamiento que se cobre a plazos (un implante, una rehabilitación, una
// ortodoncia): nada aquí sabe de especialidades.
//
// ── Por qué DERIVADO y no guardado ────────────────────────────────────────
// El dinero ya tiene una sola verdad: las filas de `payments`. Aquí no se guarda
// «cuota 7 pagada» en ningún sitio: se RECALCULA cada vez a partir de
//   · las condiciones (`invoice_payment_terms`, una ANOTACIÓN del trato), y
//   · lo cobrado de verdad.
// Un reembolso baja lo cobrado y el plan retrocede solo. Una tabla de cuotas
// pagadas se quedaría mintiendo para siempre y serían dos contabilidades.
//
// Este archivo NO cobra, NO mueve `paid`/`balance` y NO crea un `PaymentPlan`.
//
// La aritmética no se reinventa: el reparto en centavos enteros y las fechas
// son los de `lib/quotes/condiciones-pago.ts` (`calcularCalendario`,
// `sumarPeriodos`), los MISMOS con los que el editor de Forma de pago, el PDF y
// el correo le enseñaron el calendario al paciente. Así la cuota 3 vale aquí lo
// mismo que valía en el papel que se acordó.
//
// Client-safe: lo importan la ficha, Caja, y (ws1-t3) el aviso por WhatsApp.
// ═══════════════════════════════════════════════════════════════════════════

import {
  aCentavos,
  aPesos,
  calcularCalendario,
  type CondicionesPago,
} from "@/lib/quotes/condiciones-pago";

/* ── El calendario ────────────────────────────────────────────────────── */

/** Una cuota del plan, tal como se acordó. */
export interface Cuota {
  /** 0 = enganche; 1..N = las cuotas. */
  numero: number;
  esEnganche: boolean;
  /** Pesos, con centavos exactos. */
  importe: number;
  /** "YYYY-MM-DD", o null si el trato no fijó primera fecha. */
  vencimiento: string | null;
}

/** ¿Estas condiciones son un plan a plazos? Un pago único no tiene cuotas. */
export function esPlanAPlazos(c: CondicionesPago | null | undefined): c is CondicionesPago {
  return !!c && c.modo === "plazos";
}

/**
 * Las cuotas de una factura a plazos: enganche (si lo hay) + N cuotas.
 *
 * Determinista. La suma de los importes es EXACTAMENTE `totalFactura`, en
 * centavos: si no lo es, es un fallo (hay una prueba que lo fija).
 *
 * Sin condiciones, o con un pago único, devuelve `[]`: no hay plan que pintar.
 */
export function calendarioDeCuotas(
  condiciones: CondicionesPago | null | undefined,
  totalFactura: number,
): Cuota[] {
  if (!esPlanAPlazos(condiciones)) return [];
  if (!(aCentavos(totalFactura) > 0)) return [];
  return calcularCalendario(totalFactura, condiciones).pagos.map((p) => ({
    numero: p.numero,
    esEnganche: p.esEnganche,
    importe: p.monto,
    vencimiento: p.fecha,
  }));
}

/* ── El cuadre: lo acordado contra la factura de hoy ──────────────────── */

export type DescuadrePlan =
  /** El enganche acordado ya es mayor o igual que el total de la factura. */
  | "engancheCubreTodo"
  /** Se acordaron N cuotas y el total de hoy no da para tantas. */
  | "menosCuotasQueLasAcordadas"
  /** La suma de las cuotas no es el total. No debería pasar nunca. */
  | "noSumaElTotal";

export interface CuadrePlan {
  cuadra: boolean;
  motivo: DescuadrePlan | null;
  /** Suma de las cuotas, en pesos. */
  suma: number;
  total: number;
}

/**
 * ¿El plan que se acordó sigue cabiendo en la factura de hoy?
 *
 * Si el total de la factura cambió después de acordar los plazos, lo acordado
 * (un enganche de $10,000, 24 cuotas) puede haber dejado de tener sentido. Eso
 * NO se ajusta solo ni se esconde: se AVISA, como hace el cuadre del CFDI. Un
 * plan que no cuadra es una conversación con el paciente, no un redondeo.
 */
export function cuadreDelPlan(
  condiciones: CondicionesPago | null | undefined,
  totalFactura: number,
): CuadrePlan {
  const totalC = Math.max(0, aCentavos(totalFactura));
  const cuotas = calendarioDeCuotas(condiciones, totalFactura);
  const sumaC = cuotas.reduce((acc, q) => acc + aCentavos(q.importe), 0);
  const base = { suma: aPesos(sumaC), total: aPesos(totalC) };
  if (!esPlanAPlazos(condiciones) || totalC === 0) return { cuadra: true, motivo: null, ...base };

  const engancheC = Math.max(0, aCentavos(condiciones.enganche));
  if (engancheC >= totalC) return { cuadra: false, motivo: "engancheCubreTodo", ...base };
  const sinEnganche = cuotas.filter((q) => !q.esEnganche).length;
  if (sinEnganche < condiciones.numPagos) return { cuadra: false, motivo: "menosCuotasQueLasAcordadas", ...base };
  if (sumaC !== totalC) return { cuadra: false, motivo: "noSumaElTotal", ...base };
  return { cuadra: true, motivo: null, ...base };
}

/* ── El estado: por dónde va ──────────────────────────────────────────── */

/** Un cobro real. Un reembolso entra como importe negativo (o simplemente no entra). */
export interface PagoRecibido {
  importe: number;
}

/**
 * De las filas de `payments` a lo que entiende `estadoDelPlan`.
 *
 * ⚠️ En `payments` un reembolso NO es una fila negativa: es una fila con
 * `method: "refund"` y `amount` POSITIVO (api/invoices/[id]/refund). Sumar
 * `amount` a secas cuenta el reembolso como cobro. Aquí se le pone el signo.
 *
 * Quien ya tenga `Invoice.paid` (que la ruta de reembolso mantiene al día) puede
 * pasar `[{ importe: invoice.paid }]` y da lo mismo: a la cascada solo le
 * importa cuánto suman.
 */
export function pagosDesdeFilas(
  filas: Array<{ amount: unknown; method?: string | null }> | null | undefined,
): PagoRecibido[] {
  return (filas ?? []).map((f) => {
    const importe = aPesos(Math.abs(aCentavos(f?.amount)));
    return { importe: f?.method === "refund" ? -importe : importe };
  });
}

/** pagada · por vencer · vencida. `abonado` dice además si ya lleva algo a cuenta. */
export type EstadoCuota = "pagada" | "porVencer" | "vencida";

export interface CuotaConEstado extends Cuota {
  /** Lo que la cascada le asignó a esta cuota, en pesos. */
  abonado: number;
  /** Lo que le falta para quedar saldada, en pesos. */
  falta: number;
  estado: EstadoCuota;
}

export interface EstadoPlan {
  /** Todas las cuotas, con lo que la cascada le puso a cada una. */
  cuotas: CuotaConEstado[];
  /** Cuántas cuotas hay SIN contar el enganche: el «24» de «7 de 24». */
  totalCuotas: number;
  /** Cuántas de esas (sin el enganche) están saldadas enteras. */
  pagadas: number;
  /**
   * La cuota por la que va: la más vieja que todavía debe algo. `null` = plan
   * saldado. Puede ser el enganche (`esEnganche`).
   */
  cuotaActual: CuotaConEstado | null;
  /** La próxima que aún no vence y debe algo. `null` si no queda ninguna. */
  siguiente: CuotaConEstado | null;
  /** Cuántas cuotas ya vencieron y siguen debiendo algo. */
  vencidas: number;
  /** Lo que suman esas vencidas, en pesos. */
  importeVencido: number;
  /** Lo pagado ≥ la suma de lo vencido hasta hoy. Nada más. */
  alCorriente: boolean;
  /** Lo cobrado, en pesos (nunca negativo). */
  pagado: number;
  /** Lo que falta del plan entero, en pesos. */
  pendiente: number;
  /** Lo cobrado de MÁS sobre el plan, en pesos. Se enseña, no se reparte. */
  excedente: number;
}

/**
 * Reparte lo cobrado sobre las cuotas DE LA MÁS VIEJA A LA MÁS NUEVA, en
 * cascada: un abono de $5,000 sobre cuotas de $2,000 salda dos y deja $1,000 en
 * la tercera. Nadie elige a qué cuota va un abono.
 *
 * `hoy` es "YYYY-MM-DD" en el día de quien mira. Una cuota vence cuando su día
 * YA PASÓ: la que vence hoy todavía no está vencida. Una cuota sin fecha no
 * vence nunca.
 */
export function estadoDelPlan(
  cuotas: Cuota[],
  pagos: PagoRecibido[],
  hoy: string,
): EstadoPlan {
  const cobradoC = Math.max(0, (pagos ?? []).reduce((acc, p) => acc + aCentavos(p?.importe), 0));
  let restoC = cobradoC;

  const conEstado: CuotaConEstado[] = (cuotas ?? []).map((q) => {
    const importeC = Math.max(0, aCentavos(q.importe));
    const abonadoC = Math.min(importeC, restoC);
    restoC -= abonadoC;
    const faltaC = importeC - abonadoC;
    const estado: EstadoCuota = faltaC === 0
      ? "pagada"
      : q.vencimiento !== null && q.vencimiento < hoy ? "vencida" : "porVencer";
    return { ...q, abonado: aPesos(abonadoC), falta: aPesos(faltaC), estado };
  });

  const vencidas = conEstado.filter((q) => q.estado === "vencida");
  const pendienteC = conEstado.reduce((acc, q) => acc + aCentavos(q.falta), 0);
  const sinEnganche = conEstado.filter((q) => !q.esEnganche);

  return {
    cuotas: conEstado,
    totalCuotas: sinEnganche.length,
    pagadas: sinEnganche.filter((q) => q.estado === "pagada").length,
    cuotaActual: conEstado.find((q) => q.estado !== "pagada") ?? null,
    siguiente: conEstado.find((q) => q.estado === "porVencer") ?? null,
    vencidas: vencidas.length,
    importeVencido: aPesos(vencidas.reduce((acc, q) => acc + aCentavos(q.falta), 0)),
    alCorriente: vencidas.length === 0,
    pagado: aPesos(cobradoC),
    pendiente: aPesos(pendienteC),
    excedente: aPesos(restoC),
  };
}

/**
 * A qué cuotas iría un cobro de `importe` hecho AHORA, sin tocar nada: es lo
 * que Caja y Registrar pago enseñan antes de cobrar («salda la cuota 7 y abona
 * $1,000 a la 8»). Es la misma cascada, comparando el antes y el después.
 */
export function destinoDelAbono(
  cuotas: Cuota[],
  pagos: PagoRecibido[],
  importe: number,
  hoy: string,
): { cuota: CuotaConEstado; aplica: number; laSalda: boolean }[] {
  if (!(aCentavos(importe) > 0)) return [];
  const antes = estadoDelPlan(cuotas, pagos, hoy).cuotas;
  const despues = estadoDelPlan(cuotas, [...(pagos ?? []), { importe }], hoy).cuotas;
  const salida: { cuota: CuotaConEstado; aplica: number; laSalda: boolean }[] = [];
  antes.forEach((q, i) => {
    const aplicaC = aCentavos(despues[i].abonado) - aCentavos(q.abonado);
    if (aplicaC > 0) salida.push({ cuota: q, aplica: aPesos(aplicaC), laSalda: despues[i].estado === "pagada" });
  });
  return salida;
}

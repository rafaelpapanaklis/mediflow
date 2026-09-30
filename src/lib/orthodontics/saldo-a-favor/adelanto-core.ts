// ═══════════════════════════════════════════════════════════════════════════
// SALDO A FAVOR EN ORTODONCIA — el reparto de un cobro con ADELANTO (ws1-t4).
// Puro y client-safe: sin Prisma, sin fetch. Lo usan el servidor (que lo
// vuelve a calcular dentro de la transacción, con las facturas bloqueadas) y
// la ventana de cobro (que solo lo enseña antes de cobrar).
//
// BEVADENT (ticket del gerente): si el paciente paga más que lo de hoy, lo de
// más se abona a las siguientes mensualidades pendientes del caso, en orden de
// vencimiento, y lo que sobre queda como saldo a favor del paciente.
//
//   · La factura que se está cobrando va PRIMERO, hasta su saldo. En «Precio
//     total» es el plan a plazos: su propia cascada ya reparte lo cobrado
//     entre las mensualidades siguientes (`estadoDelPlan`), no hay que hacer
//     nada más dentro de ella.
//   · Después, las demás facturas pendientes del caso (en «Pago por control»:
//     la colocación y los controles ya facturados), de la que vence antes a la
//     que vence después; sin fecha, al final; empate, por id (determinista).
//   · Lo que sobra después de saldarlas todas: saldo a favor (libro
//     `patient_credits`, fila positiva `excedente_de_cobro`).
//
// Todo en centavos enteros: ni un centavo se crea ni se pierde en el reparto
// (la suma de las partes + lo que queda a favor = el monto cobrado).
// ═══════════════════════════════════════════════════════════════════════════

const aCentavos = (pesos: unknown) => Math.round((Number(pesos) || 0) * 100);
const aPesos = (centavos: number) => centavos / 100;

export interface FacturaDelCaso {
  invoiceId: string;
  invoiceNumber: string | null;
  /** Lo que le falta a la factura (total − pagado), en pesos. */
  falta: number;
  /** "YYYY-MM-DD" de su cuota pendiente más vieja (o de la factura). `null` = sin fecha. */
  vencimiento: string | null;
}

export interface ParteDelCobro {
  invoiceId: string;
  invoiceNumber: string | null;
  monto: number;
  /** `true` en la factura que se está cobrando. */
  esLaCobrada: boolean;
}

export interface RepartoDelCobro {
  /** Lo que recibe cada factura, en orden (la cobrada primero). Sin partes en 0. */
  partes: ParteDelCobro[];
  /** Lo que sobra después de saldar todo lo pendiente del caso: saldo a favor. */
  aFavor: number;
  /** Lo cobrado de más sobre la factura cobrada (= Σ otras partes + aFavor). */
  excedente: number;
}

/** Las demás facturas del caso en el orden en que reciben el adelanto. */
export function ordenDeAdelanto(otras: FacturaDelCaso[]): FacturaDelCaso[] {
  return [...otras].sort((a, b) => {
    if (a.vencimiento && b.vencimiento && a.vencimiento !== b.vencimiento) return a.vencimiento < b.vencimiento ? -1 : 1;
    if (a.vencimiento && !b.vencimiento) return -1;
    if (!a.vencimiento && b.vencimiento) return 1;
    return a.invoiceId < b.invoiceId ? -1 : a.invoiceId > b.invoiceId ? 1 : 0;
  });
}

/**
 * Reparte `monto` entre la factura cobrada y las demás pendientes del caso.
 * Las que no deben nada (o están repetidas, o son la misma cobrada) no reciben.
 */
export function repartirCobro(monto: number, cobrada: FacturaDelCaso, otras: FacturaDelCaso[]): RepartoDelCobro {
  let restoC = Math.max(0, aCentavos(monto));
  const partes: ParteDelCobro[] = [];
  const vistas = new Set<string>([cobrada.invoiceId]);

  const primeraC = Math.min(restoC, Math.max(0, aCentavos(cobrada.falta)));
  if (primeraC > 0) {
    partes.push({ invoiceId: cobrada.invoiceId, invoiceNumber: cobrada.invoiceNumber, monto: aPesos(primeraC), esLaCobrada: true });
    restoC -= primeraC;
  }
  const excedenteC = restoC;

  for (const f of ordenDeAdelanto(otras)) {
    if (restoC <= 0) break;
    if (vistas.has(f.invoiceId)) continue;
    vistas.add(f.invoiceId);
    const cabeC = Math.min(restoC, Math.max(0, aCentavos(f.falta)));
    if (cabeC <= 0) continue;
    partes.push({ invoiceId: f.invoiceId, invoiceNumber: f.invoiceNumber, monto: aPesos(cabeC), esLaCobrada: false });
    restoC -= cabeC;
  }

  return { partes, aFavor: aPesos(restoC), excedente: aPesos(excedenteC) };
}

/**
 * La fecha con la que una factura del caso entra en la fila del adelanto: la
 * de su cuota pendiente más vieja. `cuotas` son las cuotas NO pagadas del
 * resumen del caso (`vencidas` + `proximas` de `CobranzaDelCaso`); las que no
 * traen factura propia son del plan a plazos (`invoiceIdPorDefecto`).
 */
export function vencimientoPorFactura(
  cuotas: Array<{ invoiceId?: string | null; vencimiento: string | null }>,
  invoiceIdPorDefecto: string | null,
): Map<string, string> {
  const salida = new Map<string, string>();
  for (const q of cuotas) {
    const id = q.invoiceId ?? invoiceIdPorDefecto;
    if (!id || !q.vencimiento) continue;
    const previa = salida.get(id);
    if (!previa || q.vencimiento < previa) salida.set(id, q.vencimiento);
  }
  return salida;
}

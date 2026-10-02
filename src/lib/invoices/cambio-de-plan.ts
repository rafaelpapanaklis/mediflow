// ═══════════════════════════════════════════════════════════════════════════
// ¿Se puede cambiar el plan de pago de esta factura? (ws1-t11, fallo 4 de la
// revisión final de ortodoncia) — puro, sin I/O.
//
// El bug: «Cambiar plan de pago» reescribía el trato de una factura YA PAGADA
// (MF-1074, «Plan saldado», pasó a «6 pagos mensuales» con calendario Mes 1…6).
// El calendario se DERIVA de las condiciones (lib/invoices/plan-de-pagos.ts):
// cambiar las condiciones de lo ya cobrado es reescribir lo que pasó.
//
// Las reglas:
//   1. Factura pagada completa → su plan no se cambia. Única excepción: anotar
//      el método de una factura de UN pago que nunca tuvo plan (el popup de
//      Nueva factura guarda el trato después de crear, y la factura puede
//      nacer saldada con el anticipo del paciente).
//   2. Factura con pagos parciales que YA tenía un plan a plazos → el plan
//      nuevo solo reparte lo PENDIENTE: lo cobrado queda como enganche, al
//      centavo. Así la cascada de `estadoDelPlan` lo pinta pagado y todas las
//      cuotas nuevas son lo que falta. Pasarla a un solo pago (el resto de
//      golpe) también se puede.
//   3. Mandar lo mismo que ya está guardado nunca es un cambio.
// ═══════════════════════════════════════════════════════════════════════════

import {
  aCentavos,
  aPesos,
  condicionesPorDefecto,
  type CondicionesPago,
} from "@/lib/quotes/condiciones-pago";
import { esPlanAPlazos } from "./plan-de-pagos";

export type MotivoCambioNegado = "FACTURA_PAGADA" | "COBRADO_NO_SE_TOCA";

// Los dos campos en las dos formas: con `"strict": false`, tsc no estrecha la
// unión por `ok` y `veredicto.error` daría TS2339 tras un `if (!veredicto.ok)`.
export type VeredictoCambioDePlan =
  | { ok: true; codigo?: undefined; error?: undefined }
  | { ok: false; codigo: MotivoCambioNegado; error: string };

export interface FacturaParaCambioDePlan {
  total: number;
  /** `Invoice.paid`: lo cobrado neto (la ruta de reembolso lo mantiene al día). */
  pagado: number;
  status: string | null;
}

/** ¿Está saldada? Por estado o por importe (un pago de más también la salda). */
export function facturaSaldada(f: FacturaParaCambioDePlan): boolean {
  const totalC = Math.max(0, aCentavos(f.total));
  return f.status === "PAID" || (totalC > 0 && aCentavos(f.pagado) >= totalC);
}

/** Lo cobrado, en pesos, acotado a [0, total]. Es el enganche obligado de un replan parcial. */
export function cobradoDeLaFactura(f: FacturaParaCambioDePlan): number {
  const totalC = Math.max(0, aCentavos(f.total));
  return aPesos(Math.min(totalC, Math.max(0, aCentavos(f.pagado))));
}

function mismas(a: CondicionesPago, b: CondicionesPago): boolean {
  return a.modo === b.modo
    && a.metodo === b.metodo
    && aCentavos(a.enganche) === aCentavos(b.enganche)
    && a.numPagos === b.numPagos
    && a.frecuencia === b.frecuencia
    && a.primerPago === b.primerPago
    && a.difiereConSuBanco === b.difiereConSuBanco;
}

function dinero(pesos: number): string {
  return `$${pesos.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function revisarCambioDePlan(args: {
  factura: FacturaParaCambioDePlan;
  /** Lo guardado hoy (`null` = la factura no tiene trato). */
  antes: CondicionesPago | null;
  /** Lo que se quiere guardar, ya normalizado. */
  despues: CondicionesPago;
}): VeredictoCambioDePlan {
  const antes = args.antes ?? condicionesPorDefecto();
  const { despues, factura } = args;
  if (mismas(antes, despues)) return { ok: true };

  if (facturaSaldada(factura)) {
    if (!esPlanAPlazos(antes) && !esPlanAPlazos(despues)) return { ok: true };
    return {
      ok: false,
      codigo: "FACTURA_PAGADA",
      error: "Esta factura ya está pagada completa: su plan de pago no se puede cambiar. Lo que ya se cobró no se reescribe.",
    };
  }

  const cobradoC = aCentavos(cobradoDeLaFactura(factura));
  if (cobradoC > 0 && esPlanAPlazos(antes) && esPlanAPlazos(despues) && aCentavos(despues.enganche) !== cobradoC) {
    const cobrado = aPesos(cobradoC);
    const pendiente = aPesos(Math.max(0, aCentavos(factura.total) - cobradoC));
    return {
      ok: false,
      codigo: "COBRADO_NO_SE_TOCA",
      error: `Esta factura ya tiene ${dinero(cobrado)} cobrados: el plan nuevo solo puede repartir lo pendiente (${dinero(pendiente)}). Lo cobrado queda como enganche de ${dinero(cobrado)}.`,
    };
  }

  return { ok: true };
}

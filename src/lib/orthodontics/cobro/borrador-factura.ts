// Ortodoncia — Cobro, ronda 3 (ws1-t2, H9) — puro, sin Prisma. «Abrir plan de
// pago» / «Abrir factura de colocación/enganche» abría el editor de facturas
// EN BLANCO: sin conceptos, «Doctor: Sin asignar», total $0. Recepción tenía
// que teclear todo a mano, y el precio del caso y el de la factura podían
// terminar siendo distintos. `InvoiceEditorModal` ya soporta arrancar con un
// `BorradorDeFactura` (lo usa «Duplicar» del diseño nuevo, sin tocarlo aquí):
// este archivo arma ESE borrador a partir de lo que el caso YA sabe de sí
// mismo — técnica, costo de referencia y doctor tratante — para los DOS
// modos de cobro. Editable siempre: recepción lo puede corregir antes de
// crear la factura, esto solo evita partir de cero.
import type { OrthoTechnique } from "@prisma/client";
import { techniqueLabel } from "../consent-texts";
import type { BorradorDeFactura } from "@/components/dashboard/factura-ficha-rediseno/datos";

export interface CasoParaBorrador {
  technique: OrthoTechnique;
  /** Costo de referencia del caso (`OrthodonticTreatmentPlan.totalCostMxn`), en pesos. */
  totalCostMxn: number;
  treatingDoctorId: string | null;
}

/**
 * El concepto cambia con el modo: PRECIO_TOTAL abre el plan a plazos del
 * tratamiento completo; PAGO_POR_CONTROL abre SOLO la colocación/enganche
 * (los controles se cobran aparte, uno por uno, en Caja) — decirlo evita que
 * recepción piense que ese monto es el tratamiento entero.
 */
export function borradorInicialDelCaso(caso: CasoParaBorrador, esPorControl: boolean): BorradorDeFactura {
  const tecnica = techniqueLabel(caso.technique);
  const nombre = esPorControl
    ? `Colocación/enganche — ortodoncia (${tecnica})`
    : `Tratamiento de ortodoncia (${tecnica})`;
  const precio = Math.max(0, Number(caso.totalCostMxn) || 0);

  return {
    items: [{ name: nombre, quantity: 1, unitPrice: precio, discount: 0 }],
    descuento: 0,
    notes: "",
    doctorId: caso.treatingDoctorId ?? "",
    taxRate: null,
    taxIncluded: null,
    condiciones: null,
  };
}

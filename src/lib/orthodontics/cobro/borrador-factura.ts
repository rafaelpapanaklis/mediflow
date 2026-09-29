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
  /** ws1-t10: nombre propio de la técnica de la clínica; sin él, el del tipo base. */
  techniqueName?: string | null;
  /** Costo de referencia del caso (`OrthodonticTreatmentPlan.totalCostMxn`), en pesos. */
  totalCostMxn: number;
  treatingDoctorId: string | null;
  /**
   * ws1-t12: la aparatología que el plan de tratamiento eligió («Inovation Roth», «Invisalign lite dual»…).
   * La colocación la lleva en su concepto; sin ella el concepto es el de siempre.
   */
  aparatologia?: string | null;
}

/**
 * El concepto cambia con el modo: PRECIO_TOTAL abre el plan a plazos del
 * tratamiento completo; PAGO_POR_CONTROL abre SOLO la colocación/enganche
 * (los controles se cobran aparte, uno por uno, en Caja) — decirlo evita que
 * recepción piense que ese monto es el tratamiento entero.
 */
export function borradorInicialDelCaso(
  caso: CasoParaBorrador,
  esPorControl: boolean,
  /** Precio de «Colocación de aparatología» en el catálogo de la clínica (solo lo usa PAGO_POR_CONTROL). */
  precioColocacion?: number | null,
): BorradorDeFactura {
  const base = techniqueLabel(caso.technique, caso.techniqueName);
  const elegida = caso.aparatologia?.replace(/\s+/g, " ").trim();
  // «Brackets metálicos · Inovation Roth»: la técnica de siempre y, detrás, lo que el plan eligió.
  const tecnica = elegida ? `${base} · ${elegida}` : base;
  const nombre = esPorControl
    ? `Colocación/enganche — ortodoncia (${tecnica})`
    : `Tratamiento de ortodoncia (${tecnica})`;
  // PAGO_POR_CONTROL: la factura es SOLO la colocación. Con el costo de todo el
  // tratamiento el paciente quedaba debiendo $30,000 de colocación más cada
  // control (ws1-t4 #76). Sin precio de catálogo arranca en $0 —que recepción
  // lo teclee— antes que proponer un monto equivocado.
  const precio = esPorControl
    ? Math.max(0, Number(precioColocacion) || 0)
    : Math.max(0, Number(caso.totalCostMxn) || 0);

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

/** Un concepto del catálogo de ortodoncia que se cobra aparte (reposición, retenedor…). */
export interface ConceptoDeExtra {
  name: string;
  price: number;
  /** ws1-t12: lo propone el plan de tratamiento del caso (microtornillo, barra palatina, disyuntor…): va primero. */
  sugerido?: boolean;
  /** «Del plan: Microtornillos». */
  motivo?: string;
}

/**
 * H7 (revisión final): «Cobrar extra» abría el editor en blanco (Subtotal $0,
 * sin doctor) mientras «Abrir plan de pago» ya arrancaba con concepto, precio
 * y doctor. Mismo criterio: parte del borrador del caso (doctor tratante,
 * impuestos) con UN renglón — el concepto elegido del catálogo con su precio, o
 * un renglón de extra genérico sin precio si no se eligió ninguno. Una
 * reposición incluida en el plan arranca en $0. Editable siempre.
 */
export function borradorDeExtra(
  base: BorradorDeFactura,
  concepto: ConceptoDeExtra | null,
  esReposicionIncluida: boolean,
): BorradorDeFactura {
  const nombre = concepto?.name?.trim() || "Extra de ortodoncia";
  const precio = esReposicionIncluida ? 0 : Math.max(0, Number(concepto?.price) || 0);
  return {
    ...base,
    items: [{ name: esReposicionIncluida ? `${nombre} (reposición incluida)` : nombre, quantity: 1, unitPrice: precio, discount: 0 }],
    descuento: 0,
    notes: "",
    condiciones: null,
  };
}

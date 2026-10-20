// El PDF del plan de tratamiento (ws1-t12): QUÉ lleva, en funciones puras.
//
// El plan dental guarda sus procedimientos como TEXTO en `description`
// (`plan-tratamiento-rediseno/plan-clinico.ts`). Se leen con el mismo lector que
// usa «Convertir en presupuesto» (`armarPresupuestoDePlan`, `lib/quotes/desde-plan.ts`),
// así que el PDF y el presupuesto que nace del plan dicen los mismos conceptos y
// los mismos precios (el exacto del tarifario cuando el texto lo redondeó).
//
// ⛔ Lo que NUNCA sale: las notas del plan. Ni el bloque «▸ Notas: …» de la ventana
// nueva ni la descripción libre de un plan de los de antes (que ES la nota). Por eso
// aquí no se copia `description` a ninguna parte: solo los renglones que el lector
// reconoce como procedimientos. Diagnóstico, pronóstico y alternativa tampoco salen
// (no los pidió el encargo; ver «DECISIONES PARA RAFAEL» del reporte ws1-t12).
//
// Dinero:
//  · subtotal = Σ renglones;
//  · el TOTAL es siempre el costo del plan (`totalCost`), el mismo que enseña la
//    ficha. Si alguien lo tecleó a mano y no cuadra con la suma, la diferencia sale
//    como «Descuento» (menor) o «Ajuste» (mayor), para que el papel cuadre solo;
//  · el plan no tiene IVA ni descuentos propios (`model TreatmentPlan` no tiene
//    dónde): no se inventan;
//  · lo pagado solo se sabe por los presupuestos ligados al plan
//    (`quotes.treatmentPlanId`) y sus facturas; sin ellos, el PDF no habla de pagos.

import { armarPresupuestoDePlan, leerRenglonesDelPlan, type ProcedimientoTarifario } from "@/lib/quotes/desde-plan";

/** Diferencias de hasta un peso son redondeo del texto (que escribe pesos enteros), no un descuento. */
export const TOLERANCIA_AJUSTE = 1;

export interface PlanParaPdf {
  name: string;
  description: string | null;
  totalCost: number;
}

export interface RenglonPdf {
  nombre: string;
  /** «16, 26 (MO)» o "" si el renglón no va a una pieza. */
  zona: string;
  /** Nombre de la fase tal como lo escribió la ventana; "" si el plan no tiene fases. */
  fase: string;
  /** El hallazgo que lo justifica («Caries»), o "". */
  motivo: string;
  cantidad: number;
  precioUnitario: number;
  importe: number;
}

export interface GrupoPdf {
  fase: string;
  renglones: RenglonPdf[];
  subtotal: number;
}

export interface PagosDelPlan {
  /** Σ `paid` de las facturas vivas que salieron de los presupuestos del plan. */
  pagado: number;
  /** Facturas encontradas. 0 = el sistema no sabe de pagos de este plan. */
  facturas: number;
}

export interface DocumentoDelPlan {
  grupos: GrupoPdf[];
  /** El plan no traía procedimientos detallados: un solo renglón con su nombre y su costo. */
  sinDetalle: boolean;
  subtotal: number;
  /** total − subtotal cuando pasa de la tolerancia; 0 si no hay. Negativo = descuento. */
  ajuste: number;
  total: number;
  /** null = no se enseñan pagos (sin permiso o sin facturas del plan). */
  pagos: { pagado: number; saldo: number } | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function zonaDe(dientes: string, caras: string): string {
  const lista = dientes ? dientes.split(",").map((d) => d.trim()).filter(Boolean).join(", ") : "";
  if (!lista) return "";
  return caras ? `${lista} (${caras})` : lista;
}

/**
 * Arma el contenido del PDF. `pagos` llega solo si quien descarga puede ver la
 * facturación; con `facturas: 0` es lo mismo que no saber nada.
 */
export function armarDocumentoDelPlan(
  plan: PlanParaPdf,
  tarifario: ProcedimientoTarifario[],
  pagos: PagosDelPlan | null = null,
): DocumentoDelPlan {
  const leidos = leerRenglonesDelPlan(plan.description);
  const armado = armarPresupuestoDePlan(plan, tarifario);

  // Los conceptos salen 1:1 y en orden de los renglones leídos (o uno solo, sin detalle).
  const renglones: RenglonPdf[] = armado.conceptos.map((c, i) => {
    const leido = armado.sinDetalle ? null : leidos[i];
    const cantidad = num(c.quantity) || 1;
    const precioUnitario = r2(num(c.unitPrice));
    return {
      nombre: c.name,
      zona: leido ? zonaDe(leido.dientes, leido.caras) : "",
      fase: leido?.faseNombre ?? "",
      motivo: leido?.motivo ?? "",
      cantidad,
      precioUnitario,
      importe: r2(cantidad * precioUnitario),
    };
  });

  const grupos: GrupoPdf[] = [];
  for (const r of renglones) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fase === r.fase) ultimo.renglones.push(r);
    else grupos.push({ fase: r.fase, renglones: [r], subtotal: 0 });
  }
  for (const g of grupos) g.subtotal = r2(g.renglones.reduce((a, r) => a + r.importe, 0));

  const subtotal = r2(renglones.reduce((a, r) => a + r.importe, 0));
  // El total es el costo del plan, el que enseña la ficha (también un plan confirmado «sin costo»).
  const total = Math.max(0, r2(num(plan.totalCost)));
  const diferencia = r2(total - subtotal);
  const ajuste = Math.abs(diferencia) > TOLERANCIA_AJUSTE ? diferencia : 0;

  const pagosVisibles =
    pagos && pagos.facturas > 0
      ? { pagado: r2(Math.max(0, num(pagos.pagado))), saldo: r2(Math.max(0, total - Math.max(0, num(pagos.pagado)))) }
      : null;

  return { grupos, sinDetalle: armado.sinDetalle, subtotal, ajuste, total, pagos: pagosVisibles };
}

/** «plan-de-tratamiento-ana-lopez-2026-10-20.pdf»: sin acentos, espacios ni símbolos. */
export function nombreDeArchivo(base: string, paciente: string, dia: string): string {
  const limpio = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [limpio(base) || "plan", limpio(paciente), dia].filter(Boolean).join("-").slice(0, 120) + ".pdf";
}

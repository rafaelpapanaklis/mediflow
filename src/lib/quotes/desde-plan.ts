// Del plan de tratamiento al presupuesto (ws1-t3, punto 7e del ticket 3 de BEVADENT).
//
// El plan dental guarda sus procedimientos como TEXTO en `description` (ver
// `plan-tratamiento-rediseno/plan-clinico.ts`: «• Resina — 16, 26 (MO) · 2 × $500 = $1,000 · por Caries»).
// Aquí se lee ese texto de vuelta y se arman los conceptos de un presupuesto BORRADOR.
// Funciones puras: sin base ni sesión, para poder probarlas.
//
// ⚠️ Lo que el texto NO conserva: `formatCurrency` redondea a pesos enteros, así que un precio con
// centavos ($1,250.50) quedó escrito «$1,251». Cuando el nombre coincide con el tarifario y el precio
// del tarifario redondea a lo escrito, se usa el del tarifario (el exacto); si no, el escrito.

import type { QuoteItemInput } from "./types";

const MARCA = "▸ ";

export interface RenglonLeido {
  nombre: string;
  /** Dientes FDI en CSV: «16,26». */
  dientes: string;
  cantidad: number;
  /** null = el texto no traía precio (renglón sin costear). */
  precio: number | null;
  /** Orden de aparición de la fase en el texto, desde 1. */
  fase: number;
  /** El encabezado de la fase tal como quedó escrito («Fase I · Higiénica»), sin su subtotal. */
  faseNombre: string;
  /** Caras tal como se escribieron («MO»); "" si no traía. */
  caras: string;
  motivo: string;
}

export interface ProcedimientoTarifario {
  id: string;
  name: string;
  basePrice: number;
}

export interface ConceptoDePlan extends QuoteItemInput {
  /** Cómo se resolvió el precio, para la vista previa. */
  origen: "plan" | "tarifario" | "sinPrecio";
  /** El nombre coincidió con un procedimiento del tarifario. */
  deTarifario: boolean;
}

export interface PlanParaPresupuesto {
  name: string;
  description: string | null;
  totalCost: number;
}

export interface PresupuestoDePlan {
  conceptos: ConceptoDePlan[];
  total: number;
  /** El plan no traía procedimientos detallados: salió un solo concepto con el nombre y el costo del plan. */
  sinDetalle: boolean;
  /** Renglones sin precio (importe 0): hay que costearlos en el editor. */
  sinPrecio: number;
  /** Renglones que no se encontraron en el tarifario. */
  sinTarifario: number;
  /** El costo escrito en el plan no coincide con la suma de los renglones (más de un peso de diferencia). */
  totalDifiere: boolean;
}

/** «$1,250» / «$1,250.50» / «1250» → número; null si no hay cifra. */
export function leerDinero(texto: string): number | null {
  const limpio = texto.replace(/[^0-9.]/g, "");
  if (!/\d/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const DONDE = /^(.*?) — (\d{2}(?:, ?\d{2})*)(?: \(([A-Z]+)\))?$/;
const CUANTO = /^(\d+(?:\.\d+)?)\s*×\s*([^=]+?)\s*=\s*(.+)$/;
// «por: Caries» es lo que escribe la ventana (`planTratamiento.texto.por` = «por:»).
const MOTIVO = /^(?:por|for|due to|because of):?\s+/i;

function leerLinea(linea: string, fase: number, faseNombre: string): RenglonLeido | null {
  const cuerpo = linea.replace(/^\s*•\s*/, "").trim();
  if (!cuerpo) return null;
  const [cabeza, ...resto] = cuerpo.split(" · ");
  let nombre = cabeza.trim();
  let dientes = "";
  let caras = "";
  const donde = DONDE.exec(nombre);
  if (donde) {
    nombre = donde[1].trim();
    dientes = donde[2].split(",").map((d) => d.trim()).join(",");
    caras = donde[3] ?? "";
  }
  if (!nombre) return null;

  let cantidad = 1;
  let precio: number | null = null;
  const motivos: string[] = [];
  for (const trozo of resto) {
    const cuanto = CUANTO.exec(trozo.trim());
    if (cuanto) {
      cantidad = Math.max(1, Math.round(Number(cuanto[1])) || 1);
      precio = leerDinero(cuanto[2]);
    } else if (trozo.trim()) {
      motivos.push(trozo.trim().replace(MOTIVO, ""));
    }
  }
  return { nombre, dientes, cantidad, precio, fase, faseNombre, caras, motivo: motivos.join(" · ") };
}

/** «▸ Fase I · Higiénica — $1,000» → «Fase I · Higiénica». */
function nombreDeFase(encabezado: string): string {
  return encabezado.replace(/^▸\s*/, "").replace(/\s+—\s+[^—]*$/, "").trim();
}

/**
 * Los renglones que la ventana del plan escribió en `description`. Solo lee los bloques de fase
 * (un encabezado «▸ …» seguido de líneas «• …»); diagnóstico, pronóstico, total, alternativa y notas
 * se ignoran. Una descripción de las de antes (una frase) no trae renglones: devuelve [].
 *
 * Cómo se distingue una fase de lo demás (ws1-t12): el encabezado de una fase NO lleva «:»
 * («▸ Fase I · Higiénica — $1,000»); los demás bloques sí («▸ Diagnóstico: …», «▸ Total…: $…»,
 * «▸ Alternativa ofrecida: …», «▸ Notas: …»). Diagnóstico y pronóstico van ANTES de las fases;
 * total, alternativa y notas, DESPUÉS. Así que el primer bloque «con dos puntos» que aparece tras
 * una fase cierra la lectura: lo que venga detrás es texto libre del doctor y nunca un procedimiento.
 * Antes bastaba con que las notas trajeran una línea «• …» para que salieran como concepto del
 * presupuesto (y, en el PDF del plan, impresas para el paciente).
 */
export function leerRenglonesDelPlan(description: string | null | undefined): RenglonLeido[] {
  if (!description || !description.startsWith(MARCA)) return [];
  const renglones: RenglonLeido[] = [];
  let fase = 0;
  let faseNombre = "";
  let enFase = false;
  for (const bloque of description.split(/\n\s*\n/)) {
    const lineas = bloque.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lineas.length === 0) continue;
    const cabeza = lineas[0];
    if (cabeza.startsWith(MARCA.trim())) {
      if (cabeza.includes(":")) {
        if (fase > 0) break; // total, alternativa o notas: aquí se acaban los procedimientos
        enFase = false; // diagnóstico / pronóstico
        continue;
      }
      enFase = true;
      fase += 1;
      faseNombre = nombreDeFase(cabeza);
    } else if (!enFase) {
      continue; // texto suelto que sigue al diagnóstico
    }
    for (const l of lineas.filter((x) => x.startsWith("•"))) {
      const r = leerLinea(l, fase, faseNombre);
      if (r) renglones.push(r);
    }
  }
  return renglones;
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/** Arma los conceptos del presupuesto a partir del plan y del tarifario de la clínica. */
export function armarPresupuestoDePlan(plan: PlanParaPresupuesto, tarifario: ProcedimientoTarifario[]): PresupuestoDePlan {
  const porNombre = new Map<string, ProcedimientoTarifario>();
  for (const p of tarifario) {
    const k = normalizar(p.name);
    if (k && !porNombre.has(k)) porNombre.set(k, p);
  }

  const leidos = leerRenglonesDelPlan(plan.description);
  const costo = Number.isFinite(plan.totalCost) && plan.totalCost > 0 ? redondear2(plan.totalCost) : 0;
  const sinDetalle = leidos.length === 0;
  const base: RenglonLeido[] = sinDetalle
    ? [{ nombre: plan.name.trim() || "Plan de tratamiento", dientes: "", cantidad: 1, precio: costo > 0 ? costo : null, fase: 1, faseNombre: "", caras: "", motivo: "" }]
    : leidos;

  const conceptos: ConceptoDePlan[] = base.map((r) => {
    const t = porNombre.get(normalizar(r.nombre)) ?? null;
    // El texto del plan redondea a pesos: si el tarifario redondea a lo mismo, vale el exacto.
    const tarifarioExacto = !!t && r.precio != null && Math.round(t.basePrice) === Math.round(r.precio);
    let unitPrice = 0;
    let origen: ConceptoDePlan["origen"] = "sinPrecio";
    if (r.precio != null && r.precio > 0) {
      unitPrice = tarifarioExacto && t ? redondear2(t.basePrice) : r.precio;
      origen = tarifarioExacto ? "tarifario" : "plan";
    } else if (t && t.basePrice > 0) {
      unitPrice = redondear2(t.basePrice);
      origen = "tarifario";
    }
    return {
      procedureId: t?.id ?? null,
      name: r.nombre,
      toothFdi: r.dientes || null,
      quantity: r.cantidad,
      unitPrice,
      discount: 0,
      phase: r.fase,
      notes: r.motivo || null,
      origen,
      deTarifario: !!t,
    };
  });

  const total = redondear2(conceptos.reduce((a, c) => a + c.unitPrice * c.quantity, 0));
  return {
    conceptos,
    total,
    sinDetalle,
    sinPrecio: conceptos.filter((c) => c.unitPrice <= 0).length,
    sinTarifario: conceptos.filter((c) => !c.deTarifario).length,
    totalDifiere: !sinDetalle && costo > 0 && Math.abs(costo - total) > 1,
  };
}

/** Los estados en los que un presupuesto del plan YA cuenta: abrirlo en vez de duplicarlo. */
export const ESTADOS_QUE_YA_CUENTAN = ["DRAFT", "PRESENTED", "ACCEPTED"] as const;

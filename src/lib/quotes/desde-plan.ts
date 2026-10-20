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
import { FASES, FASE_CLAVE, MARCA_EXACTO } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { getDict } from "@/i18n/dictionaries";
import { makeT } from "@/i18n/t";
import { dineroExacto } from "@/lib/treatments/dinero-exacto";

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
      // Tal cual (revisión t8, N-P4): un plan viejo pudo guardar «1.5 ×». La ventana ya solo acepta enteros.
      // Un «0 ×» (un plan de antes lo pudo guardar) se respeta: importe $0 (t8, N3-P3).
      const c = Number(cuanto[1]);
      cantidad = Number.isFinite(c) && c >= 0 ? c : 1;
      precio = leerDinero(cuanto[2]);
    } else if (trozo.trim()) {
      motivos.push(trozo.trim().replace(MOTIVO, ""));
    }
  }
  return { nombre, dientes, cantidad, precio, fase, faseNombre, caras, motivo: motivos.join(" · ") };
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** «▸ Fase I · Higiénica — $1,000» → «Fase I · Higiénica». */
function nombreDeFase(encabezado: string): string {
  return encabezado.replace(/^▸\s*/, "").replace(/\s+—\s+[^—]*$/, "").trim();
}

/**
 * Los nombres de fase que escribe la ventana del plan, en los dos idiomas del panel
 * (`planTratamiento.fase.*` de es.json y en.json), ya normalizados. Solo un encabezado
 * «▸ …» con uno de estos nombres abre una fase (ws1-t12, revisión P4).
 */
/**
 * Los nombres con los que se ESCRIBIERON los planes guardados (es.json / en.json al 20-oct-2026),
 * fijos aquí (revisión t8): si alguien corrige un nombre en el diccionario, los planes ya guardados
 * con el nombre de antes se siguen leyendo. Al nombre nuevo lo agrega solo el diccionario.
 */
export const FASES_ESCRITAS = [
  "Urgencia", "Fase sistémica", "Fase I · Higiénica", "Fase II · Correctiva", "Fase III · Restauradora", "Fase IV · Mantenimiento",
  "Urgent care", "Systemic phase", "Phase I · Hygienic", "Phase II · Corrective", "Phase III · Restorative", "Phase IV · Maintenance",
] as const;
export const TOTALES_ESCRITOS = ["Total de procedimientos", "Procedures total"] as const;

const FASES_CONOCIDAS: ReadonlySet<string> = new Set([
  ...FASES_ESCRITAS.map(normalizar),
  ...(["es", "en"] as const).flatMap((loc) => {
    const t = makeT(getDict(loc));
    return FASES.map((f) => normalizar(t(FASE_CLAVE[f])));
  }),
]);

/** ¿Es el encabezado de una fase escrito por la ventana? «▸ Fase I · Higiénica — $1,000» sí; «▸ Notas: …» no. */
export function esEncabezadoDeFase(linea: string): boolean {
  return linea.startsWith(MARCA.trim()) && FASES_CONOCIDAS.has(normalizar(nombreDeFase(linea)));
}

/** «Total de procedimientos» / «Procedures total» (`planTratamiento.texto.total`), normalizados. */
const TOTALES_CONOCIDOS: ReadonlySet<string> = new Set([
  ...TOTALES_ESCRITOS.map(normalizar),
  ...(["es", "en"] as const).map((loc) => normalizar(makeT(getDict(loc))("planTratamiento.texto.total"))),
]);

/**
 * El «▸ Total de procedimientos: $X» que la ventana escribió con los mismos números que los renglones
 * (la suma de procedimientos, NO el costo del plan). null si no está.
 */
export function leerTotalDelPlan(description: string | null | undefined): number | null {
  if (!description || !description.startsWith(MARCA)) return null;
  for (const linea of description.split("\n").map((l) => l.trim())) {
    if (!linea.startsWith(MARCA.trim())) continue;
    const dos = linea.indexOf(":");
    if (dos < 0) continue;
    if (TOTALES_CONOCIDOS.has(normalizar(linea.slice(0, dos).replace(/^▸\s*/, "")))) return leerDinero(linea.slice(dos + 1));
  }
  return null;
}

/**
 * ¿Lo escribió la ventana de hoy, con los precios exactos? Se fía SOLO de la marca que ella deja
 * (`MARCA_EXACTO`, un espacio duro tras «Total de procedimientos:») — nada de fechas ni de buscar
 * centavos en el texto, que unas notas con «$1,000.00» harían pasar por exacto (t8, N3-P2 y N3-P7).
 * Sin marca = plan de antes: sus precios pudieron quedar redondeados a pesos.
 */
export function textoEsExacto(description: string | null | undefined): boolean {
  if (!description || !description.startsWith(MARCA)) return false;
  for (const linea of description.split("\n")) {
    const l = linea.trim();
    if (!l.startsWith(MARCA.trim())) continue;
    const dos = l.indexOf(":");
    if (dos < 0 || !TOTALES_CONOCIDOS.has(normalizar(l.slice(0, dos).replace(/^▸\s*/, "")))) continue;
    return l.charAt(dos + 1) === MARCA_EXACTO;
  }
  return false;
}

/** Lo contrario: los precios del texto pudieron quedar redondeados a pesos (plan de antes). */
export function textoPuedeEstarRedondeado(plan: { description: string | null | undefined }): boolean {
  return !textoEsExacto(plan.description);
}

/**
 * Los renglones que la ventana del plan escribió en `description`. Solo lee las viñetas «• …» que
 * siguen a un encabezado de fase; diagnóstico, pronóstico, total, alternativa y notas se ignoran.
 * Una descripción de las de antes (una frase) no trae renglones: devuelve [].
 *
 * Línea por línea y solo con fases CONOCIDAS (ws1-t12, revisiones P4 y anterior): un encabezado
 * abre fase solo si su nombre es uno de los de la ventana (`FASES_CONOCIDAS`, es y en). Cualquier
 * otro «▸ …» la cierra, y si ya hubo fases cierra la lectura entera: total, alternativa y notas
 * van DESPUÉS de las fases, así que lo que siga es texto libre del doctor y nunca un procedimiento.
 * No depende de las líneas en blanco: aunque alguien las borre a mano, «▸ Notas: …» y sus
 * viñetas no salen como concepto del presupuesto ni impresas en el PDF del plan.
 */
export function leerRenglonesDelPlan(description: string | null | undefined): RenglonLeido[] {
  if (!description || !description.startsWith(MARCA)) return [];
  const renglones: RenglonLeido[] = [];
  let fase = 0;
  let faseNombre = "";
  let enFase = false;
  for (const linea of description.split("\n").map((l) => l.trim())) {
    if (!linea) continue;
    if (linea.startsWith(MARCA.trim())) {
      if (esEncabezadoDeFase(linea)) {
        enFase = true;
        fase += 1;
        faseNombre = nombreDeFase(linea);
        continue;
      }
      if (fase > 0) break; // total, alternativa o notas: aquí se acaban los procedimientos
      enFase = false; // diagnóstico / pronóstico
      continue;
    }
    if (!enFase || !linea.startsWith("•")) continue;
    const r = leerLinea(linea, fase, faseNombre);
    if (r) renglones.push(r);
  }
  return renglones;
}


const redondear2 = (n: number) => Math.round(n * 100) / 100;

export interface OpcionesDelArmado {
  /**
   * ¿Los precios del texto pudieron quedar redondeados a pesos? Solo entonces el precio exacto del
   * tarifario puede corregir uno del texto. Sin decirlo se lee de la marca del texto
   * (`textoPuedeEstarRedondeado`): sin marca, sí (revisión t8, N-P2 / N3-P2).
   */
  textoRedondeado?: boolean;
}

/** Arma los conceptos del presupuesto a partir del plan y del tarifario de la clínica. */
export function armarPresupuestoDePlan(
  plan: PlanParaPresupuesto,
  tarifario: ProcedimientoTarifario[],
  opciones: OpcionesDelArmado = {},
): PresupuestoDePlan {
  const textoRedondeado = opciones.textoRedondeado ?? textoPuedeEstarRedondeado(plan);
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
  // Con algún renglón con precio, uno sin precio es una CORTESÍA en $0: así lo avisa la ventana al
  // crear el plan («Se guardará en $0 y así pasará al presupuesto»). Un plan confirmado en $0
  // («¿Crear el plan en $0?») tampoco toma precios del tarifario: el presupuesto sale en $0 igual
  // que su PDF, y la vista previa avisa de cada concepto en $0 (t8, N3-P4). Solo un plan CON costo
  // y sin ningún precio por renglón se costea con el tarifario (revisión t8, efecto lateral de P3).
  const conPrecio = base.some((r) => r.precio != null && r.precio > 0);
  const costeaConTarifario = !conPrecio && costo > 0;

  const conceptos: ConceptoDePlan[] = base.map((r) => {
    const t = porNombre.get(normalizar(r.nombre)) ?? null;
    // Un texto viejo redondeó a pesos: si el tarifario redondea a lo mismo, vale el exacto. En un
    // texto exacto (o con centavos en este precio) manda SIEMPRE el precio del plan.
    const tarifarioExacto =
      textoRedondeado && !!t && r.precio != null && Number.isInteger(r.precio) && Math.round(t.basePrice) === Math.round(r.precio);
    let unitPrice = 0;
    let origen: ConceptoDePlan["origen"] = "sinPrecio";
    if (r.precio != null && r.precio > 0) {
      unitPrice = tarifarioExacto && t ? redondear2(t.basePrice) : r.precio;
      origen = tarifarioExacto ? "tarifario" : "plan";
    } else if (costeaConTarifario && t && t.basePrice > 0) {
      unitPrice = redondear2(t.basePrice);
      origen = "tarifario";
    }
    // `QuoteItem.quantity` es entero y de 1 en adelante: una cantidad con decimales («1.5 ×») o un
    // «0 ×» de un plan viejo pasa como 1 al importe exacto ($750, $0), y la nota dice cuánto era
    // (revisión t8, N-P4 y N3-P3).
    const entera = Number.isInteger(r.cantidad) && r.cantidad >= 1;
    const quantity = entera ? r.cantidad : 1;
    const notas = [!entera ? `${r.cantidad} × ${dineroExacto(unitPrice)}` : "", r.motivo].filter(Boolean).join(" · ");
    if (!entera) unitPrice = redondear2(r.cantidad * unitPrice);
    return {
      procedureId: t?.id ?? null,
      name: r.nombre,
      toothFdi: r.dientes || null,
      quantity,
      unitPrice,
      discount: 0,
      phase: r.fase,
      notes: notas || null,
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

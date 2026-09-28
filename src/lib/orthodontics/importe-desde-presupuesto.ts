// Alta del caso desde un presupuesto aceptado (mapa 14 de la revisión de
// lógica de uso). PURO: sin Prisma ni React.
//
// Un presupuesto de ortodoncia aceptado lleva a la ficha con
// `?tab=ortodoncia&abrirCaso=1&presupuesto=<id>` (src/lib/quotes/ortodoncia.ts).
// El alta propone como «costo total del tratamiento» lo que ese presupuesto
// cobra por la ORTODONCIA — no lo demás de un presupuesto mixto («Resina 16»
// va a un plan general aparte) — y dice de dónde salió el número.

import { conceptosGenerales, esPresupuestoDeOrtodoncia } from "@/lib/quotes/ortodoncia";

export interface PresupuestoParaImporte {
  folio: string;
  title: string | null;
  status: string;
  /** Suma de renglones, antes del descuento global. */
  subtotal: number;
  /** Lo que el paciente aceptó pagar (ya con el descuento global). */
  total: number;
  items: ReadonlyArray<{ name: string; lineTotal: number }>;
}

export interface ImporteDelPresupuesto {
  folio: string;
  /** Pesos, redondeado a centavos. */
  importe: number;
  /** Los conceptos que suman ese importe. */
  conceptos: string[];
  nota: string;
}

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * El importe de ortodoncia de un presupuesto, o `null` si no aplica (no
 * aceptado, no es de ortodoncia o no da un número mayor que cero).
 *
 * - Los conceptos de ortodoncia son los que NO devuelve `conceptosGenerales`.
 * - Si ningún concepto nombra la ortodoncia (el presupuesto lo es por su
 *   título: «Ortodoncia completa» con «Fase 1», «Fase 2»), todo el
 *   presupuesto es el tratamiento.
 * - El descuento global del presupuesto se reparte en proporción: si todo es
 *   de ortodoncia, sale justo el total aceptado.
 */
export function importeDeOrtodonciaDelPresupuesto(p: PresupuestoParaImporte): ImporteDelPresupuesto | null {
  if (p.status !== "ACCEPTED") return null;
  if (!esPresupuestoDeOrtodoncia({ title: p.title, items: p.items })) return null;

  const generales = new Set(conceptosGenerales(p.items));
  let deOrtodoncia = p.items.filter((i) => !generales.has(i));
  if (deOrtodoncia.length === 0) deOrtodoncia = [...p.items];

  const suma = deOrtodoncia.reduce((acc, i) => acc + (Number.isFinite(i.lineTotal) ? i.lineTotal : 0), 0);
  const factor = p.subtotal > 0 && p.total >= 0 && p.total < p.subtotal ? p.total / p.subtotal : 1;
  const importe = centavos(suma * factor);
  if (!(importe > 0)) return null;

  const conceptos = deOrtodoncia.map((i) => i.name);
  return {
    folio: p.folio,
    importe,
    conceptos,
    nota: notaDelPresupuesto(p.folio, conceptos.length < p.items.length),
  };
}

export function notaDelPresupuesto(folio: string, soloParte: boolean): string {
  return soloParte
    ? `Tomado del presupuesto ${folio} (solo los conceptos de ortodoncia). Puedes cambiarlo.`
    : `Tomado del presupuesto ${folio}. Puedes cambiarlo.`;
}

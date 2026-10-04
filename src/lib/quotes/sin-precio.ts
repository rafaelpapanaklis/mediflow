// ─────────────────────────────────────────────────────────────────────────────
// Renglones sin precio en el plan y el presupuesto (auditoría de uso, C-63).
//
// Un procedimiento escrito a mano sin precio ($0) se guardaba en el plan y se
// PRESENTABA al paciente sin aviso; el aviso solo salía al «Convertir en
// presupuesto». Ahora se cuenta en los tres momentos con la misma regla: un
// renglón con nombre y precio vacío, cero o inválido.
//
// No se bloquea (un procedimiento de cortesía en $0 es legítimo): se pregunta.
// PURO.
// ─────────────────────────────────────────────────────────────────────────────

import { useLocale } from "@/i18n/i18n-provider";

function sinPrecio(precio: unknown): boolean {
  if (precio === null || precio === undefined) return true;
  if (typeof precio === "string" && precio.trim() === "") return true;
  const n = Number(precio);
  return !Number.isFinite(n) || n <= 0;
}

/** Renglones del plan nuevo (`{ procedimiento, precio }` con el precio como texto). Los vacíos no cuentan. */
export function renglonesDelPlanSinPrecio(renglones: ReadonlyArray<{ procedimiento: string; precio: string }>): number {
  return renglones.filter((r) => r.procedimiento.trim() !== "" && sinPrecio(r.precio)).length;
}

/** Conceptos de un presupuesto con precio unitario en $0. */
export function conceptosDelPresupuestoSinPrecio(items: ReadonlyArray<{ unitPrice: number }>): number {
  return items.filter((i) => sinPrecio(i.unitPrice)).length;
}

const es = {
  planTitulo: (n: number) => (n === 1 ? "1 procedimiento no tiene precio" : `${n} procedimientos no tienen precio`),
  planTexto: "Se guardará en $0 y así pasará al presupuesto. Si es de cortesía, sigue; si no, ponle precio antes.",
  planSeguir: "Crear el plan así",
  presentarTitulo: (n: number) => (n === 1 ? "1 concepto está en $0" : `${n} conceptos están en $0`),
  presentarTexto: "El paciente verá esos conceptos sin costo. ¿Presentar el presupuesto así?",
  presentarSeguir: "Presentar así",
  volver: "Volver a revisar",
  aviso: (n: number) => (n === 1 ? "1 procedimiento sin precio ($0)" : `${n} procedimientos sin precio ($0)`),
  procesando: "Guardando…",
};

const en: typeof es = {
  planTitulo: (n: number) => (n === 1 ? "1 procedure has no price" : `${n} procedures have no price`),
  planTexto: "It will be saved at $0 and carried into the quote that way. If it's complimentary, go ahead; if not, price it first.",
  planSeguir: "Create the plan anyway",
  presentarTitulo: (n: number) => (n === 1 ? "1 item is at $0" : `${n} items are at $0`),
  presentarTexto: "The patient will see those items at no cost. Present the quote anyway?",
  presentarSeguir: "Present anyway",
  volver: "Go back and review",
  aviso: (n: number) => (n === 1 ? "1 procedure without a price ($0)" : `${n} procedures without a price ($0)`),
  procesando: "Saving…",
};

export type TextosSinPrecio = typeof es;

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosSinPrecio(): TextosSinPrecio {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return locale === "en" ? en : es;
}

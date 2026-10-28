/**
 * Lo PURO de los medicamentos propios de la clínica (ws1-t10): tipos, límites,
 * cómo se arma la fila que se guarda en `cums_items` y la validación del alta.
 * Sin Prisma ni Node: lo importan el servidor (`medicamentos-propios.server.ts`)
 * y la pantalla (`cums-selector.tsx`). El diseño completo está explicado en el
 * archivo del servidor.
 */

import type { Controlado } from "@/lib/clinical/controlados";

/** Lo que el buscador y la receta ven de un medicamento (global o propio). */
export interface MedicamentoCatalogo {
  clave: string;
  descripcion: string;
  presentacion: string;
  formaFarmaceutica: string | null;
  grupoTerapeutico: string | null;
  cofeprisGroup: string | null;
  /** `true` si es de la lista propia de la clínica. */
  propio?: boolean;
}

/** Grupo terapéutico con el que se guardan las filas propias (no se enseña en pantalla). */
export const GRUPO_PROPIO = "Propio de la clínica";

export const LIMITES_PROPIO = {
  nombre: 120,
  concentracion: 60,
  forma: 60,
  via: 40,
  presentacion: 120,
  /** `cums_items.presentacion` es VARCHAR(200). */
  presentacionGuardada: 200,
} as const;

export interface AltaMedicamentoPropio {
  nombre: string;
  concentracion: string;
  forma: string;
  via: string;
  presentacion?: string | null;
}

export type ResultadoAlta =
  | { ok: true; medicamento: MedicamentoCatalogo; existia: boolean }
  | { ok: false; error: "sin_sql" }
  | { ok: false; error: "datos_invalidos"; campo: keyof AltaMedicamentoPropio }
  | { ok: false; error: "medicamento_controlado"; controlado: Controlado };

function limpio(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Nombre y presentación tal como se guardan (y como salen en el PDF y en el QR). */
export function armarFilaPropia(alta: AltaMedicamentoPropio): { descripcion: string; presentacion: string; formaFarmaceutica: string } {
  const nombre = limpio(alta.nombre, LIMITES_PROPIO.nombre);
  const concentracion = limpio(alta.concentracion, LIMITES_PROPIO.concentracion);
  const forma = limpio(alta.forma, LIMITES_PROPIO.forma);
  const via = limpio(alta.via, LIMITES_PROPIO.via);
  const presentacion = limpio(alta.presentacion, LIMITES_PROPIO.presentacion);
  // «500 mg, caja c/10 tabletas, vía oral»: la presentación del catálogo lleva
  // la concentración y la caja; la vía va al final porque el catálogo global no
  // tiene columna para ella y así queda impresa en la receta.
  const partes = [concentracion, presentacion, via ? `vía ${via.toLowerCase()}` : ""].filter(Boolean);
  return {
    descripcion: nombre,
    presentacion: partes.join(", ").slice(0, LIMITES_PROPIO.presentacionGuardada),
    formaFarmaceutica: forma,
  };
}

/** Valida los campos: nombre, concentración, forma y vía obligatorios. */
export function validarAlta(alta: Partial<AltaMedicamentoPropio>): { ok: true; alta: AltaMedicamentoPropio } | { ok: false; campo: keyof AltaMedicamentoPropio } {
  const nombre = limpio(alta.nombre, LIMITES_PROPIO.nombre);
  const concentracion = limpio(alta.concentracion, LIMITES_PROPIO.concentracion);
  const forma = limpio(alta.forma, LIMITES_PROPIO.forma);
  const via = limpio(alta.via, LIMITES_PROPIO.via);
  if (nombre.length < 2) return { ok: false, campo: "nombre" };
  if (!concentracion) return { ok: false, campo: "concentracion" };
  if (!forma) return { ok: false, campo: "forma" };
  if (!via) return { ok: false, campo: "via" };
  return { ok: true, alta: { nombre, concentracion, forma, via, presentacion: limpio(alta.presentacion, LIMITES_PROPIO.presentacion) || null } };
}

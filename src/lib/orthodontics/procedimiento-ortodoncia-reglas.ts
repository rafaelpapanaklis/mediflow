// Ortodoncia — reglas de alta y edición de un procedimiento de la categoría
// «Ortodoncia» desde Procedimientos o desde Configuración de Ortodoncia. PURO.
// Las aplica el API (POST/PATCH /api/procedures) para que ningún cliente pueda
// saltárselas, y las usa la pantalla para no ofrecer lo que el servidor rechaza.

import { CODIGO_CONTROL_ORTO, ORTHO_CATALOG_CATEGORY } from "./catalog-procedures-constantes";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";

export interface FilaExistente {
  name: string;
  code: string | null;
  category: string;
}

/** La fila del control: por su llave, o por el nombre de siempre si aún no la lleva. */
export function esFilaDelControl(fila: FilaExistente): boolean {
  return fila.code === CODIGO_CONTROL_ORTO || (fila.category === ORTHO_CATALOG_CATEGORY && fila.name === TIPO_CITA_CONTROL_ORTO);
}

function mismoNombre(a: string, b: string): boolean {
  const n = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return n(a) === n(b);
}

export interface PeticionAlta {
  name: string;
  category: string;
  /** Lo que llegó en `orthoIncludedInTreatment` (undefined = no vino). */
  incluido: boolean | null | undefined;
  moduloActivo: boolean;
}

/** Alta: `null` si vale, o el motivo de rechazo. */
export function errorDeAltaDeOrtodoncia(p: PeticionAlta): string | null {
  if (p.category !== ORTHO_CATALOG_CATEGORY) return null;
  if (!p.moduloActivo) return "El módulo de Ortodoncia no está activo: no se pueden crear procedimientos de esa categoría.";
  if (mismoNombre(p.name, TIPO_CITA_CONTROL_ORTO)) {
    return `«${TIPO_CITA_CONTROL_ORTO}» ya existe y es fijo. Ponle otro nombre al procedimiento.`;
  }
  if (typeof p.incluido !== "boolean") return "Elige cómo se cobra: incluido en el tratamiento o con costo aparte.";
  return null;
}

export interface PeticionCambio {
  existente: FilaExistente;
  /** Categoría que pide el cambio (undefined = no la toca). */
  categoria: string | undefined;
  nombre: string | undefined;
  incluido: boolean | null | undefined;
  moduloActivo: boolean;
}

export interface ResultadoCambio {
  error: string | null;
  /** ¿Se debe aplicar `orthoIncludedInTreatment`? Nunca a la fila del control. */
  aplicarIncluido: boolean;
}

/** Edición: rechaza lo que no se puede y dice si el «incluido» se aplica. */
export function evaluarCambioDeOrtodoncia(p: PeticionCambio): ResultadoCambio {
  const control = esFilaDelControl(p.existente);
  if (control) {
    if (p.categoria !== undefined && p.categoria !== ORTHO_CATALOG_CATEGORY) {
      return { error: `«${TIPO_CITA_CONTROL_ORTO}» es de la categoría Ortodoncia y no se puede sacar de ahí.`, aplicarIncluido: false };
    }
    // Su cobro depende del modo de cobro de la clínica: el «incluido» no se toca.
    return { error: null, aplicarIncluido: false };
  }
  const categoriaFinal = p.categoria ?? p.existente.category;
  if (categoriaFinal !== ORTHO_CATALOG_CATEGORY) return { error: null, aplicarIncluido: p.incluido !== undefined };
  // Pasar un procedimiento A Ortodoncia es como crearlo: módulo activo y cobro elegido.
  const entraAOrtodoncia = p.existente.category !== ORTHO_CATALOG_CATEGORY;
  if (entraAOrtodoncia) {
    if (!p.moduloActivo) return { error: "El módulo de Ortodoncia no está activo: no se pueden crear procedimientos de esa categoría.", aplicarIncluido: false };
    if (typeof p.incluido !== "boolean") return { error: "Elige cómo se cobra: incluido en el tratamiento o con costo aparte.", aplicarIncluido: false };
  }
  if (p.nombre !== undefined && mismoNombre(p.nombre, TIPO_CITA_CONTROL_ORTO)) {
    return { error: `«${TIPO_CITA_CONTROL_ORTO}» ya existe y es fijo. Ponle otro nombre al procedimiento.`, aplicarIncluido: false };
  }
  return { error: null, aplicarIncluido: p.incluido !== undefined };
}

/** Etiqueta en español del cobro de un procedimiento de ortodoncia. */
export function etiquetaDeCobro(incluido: boolean | null | undefined): string | null {
  if (incluido === true) return "Incluido en el tratamiento";
  if (incluido === false) return "Con costo aparte";
  return null;
}

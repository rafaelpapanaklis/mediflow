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

// ── La descripción SEMBRADA sigue a la bandera (ws1-t6, punto 6 del tercer ticket) ──
// La precarga escribe el cobro también en la descripción («Con costo aparte.»). Al
// marcar después «Incluido», solo cambiaba la bandera: la lista enseñaba a la vez
// «Incluido en el tratamiento» y «Con costo aparte.». El cobro obedece a la bandera;
// el texto tiene que decir lo mismo. Solo se reescribe un texto que DaleControl
// sembró (alguna de sus variantes): lo que la clínica escribió a mano no se toca.

/** Lo que algunas filas de la precarga dicen ANTES del cobro. */
const PREFIJO_SEMBRADO: Readonly<Record<string, string>> = {
  "Urgencia de ortodoncia": "Fuera del control del mes. ",
};
/** Filas cuyo «con costo aparte» sembrado lleva un matiz propio. */
const COSTO_APARTE_SEMBRADO: Readonly<Record<string, string>> = {
  "Reposición de bracket": "Con costo aparte, pasadas las reposiciones incluidas del caso.",
};

/** La descripción que la precarga le pone a `nombre` con ese cobro. PURO. */
export function descripcionSembrada(nombre: string, incluido: boolean): string {
  const n = nombre.trim();
  const cobro = incluido ? "Incluido en el tratamiento." : COSTO_APARTE_SEMBRADO[n] ?? "Con costo aparte.";
  return `${PREFIJO_SEMBRADO[n] ?? ""}${cobro}`;
}

const normalizar = (t: string) => t.normalize("NFC").replace(/\s+/g, " ").trim();

/** ¿Es `descripcion` un texto que sembró DaleControl (para ese nombre o el genérico)? */
export function esDescripcionSembrada(nombre: string, descripcion: string | null | undefined): boolean {
  const d = normalizar(descripcion ?? "");
  if (!d) return false;
  const variantes = [true, false].flatMap((v) => [descripcionSembrada(nombre, v), descripcionSembrada("", v)]);
  return variantes.some((x) => normalizar(x) === d);
}

/**
 * Al guardar un cambio de «incluido / con costo aparte»: la descripción que debe quedar,
 * o `undefined` si no hay que tocarla. Se reescribe solo si la descripción que queda es
 * un texto sembrado y quien guarda no la cambió en este mismo guardado (si la tecleó, manda
 * lo que tecleó).
 */
export function descripcionTrasCambioDeCobro(p: {
  nombre: string;
  /** La que está guardada. */
  actual: string | null | undefined;
  /** La que llegó en el cuerpo (undefined = no vino). */
  enviada: string | null | undefined;
  incluido: boolean | null | undefined;
}): string | undefined {
  if (typeof p.incluido !== "boolean") return undefined;
  const enviada = p.enviada === undefined ? undefined : normalizar(p.enviada ?? "");
  if (enviada !== undefined && enviada !== normalizar(p.actual ?? "")) return undefined;
  if (!esDescripcionSembrada(p.nombre, p.actual)) return undefined;
  const nueva = descripcionSembrada(esDescripcionSembradaDe(p.nombre, p.actual) ? p.nombre : "", p.incluido);
  return normalizar(nueva) === normalizar(p.actual ?? "") ? undefined : nueva;
}

/** ¿El texto sembrado es el PROPIO de ese nombre (no el genérico)? */
function esDescripcionSembradaDe(nombre: string, descripcion: string | null | undefined): boolean {
  const d = normalizar(descripcion ?? "");
  return [true, false].some((v) => normalizar(descripcionSembrada(nombre, v)) === d);
}

/**
 * ¿La descripción (escrita a mano) dice lo contrario de la bandera? Para avisar en la
 * lista sin reescribir nada. Mismo criterio de lectura que `cobroDelProcedimiento`.
 */
export function descripcionContradiceCobro(descripcion: string | null | undefined, incluido: boolean | null | undefined): boolean {
  if (typeof incluido !== "boolean") return false;
  const d = (descripcion ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (incluido && /\bcon costo aparte\b/.test(d)) return true;
  if (!incluido && /^\s*incluid[oa] en el tratamiento\b/.test(d)) return true;
  return false;
}

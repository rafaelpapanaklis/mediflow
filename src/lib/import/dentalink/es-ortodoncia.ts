// ¿Un tratamiento de Dentalink es de ORTODONCIA? Función COMPARTIDA (ws1-t8) que usan el importador de
// tratamientos normales (los de ortodoncia no entran ahí) y el de casos de ortodoncia (ws1-t12).
//
// Contrato: un tratamiento es de ortodoncia si CUALQUIERA de sus renglones cumple una de tres:
//   1. «Nombre Categoría» es Ortodoncia (sin acentos ni mayúsculas).
//   2. La prestación contiene ortodoncia / bracket(s) / alineador(es) / Damon / contención / TAD(s).
//   3. La especialidad del profesional es Ortodoncia.
//
// Acepta el renglón crudo del export (encabezados de Dentalink, con o sin acentos) o el ya mapeado por el motor
// (`procedure`, `categoria`, `especialidad`): las claves se comparan sin acentos, sin mayúsculas y sin símbolos.
// Sin dependencias del motor: la usan scripts y handlers por igual.

export type RenglonDentalink = Record<string, unknown>;

const CLAVES_CATEGORIA = ["nombrecategoria", "categoria", "categoriaprestacion"];
const CLAVES_PRESTACION = ["nombreprestacion", "procedure", "procedimiento"];
const CLAVES_ESPECIALIDAD = ["especialidadprofesionaltratamiento", "especialidadprofesional", "especialidaddelprofesional", "especialidad"];

/** Minúsculas, sin acentos, espacios simples. */
export function sinAcentos(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function claveNormalizada(k: string): string {
  return sinAcentos(k).replace(/[^a-z0-9]/g, "");
}

/** Valor de la primera clave (en orden de preferencia) que exista en el renglón y no venga vacía. */
export function campoDeRenglon(r: RenglonDentalink, candidatas: string[]): string {
  const porClave = new Map<string, unknown>();
  for (const k of Object.keys(r)) porClave.set(claveNormalizada(k), r[k]);
  for (const c of candidatas) {
    const v = porClave.get(c);
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export const categoriaDeRenglon = (r: RenglonDentalink) => campoDeRenglon(r, CLAVES_CATEGORIA);
export const prestacionDeRenglon = (r: RenglonDentalink) => campoDeRenglon(r, CLAVES_PRESTACION);
export const especialidadDeRenglon = (r: RenglonDentalink) => campoDeRenglon(r, CLAVES_ESPECIALIDAD);

const PRESTACION_DE_ORTODONCIA = /ortodonc|brackets?\b|alineador|damon|contencion|\btads?\b/;

/** ¿Este nombre de prestación es de ortodoncia? (regla 2 sola, para catálogo y pantallas). */
export function prestacionEsOrtodoncia(nombre: unknown): boolean {
  return PRESTACION_DE_ORTODONCIA.test(sinAcentos(nombre));
}

/** ¿Este renglón, por sí solo, apunta a ortodoncia? */
export function renglonEsOrtodoncia(r: RenglonDentalink): boolean {
  if (sinAcentos(categoriaDeRenglon(r)) === "ortodoncia") return true;
  if (prestacionEsOrtodoncia(prestacionDeRenglon(r))) return true;
  return sinAcentos(especialidadDeRenglon(r)).includes("ortodonc");
}

/** ¿El tratamiento (todos los renglones de un mismo «# Tratamiento») es de ortodoncia? Sin renglones → false. */
export function esOrtodonciaDentalink(renglones: RenglonDentalink[]): boolean {
  return Array.isArray(renglones) && renglones.some((r) => !!r && renglonEsOrtodoncia(r));
}

// Ortodoncia — técnicas PROPIAS de cada clínica (ws1-t10, ampliación de la decisión 2 de Rafael).
// Puro: sin Prisma ni React. Cada clínica tiene su lista { id, nombre, tipo base, precio, activa },
// sembrada con las 7 de siempre. El «tipo base» es uno de los 7 del enum OrthoTechnique y es lo que
// sigue guardándose en `technique` del plan (alineadores, consentimientos, expediente… dependen de él);
// el nombre propio viaja aparte, en `techniqueLabel` del plan.

import {
  TECNICAS_ORTO,
  PRECIO_MAXIMO,
  normalizarPrecios,
  type PreciosPorTecnica,
  type TecnicaOrto,
} from "./precios-por-tecnica";

export interface TecnicaClinica {
  /** Estable: las 7 de siempre usan la clave del enum; las propias, «t-…». */
  id: string;
  nombre: string;
  base: TecnicaOrto;
  /** MXN; null = sin precio (el alta no propone costo). */
  precio: number | null;
  /** false = «quitada»: no se ofrece en casos nuevos, los casos que ya la usan la siguen mostrando. */
  activa: boolean;
}

export const NOMBRE_MAXIMO = 60;
export const TECNICAS_MAXIMAS = 40;

const BASES = new Set<string>(TECNICAS_ORTO.map((t) => t.key));
const ID_VALIDO = /^[A-Za-z0-9_-]{1,40}$/;

export function etiquetaEstandar(base: string): string {
  return TECNICAS_ORTO.find((t) => t.key === base)?.label ?? base;
}

/** Nombre de una sola línea, recortado; "" si no queda nada. */
export function limpiarNombre(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, NOMBRE_MAXIMO);
}

/** Las 7 de siempre, con los precios que la clínica ya tenía en `techniquePrices`. */
export function tecnicasDeSiempre(precios?: PreciosPorTecnica | null): TecnicaClinica[] {
  return TECNICAS_ORTO.map((t) => ({
    id: t.key,
    nombre: t.label,
    base: t.key,
    precio: typeof precios?.[t.key] === "number" ? (precios[t.key] as number) : null,
    activa: true,
  }));
}

function precioValido(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > PRECIO_MAXIMO) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Lo que llega de la base o del cliente → lista limpia. Descarta lo que no sirve (sin nombre, tipo base
 * desconocido, id repetido). `null` = no es una lista (columna vacía/ausente): quien llama siembra.
 */
export function normalizarTecnicas(raw: unknown): TecnicaClinica[] | null {
  if (!Array.isArray(raw)) return null;
  const vistos = new Set<string>();
  const out: TecnicaClinica[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const nombre = limpiarNombre(o.nombre);
    const base = typeof o.base === "string" ? o.base : "";
    if (!ID_VALIDO.test(id) || vistos.has(id) || !nombre || !BASES.has(base)) continue;
    vistos.add(id);
    out.push({ id, nombre, base: base as TecnicaOrto, precio: precioValido(o.precio), activa: o.activa !== false });
    if (out.length >= TECNICAS_MAXIMAS) break;
  }
  return out;
}

/** La lista de la clínica: la guardada, o —si nunca la editó— las 7 de siempre con sus precios. */
export function resolverTecnicas(lista: unknown, precios?: PreciosPorTecnica | null): TecnicaClinica[] {
  const guardada = normalizarTecnicas(lista);
  return guardada ?? tecnicasDeSiempre(normalizarPrecios(precios));
}

export function tecnicasActivas(lista: readonly TecnicaClinica[]): TecnicaClinica[] {
  return lista.filter((t) => t.activa);
}

/** ¿Falta alguna de las 7 de siempre (quitada, desactivada o renombrada)? → se ofrece «Restaurar». */
export function faltanDeSiempre(lista: readonly TecnicaClinica[]): boolean {
  return TECNICAS_ORTO.some((t) => {
    const x = lista.find((y) => y.id === t.key);
    return !x || !x.activa || x.nombre !== t.label || x.base !== t.key;
  });
}

/** Devuelve las de siempre a su nombre y las reactiva; conserva su precio y todas las propias. */
export function restaurarDeSiempre(lista: readonly TecnicaClinica[]): TecnicaClinica[] {
  const propias = lista.filter((t) => !BASES.has(t.id));
  const de7 = TECNICAS_ORTO.map((t) => {
    const x = lista.find((y) => y.id === t.key);
    return { id: t.key, nombre: t.label, base: t.key, precio: x?.precio ?? null, activa: true } as TecnicaClinica;
  });
  return [...de7, ...propias];
}

/** Id nuevo para una técnica propia; `azar` (0..1) viene del cliente. */
export function idNuevoDeTecnica(existentes: readonly TecnicaClinica[], azar: number = Math.random()): string {
  const usados = new Set(existentes.map((t) => t.id));
  let n = Math.floor(azar * 36 ** 6);
  for (let i = 0; i < 1000; i++, n++) {
    const id = `t-${n.toString(36).padStart(6, "0")}`;
    if (!usados.has(id)) return id;
  }
  return `t-${Date.now().toString(36)}`;
}

/** Mensaje para quien edita la lista, o null si se puede guardar. */
export function validarTecnicas(lista: ReadonlyArray<{ nombre: string; precio: string | number | null }>): string | null {
  if (lista.length > TECNICAS_MAXIMAS) return `Máximo ${TECNICAS_MAXIMAS} técnicas.`;
  const vistos = new Set<string>();
  for (const t of lista) {
    const nombre = limpiarNombre(t.nombre);
    if (!nombre) return "Cada técnica necesita un nombre.";
    const clave = nombre.toLocaleLowerCase("es");
    if (vistos.has(clave)) return `«${nombre}» está repetida.`;
    vistos.add(clave);
    const p = t.precio;
    if (p !== null && String(p).trim() !== "" && precioValido(p) === null) return `Revisa el precio de «${nombre}».`;
  }
  return null;
}

/** Nombre que se muestra: el propio del caso si existe; si no, el del tipo base. `porDefecto` = el texto que ya usaba la pantalla. */
export function nombreDeTecnica(base: string | null | undefined, nombrePropio: string | null | undefined, porDefecto?: string): string {
  const propio = limpiarNombre(nombrePropio);
  if (propio) return propio;
  if (porDefecto) return porDefecto;
  return base ? etiquetaEstandar(base) : "—";
}

/**
 * Qué guardar en `techniqueLabel` del caso al elegir una técnica: null si su nombre es el de siempre
 * del tipo base (no hace falta guardar nada, se muestra el del tipo).
 */
export function nombrePropioAGuardar(t: Pick<TecnicaClinica, "nombre" | "base"> | null | undefined): string | null {
  if (!t) return null;
  const nombre = limpiarNombre(t.nombre);
  if (!nombre || nombre === etiquetaEstandar(t.base)) return null;
  return nombre;
}

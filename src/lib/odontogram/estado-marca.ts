/**
 * Rojo = por hacer, azul = realizado (ws1-t6, decisiones de Rafael del 28-oct).
 *
 * Cada marca de PROCEDIMIENTO del odontograma (resina, corona, conducto, extracción…) lleva un
 * estado: «por hacer» (se pinta en rojo y alimenta el plan nuevo), «realizado» (azul) o «previo»
 * (azul, trabajo que el paciente trae hecho de otra clínica). El estado manda sobre el color de la
 * especialidad. Los HALLAZGOS (caries, fractura, movilidad…) no llevan estado: se pintan como hoy.
 *
 * Compatibilidad: lo guardado antes no tiene estado (`null`) y se lee y se pinta como hoy (color de
 * la especialidad). Nada se reescribe. En la base el estado vive en `odontogram_entries."estado"`
 * (sql/odontograma-estado-marca.sql); sin esa columna todo funciona como hoy y la pantalla no
 * enseña el selector de modo.
 *
 * PURO: sin base ni React. Lo usan el odontograma (cliente), la ventana del plan, las rutas y
 * `aplicar-hecho.ts`.
 */
import type { ClaveProcedimiento } from "@/lib/treatments/sugerir-procedimiento";

export const ESTADOS_MARCA = ["por_hacer", "hecho", "previo"] as const;
export type EstadoMarca = (typeof ESTADOS_MARCA)[number];

/** Los dos modos del selector del odontograma. «previo» es «realizado» con la casilla «de otra clínica». */
export type ModoMarca = "por_hacer" | "hecho";

export function esEstadoMarca(v: unknown): v is EstadoMarca {
  return typeof v === "string" && (ESTADOS_MARCA as readonly string[]).includes(v);
}

/** El color que pinta: rojo (por hacer), azul (realizado o previo), o null = el de la especialidad. */
export function tonoDeEstado(estado: EstadoMarca | null | undefined): "rojo" | "azul" | null {
  if (estado === "por_hacer") return "rojo";
  if (estado === "hecho" || estado === "previo") return "azul";
  return null;
}

/**
 * Las marcas del odontograma que SON un procedimiento y llevan estado, con el procedimiento del
 * plan que les toca (para que la marca roja salga en el plan con el precio de la clínica).
 *
 * Fuera a propósito (se pintan como hoy, sin estado):
 *  · los hallazgos (diagnóstico y periodoncia, impactado, resto radicular, diastema, migración);
 *  · lo que no tiene procedimiento en el plan: restauración temporal, póntico (puente),
 *    apicoformación, y la aparatología de ortodoncia (bracket, banda), que lleva su módulo.
 */
export const CLAVE_DE_MARCA: Readonly<Record<string, ClaveProcedimiento>> = {
  restoration: "resina",
  inlay: "incrustacion",
  crown: "corona",
  veneer: "carilla",
  post_core: "perno",
  rct: "endodoncia",
  pulpotomy: "pulpotomia",
  pulpotomy_ped: "pulpotomia",
  retreatment: "retratamiento",
  ext_indicated: "extraccion",
  ext_done: "extraccion",
  implant: "implante",
  apicoectomy: "apicectomia",
  sealant: "sellante",
  fluoride: "fluor",
  prophylaxis: "limpieza",
  steel_crown: "corona_acero",
  space_maint: "mantenedor",
};

/** ¿Esta marca lleva estado (rojo/azul)? Los hallazgos y lo que no tiene procedimiento, no. */
export function admiteEstado(conditionId: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLAVE_DE_MARCA, conditionId);
}

/**
 * La llave del estado dentro de un diente: `«cara»:«condición»`, con `_` para el diente completo.
 * La cara va con la letra de quien la usa (la pantalla dice «I» en los anteriores; la base, «O»).
 */
export function claveEstado(cara: string | null | undefined, conditionId: string): string {
  return `${cara ?? "_"}:${conditionId}`;
}

/** Lo mismo con la letra de la base: la «I» de un anterior es la «O». */
export function claveEstadoBase(cara: string | null | undefined, conditionId: string): string {
  return claveEstado(cara === "I" ? "O" : cara, conditionId);
}

/** Un diente con sus estados (el `ToothRecord` del odontograma; aquí sin depender de él). */
export interface ConEstados {
  estados?: Record<string, EstadoMarca>;
}

export function estadoEn(rec: ConEstados | null | undefined, cara: string | null | undefined, conditionId: string): EstadoMarca | null {
  const e = rec?.estados?.[claveEstado(cara, conditionId)];
  return esEstadoMarca(e) ? e : null;
}

/** Fija (o quita, con null) el estado de una marca. Muta `rec`: úsalo sobre una copia. */
export function fijarEstadoEn(rec: ConEstados, cara: string | null | undefined, conditionId: string, estado: EstadoMarca | null): void {
  const k = claveEstado(cara, conditionId);
  if (estado) {
    rec.estados = { ...(rec.estados ?? {}), [k]: estado };
  } else if (rec.estados && k in rec.estados) {
    const { [k]: _fuera, ...resto } = rec.estados;
    if (Object.keys(resto).length) rec.estados = resto;
    else delete rec.estados;
  }
}

/** Solo los estados de marcas que siguen en el diente (lo que se quitó no deja estado colgado). */
export function podarEstados(rec: ConEstados & { surfaces?: Record<string, string[] | undefined>; tooth?: string[] }): void {
  if (!rec.estados) return;
  const vivas = new Set<string>();
  for (const [cara, ids] of Object.entries(rec.surfaces ?? {})) for (const id of ids ?? []) vivas.add(claveEstado(cara, id));
  for (const id of rec.tooth ?? []) vivas.add(claveEstado(null, id));
  const quedan = Object.fromEntries(Object.entries(rec.estados).filter(([k, v]) => vivas.has(k) && esEstadoMarca(v)));
  if (Object.keys(quedan).length) rec.estados = quedan as Record<string, EstadoMarca>;
  else delete rec.estados;
}

/**
 * Lo que se escribe junto al nombre de la marca fuera del odontograma (PDF del expediente,
 * exportación, Sabina, la IA de la consulta): «Resina (por hacer)». Realizado y lo de antes, nada.
 */
export function rotuloDeEstado(estado: unknown): string {
  if (estado === "por_hacer") return "(por hacer)";
  if (estado === "previo") return "(previo, otra clínica)";
  return "";
}

/** El estado que deja un toque con el pincel en un modo: «realizado» con «de otra clínica» = previo. */
export function estadoDelModo(modo: ModoMarca, previo: boolean): EstadoMarca {
  return modo === "hecho" && previo ? "previo" : modo;
}
